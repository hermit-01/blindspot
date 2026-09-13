import { NextResponse } from "next/server";
import { AGENCIES } from "@/lib/types";
import { claimCell, resetDemo, snapshot } from "@/lib/store";
import type { Agency } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (body?.reset === true) {
    resetDemo();
    return NextResponse.json({
      ok: true,
      message: "Demo reset.",
      state: snapshot(),
    });
  }

  const cell = typeof body?.cell === "string" ? body.cell : "";
  const agency = body?.agency as Agency;

  if (!cell || !AGENCIES.includes(agency)) {
    return NextResponse.json(
      { ok: false, message: "Need a cell and an agency." },
      { status: 400 }
    );
  }

  const result = claimCell(cell, agency);
  return NextResponse.json({ ...result, state: snapshot() });
}
