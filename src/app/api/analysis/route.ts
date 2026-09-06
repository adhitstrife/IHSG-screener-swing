import { NextResponse } from "next/server";
import { analyzeStockWithAi } from "@/lib/stock-analysis";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { symbol?: unknown };
    const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase().replace(/\.JK$/, "") : "";
    if (!/^[A-Z]{4}$/.test(symbol)) return NextResponse.json({ error: "Masukkan kode saham IDX 4 huruf." }, { status: 400 });
    return NextResponse.json(await analyzeStockWithAi(symbol));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analisis AI gagal.";
    return NextResponse.json({ error: message }, { status: message.includes("YOGATHEDEV_AI_API_KEY") ? 503 : 502 });
  }
}
