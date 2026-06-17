/**
 * /api/alpha/akasha — persistent cognition CRUD. Stores the AI's immortal
 * memory (lessons, facts, architecture), intentions, plans, goals, and
 * reactive events in the DB so they survive reloads. The AI hydrates from
 * this route on boot and writes to it after every cognitive action.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET — load all persistent cognition (memory, intentions, plans, goals)
export async function GET() {
  try {
    const [memory, intentions, plans, goals, events] = await Promise.all([
      db.akashaMemory.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      db.akashaIntention.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      db.plan.findMany({ where: { status: "active" }, orderBy: { createdAt: "desc" }, take: 10 }),
      db.goal.findMany({ where: { active: true }, orderBy: { createdAt: "asc" }, take: 20 }),
      db.systemEvent.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    ]);

    return NextResponse.json({
      memory: memory.map((m) => ({ id: m.id, text: m.text, kind: m.kind, time: m.createdAt.getTime() })),
      intentions: intentions.map((i) => ({ id: i.id, text: i.text, priority: i.priority as "low" | "normal" | "high", resolved: i.resolved, time: i.createdAt.getTime() })),
      plans: plans.map((p) => ({ id: p.id, goal: p.goal, rationale: p.rationale, status: p.status, steps: JSON.parse(p.stepsJson), time: p.createdAt.getTime() })),
      goals: goals.map((g) => ({ id: g.id, text: g.text, level: g.level as "long" | "medium" | "short", time: g.createdAt.getTime() })),
      events: events.map((e) => ({ id: e.id, type: e.type, content: e.content, time: e.createdAt.getTime() })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — write a new memory / intention / plan / goal / event
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type } = body as { type: string };

    switch (type) {
      case "memory": {
        const created = await db.akashaMemory.create({
          data: { text: body.text, kind: body.kind ?? "lesson" },
        });
        return NextResponse.json({ id: created.id, ok: true });
      }
      case "intention": {
        const created = await db.akashaIntention.create({
          data: { text: body.text, priority: body.priority ?? "normal" },
        });
        return NextResponse.json({ id: created.id, ok: true });
      }
      case "resolve_intention": {
        await db.akashaIntention.update({
          where: { id: body.id },
          data: { resolved: true },
        });
        return NextResponse.json({ ok: true });
      }
      case "plan": {
        const created = await db.plan.create({
          data: {
            goal: body.goal,
            rationale: body.rationale ?? "",
            status: "active",
            stepsJson: JSON.stringify(body.steps ?? []),
          },
        });
        return NextResponse.json({ id: created.id, ok: true });
      }
      case "advance_plan": {
        const existing = await db.plan.findUnique({ where: { id: body.id } });
        if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
        const steps = JSON.parse(existing.stepsJson) as { text: string; done: boolean }[];
        if (body.stepIndex >= 0 && body.stepIndex < steps.length) {
          steps[body.stepIndex].done = true;
        }
        const allDone = steps.every((s) => s.done);
        await db.plan.update({
          where: { id: body.id },
          data: {
            stepsJson: JSON.stringify(steps),
            status: allDone ? "completed" : "active",
            updatedAt: new Date(),
          },
        });
        return NextResponse.json({ ok: true, completed: allDone });
      }
      case "abandon_plan": {
        await db.plan.update({
          where: { id: body.id },
          data: { status: "abandoned", updatedAt: new Date() },
        });
        return NextResponse.json({ ok: true });
      }
      case "goal": {
        const created = await db.goal.create({
          data: { text: body.text, level: body.level ?? "long", active: true },
        });
        return NextResponse.json({ id: created.id, ok: true });
      }
      case "event": {
        const created = await db.systemEvent.create({
          data: { type: body.eventType ?? "event", content: body.content ?? "" },
        });
        return NextResponse.json({ id: created.id, ok: true });
      }
      default:
        return NextResponse.json({ error: "unknown type" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE — remove a memory/intention/plan/goal by id
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const id = searchParams.get("id");
    if (!type || !id) return NextResponse.json({ error: "type and id required" }, { status: 400 });

    switch (type) {
      case "memory":
        await db.akashaMemory.delete({ where: { id } });
        break;
      case "intention":
        await db.akashaIntention.delete({ where: { id } });
        break;
      case "plan":
        await db.plan.delete({ where: { id } });
        break;
      case "goal":
        await db.goal.update({ where: { id }, data: { active: false } });
        break;
      default:
        return NextResponse.json({ error: "unknown type" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
