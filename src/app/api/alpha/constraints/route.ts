/**
 * /api/alpha/constraints — CRUD for user constraints on the AI.
 *
 * The user can set constraints like "don't touch the kernel" or
 * "only improve the UI". The AI must obey these constraints.
 *
 * GET    /api/alpha/constraints           → list active constraints
 * POST   /api/alpha/constraints           → create a constraint
 * DELETE /api/alpha/constraints?id=X       → delete a constraint
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const constraints = await db.constraint.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ ok: true, constraints });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "DB error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, scope } = body as { text: string; scope?: string };
    if (!text) return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });

    const constraint = await db.constraint.create({
      data: { text, scope: scope || "global" },
    });
    return NextResponse.json({ ok: true, constraint });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "DB error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  try {
    await db.constraint.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "DB error" },
      { status: 500 }
    );
  }
}
