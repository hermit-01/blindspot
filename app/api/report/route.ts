import { NextResponse } from "next/server";
import { AGENCIES } from "@/lib/types";
import { logReport, snapshot } from "@/lib/store";
import type { Agency } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const raw = typeof body?.raw === "string" ? body.raw : "";
  const agency = body?.agency as Agency;

  if (!AGENCIES.includes(agency)) {
    return NextResponse.json(
      { ok: false, message: "Pick who is reporting first." },
      { status: 400 }
    );
  }

  const result = logReport(raw, agency);
  return NextResponse.json({ ...result, state: snapshot() });
}
