import { NextResponse } from "next/server";
import { after } from "next/server";
import { getLatestStoredScreenerRun, isStorageConfigured } from "@/lib/screener-storage";

export const runtime = "nodejs";
export const maxDuration = 240;
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("page") || params.has("offset") || params.has("refresh")) return NextResponse.json({ error: "Hasil screener diterbitkan sebagai satu snapshot harian; pagination dan filter dilakukan dari hasil yang sama." }, { status: 400, headers });
    if (!isStorageConfigured()) return NextResponse.json({ error: "Screener harian memerlukan konfigurasi Supabase server." }, { status: 503, headers });
    const current = await getLatestStoredScreenerRun();
    if (current) return NextResponse.json(current, { headers });
    const stale = await getLatestStoredScreenerRun(true);
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const origin = new URL(request.url).origin;
      after(async () => {
        try {
          await fetch(`${origin}/api/cron/screener`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ offset: 0 }), cache: "no-store" });
        } catch (error) { console.error("On-demand screener refresh failed", error); }
      });
    }
    if (!stale) return NextResponse.json({ error: "Hasil scan pertama sedang dibuat. Muat ulang halaman beberapa saat lagi.", refreshing: Boolean(secret) }, { status: 503, headers });
    return NextResponse.json({ ...stale, meta: { ...stale.meta, refreshing: Boolean(secret), refreshMessage: "Menampilkan hasil sesi sebelumnya sambil memperbarui data Yahoo Finance." } }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal mengambil hasil screener." }, { status: 502, headers });
  }
}
