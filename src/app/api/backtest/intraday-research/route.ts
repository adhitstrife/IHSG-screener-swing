import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "Riset intraday BSJP telah dihentikan. Gunakan /api/backtest/research untuk evaluasi swing.", replacement: "/api/backtest/research" }, { status: 410 });
}
