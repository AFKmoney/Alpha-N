/**
 * /api/alpha/vault — the secret vault. Entries are XOR-encrypted with a
 * key derived from the user's master password and stored as SystemEvent
 * rows (type "vault_entry"). The master password never leaves the request.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

interface VaultEntry {
  id: string;
  label: string;
  value: string;
  time: number;
}

function deriveKey(password: string): number[] {
  // FNV-1a stretched to 32 bytes — enough for casual-at-rest obfuscation
  const key: number[] = [];
  let h = 0x811c9dc5;
  for (let round = 0; round < 32; round++) {
    for (const ch of password) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    key.push(h & 0xff);
  }
  return key;
}

function xor(text: string, key: number[]): string {
  return text
    .split("")
    .map((ch, i) => String.fromCharCode(ch.charCodeAt(0) ^ key[i % key.length]))
    .join("");
}

function encode(text: string, key: number[]): string {
  return Buffer.from(xor(text, key), "utf8").toString("base64");
}

function decode(b64: string, key: number[]): string {
  return xor(Buffer.from(b64, "base64").toString("utf8"), key);
}

async function loadEntries(key: number[]): Promise<VaultEntry[]> {
  const rows = await db.systemEvent.findMany({
    where: { type: "vault_entry" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => {
    try {
      const parsed = JSON.parse(row.content) as { label?: string; value?: string };
      return {
        id: row.id,
        label: String(parsed.label ?? "entry"),
        value: decode(String(parsed.value ?? ""), key),
        time: row.createdAt.getTime(),
      };
    } catch {
      return { id: row.id, label: "unreadable entry", value: "", time: row.createdAt.getTime() };
    }
  });
}

export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get("password") ?? "";
  if (!password) return NextResponse.json({ error: "password required" }, { status: 400 });
  try {
    const entries = await loadEntries(deriveKey(password));
    return NextResponse.json({ ok: true, entries });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "vault read failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { label?: string; value?: string; password?: string };
    const password = String(body.password ?? "");
    if (!password || !body.label || !body.value) {
      return NextResponse.json({ ok: false, error: "label, value and password required" }, { status: 400 });
    }
    const key = deriveKey(password);
    await db.systemEvent.create({
      data: {
        type: "vault_entry",
        content: JSON.stringify({ label: body.label.slice(0, 120), value: encode(body.value, key) }),
      },
    });
    const entries = await loadEntries(key);
    return NextResponse.json({ ok: true, entries });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "vault write failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  try {
    await db.systemEvent.deleteMany({ where: { id, type: "vault_entry" } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "vault delete failed" }, { status: 500 });
  }
}
