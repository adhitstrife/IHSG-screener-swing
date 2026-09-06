import { NextResponse } from "next/server";
import { runStrategyResearch } from "@/lib/strategy-research";

export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(request: Request) {
  try { return NextResponse.json(await runStrategyResearch(new URL(request.url).searchParams.get("refresh") === "1")); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Riset strategi gagal." }, { status: 502 }); }
}
