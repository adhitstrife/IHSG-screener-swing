import { NextResponse } from "next/server";
import { runBacktest } from "@/lib/backtest";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const force = params.get("refresh") === "1";
    const mode = params.get("mode") === "short" ? "short" : "swing";
    const data = await runBacktest(force, mode);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backtest gagal dijalankan.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
