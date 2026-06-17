import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

// Simple XOR-based encryption keyed on the password (not military-grade,
// but sufficient for a local secret vault — the data never leaves the machine).
function encrypt(text: string, password: string): string {
  const key = Buffer.from(password.repeat(32), "utf-8").subarray(0, 32);
  const buf = Buffer.from(text, "utf-8");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ key[i % key.length];
  }
  return out.toString("base64");
}

function decrypt(encrypted: string, password: string): string {
  const key = Buffer.from(password.repeat(32), "utf-8").subarray(0, 32);
  const buf = Buffer.from(encrypted, "base64");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ key[i % key.length];
  }
  return out.toString("utf-8");
}

// We store vault entries in the SystemEvent table with type "vault_entry"
// to avoid a schema migration. The content is JSON: { label, encryptedValue }

// GET — list vault entry labels (decrypted values only returned with password)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const password = searchParams.get("password");

  try {
    const entries = await db.systemEvent.findMany({
      where: { type: "vault_entry" },
      orderBy: { createdAt: "desc" },
    });

    if (password) {
      // Return decrypted values
      const decrypted = entries.map((e) => {
        try {
          const data = JSON.parse(e.content) as { id: string; label: string; encryptedValue: string };
          return {
            id: e.id,
            label: data.label,
            value: decrypt(data.encryptedValue, password),
            time: e.createdAt.getTime(),
          };
        } catch {
          return { id: e.id, label: "(corrupted)", value: "", time: e.createdAt.getTime() };
        }
      });
      return NextResponse.json({ entries: decrypted, unlocked: true });
    }

    // Return labels only (locked)
    return NextResponse.json({
      entries: entries.map((e) => {
        try {
          const data = JSON.parse(e.content) as { label: string };
          return { id: e.id, label: data.label, time: e.createdAt.getTime() };
        } catch {
          return { id: e.id, label: "(unknown)", time: e.createdAt.getTime() };
        }
      }),
      unlocked: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — add a new vault entry
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { label, value, password } = body as { label: string; value: string; password: string };

    if (!label || !value || !password) {
      return NextResponse.json({ error: "label, value, and password required" }, { status: 400 });
    }

    const encryptedValue = encrypt(value, password);
    const content = JSON.stringify({ label, encryptedValue });

    const entry = await db.systemEvent.create({
      data: { type: "vault_entry", content },
    });

    return NextResponse.json({ ok: true, id: entry.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE — remove a vault entry
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    await db.systemEvent.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
