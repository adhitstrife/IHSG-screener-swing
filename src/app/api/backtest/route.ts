import { NextResponse } from "next/server";
import { runBacktest } from "@/lib/backtest";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    const data = await runBacktest(force);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backtest gagal dijalankan.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
