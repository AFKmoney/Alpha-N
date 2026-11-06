/**
 * /api/alpha/akasha — the persistent cognition endpoint (GET = hydrate,
 * POST = write, DELETE = remove). The AI's memory, intentions, plans,
 * goals and system events live here and survive reloads.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [memory, intentions, plans, goals, events] = await Promise.all([
      db.akashaMemory.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      db.akashaIntention.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      db.plan.findMany({ orderBy: { updatedAt: "desc" }, take: 20 }),
      db.goal.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      db.systemEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    ]);

    return NextResponse.json({
      ok: true,
      memory: memory.map((m) => ({ id: m.id, text: m.text, kind: m.kind, time: m.createdAt.getTime() })),
      intentions: intentions.map((i) => ({
        id: i.id,
        text: i.text,
        priority: i.priority,
        resolved: i.resolved,
        time: i.createdAt.getTime(),
      })),
      plans: plans.map((p) => ({
        id: p.id,
        goal: p.goal,
        rationale: p.rationale,
        status: p.status,
        steps: safeSteps(p.stepsJson),
        time: p.createdAt.getTime(),
      })),
      goals: goals.map((g) => ({ id: g.id, text: g.text, level: g.level, time: g.createdAt.getTime() })),
      events: events.map((e) => ({ id: e.id, type: e.type, content: e.content, time: e.createdAt.getTime() })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "akasha read failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const type = String(body.type ?? "");

    switch (type) {
      case "memory": {
        const row = await db.akashaMemory.create({
          data: { text: String(body.text ?? ""), kind: String(body.kind ?? "lesson") },
        });
        return NextResponse.json({ ok: true, id: row.id });
      }
      case "intention": {
        const row = await db.akashaIntention.create({
          data: { text: String(body.text ?? ""), priority: String(body.priority ?? "normal") },
        });
        return NextResponse.json({ ok: true, id: row.id });
      }
      case "resolve_intention": {
        await db.akashaIntention.update({ where: { id: String(body.id ?? "") }, data: { resolved: true } }).catch(() => {});
        return NextResponse.json({ ok: true });
      }
      case "plan": {
        const row = await db.plan.create({
          data: {
            goal: String(body.goal ?? ""),
            rationale: String(body.rationale ?? ""),
            stepsJson: JSON.stringify(Array.isArray(body.steps) ? body.steps : []),
          },
        });
        return NextResponse.json({ ok: true, id: row.id });
      }
      case "advance_plan": {
        const id = String(body.id ?? "");
        const row = await db.plan.findUnique({ where: { id } });
        if (row) {
          const steps = safeSteps(row.stepsJson);
          const idx = Number(body.stepIndex ?? 0);
          if (steps[idx]) steps[idx].done = true;
          const allDone = steps.length > 0 && steps.every((s) => s.done);
          await db.plan.update({
            where: { id },
            data: { stepsJson: JSON.stringify(steps), status: allDone ? "completed" : row.status },
          });
        }
        return NextResponse.json({ ok: true });
      }
      case "abandon_plan": {
        await db.plan.update({ where: { id: String(body.id ?? "") }, data: { status: "abandoned" } }).catch(() => {});
        return NextResponse.json({ ok: true });
      }
      case "goal": {
        const row = await db.goal.create({
          data: { text: String(body.text ?? ""), level: String(body.level ?? "long") },
        });
        return NextResponse.json({ ok: true, id: row.id });
      }
      case "event": {
        const row = await db.systemEvent.create({
          data: { type: String(body.eventType ?? body.kind ?? "event"), content: String(body.content ?? "") },
        });
        return NextResponse.json({ ok: true, id: row.id });
      }
      default:
        return NextResponse.json({ ok: false, error: `unknown akasha write type '${type}'` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "akasha write failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  try {
    await Promise.all([
      db.akashaMemory.deleteMany({ where: { id } }),
      db.akashaIntention.deleteMany({ where: { id } }),
      db.goal.deleteMany({ where: { id } }),
      db.systemEvent.deleteMany({ where: { id } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "delete failed" }, { status: 500 });
  }
}

function safeSteps(json: string): { text: string; done: boolean }[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) => {
      const step = s as Record<string, unknown>;
      return { text: String(step.text ?? ""), done: Boolean(step.done) };
    });
  } catch {
    return [];
  }
}
