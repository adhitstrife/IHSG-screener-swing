import { NextResponse } from "next/server";
import { getScreenerBatch } from "@/lib/screener";
import { getLatestScreenerRefreshProgress, getLatestStoredScreenerRun, isStorageConfigured, saveScreenerRun } from "@/lib/screener-storage";

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
    const previousProgress = await getLatestScreenerRefreshProgress();
    const offset = previousProgress?.nextOffset ?? 0;
    const batch = await getScreenerBatch(offset, previousProgress?.universeId, offset === 0);
    const published = await saveScreenerRun(batch);
    const progress = {
      processed: batch.meta.processedSize,
      total: batch.meta.universeSize,
      updatedAt: batch.meta.generatedAt,
      nextOffset: batch.meta.nextOffset ?? undefined,
      universeId: batch.meta.universeId,
    };
    if (published) {
      const completed = await getLatestStoredScreenerRun();
      if (completed) return NextResponse.json(completed, { headers });
    }
    if (!stale) return NextResponse.json({ refreshing: true, progress, message: "Scan pertama sedang berjalan." }, { status: 202, headers });
    return NextResponse.json({ ...stale, meta: { ...stale.meta, refreshing: true, progress, refreshMessage: "Menampilkan hasil sesi sebelumnya sambil memperbarui data Yahoo Finance." } }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal mengambil hasil screener." }, { status: 502, headers });
  }
}
