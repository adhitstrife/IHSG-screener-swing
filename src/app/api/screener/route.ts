import { NextResponse } from "next/server";
import { getLatestStoredScreenerRun, isStorageConfigured } from "@/lib/screener-storage";

export const runtime = "nodejs";
export const maxDuration = 240;
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("page") || params.has("offset") || params.has("refresh")) return NextResponse.json({ error: "Hasil screener diterbitkan sebagai satu snapshot harian; pagination dan filter dilakukan dari hasil yang sama." }, { status: 400, headers });
    if (!isStorageConfigured()) return NextResponse.json({ error: "Screener harian memerlukan konfigurasi Supabase server." }, { status: 503, headers });
    const snapshot = await getLatestStoredScreenerRun();
    if (!snapshot) return NextResponse.json({ error: "Hasil scan harian belum tersedia atau sudah kedaluwarsa. Scan berikutnya dijalankan setelah penutupan bursa." }, { status: 503, headers });
    return NextResponse.json(snapshot, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal mengambil hasil screener." }, { status: 502, headers });
  }
}
