import { after } from "next/server";
import { NextResponse } from "next/server";
import { getScreenerBatch } from "@/lib/screener";
import { getLatestScreenerRefreshProgress, getLatestStoredScreenerRun, isStorageConfigured, saveScreenerRun } from "@/lib/screener-storage";

export const runtime = "nodejs";
export const maxDuration = 240;
const headers = { "Cache-Control": "no-store" };
const activeRefreshes = new Map<string, Promise<void>>();

type RefreshProgress = { processed: number; total: number; updatedAt: string; nextOffset?: number; universeId?: string };

/** Complete a bounded, server-owned chain after replying. Browser polling must never drive batches. */
async function completeRefresh(progress: RefreshProgress) {
  let nextOffset = progress.nextOffset;
  let universeId = progress.universeId;
  while (nextOffset !== undefined && universeId) {
    const batch = await getScreenerBatch(nextOffset, universeId);
    await saveScreenerRun(batch);
    nextOffset = batch.meta.nextOffset ?? undefined;
    universeId = batch.meta.universeId;
  }
}

function scheduleRefresh(progress: RefreshProgress) {
  if (!progress.nextOffset || !progress.universeId || activeRefreshes.has(progress.universeId)) return;
  after(async () => {
    const running = activeRefreshes.get(progress.universeId!);
    if (running) return running;
    const task = completeRefresh(progress).catch((error) => { console.error("Screener background refresh failed", error); }).finally(() => { activeRefreshes.delete(progress.universeId!); });
    activeRefreshes.set(progress.universeId!, task);
    await task;
  });
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("page") || params.has("offset") || params.has("refresh")) return NextResponse.json({ error: "Hasil screener diterbitkan sebagai satu snapshot harian; pagination dan filter dilakukan dari hasil yang sama." }, { status: 400, headers });
    if (!isStorageConfigured()) return NextResponse.json({ error: "Screener harian memerlukan konfigurasi Supabase server." }, { status: 503, headers });
    const current = await getLatestStoredScreenerRun();
    if (current) return NextResponse.json(current, { headers });
    const stale = await getLatestStoredScreenerRun(true);
    const previousProgress = await getLatestScreenerRefreshProgress();
    if (previousProgress) {
      const progress = { processed: previousProgress.processed, total: previousProgress.total, updatedAt: previousProgress.updatedAt, nextOffset: previousProgress.nextOffset, universeId: previousProgress.universeId };
      scheduleRefresh(progress);
      if (!stale) return NextResponse.json({ refreshing: true, progress, message: "Scan berjalan di server." }, { status: 202, headers });
      return NextResponse.json({ ...stale, meta: { ...stale.meta, refreshing: true, progress, refreshMessage: "Menampilkan hasil sesi sebelumnya sementara scan berjalan di server." } }, { headers });
    }
    const batch = await getScreenerBatch(0, undefined, true);
    const published = await saveScreenerRun(batch);
    const progress = {
      processed: batch.meta.processedSize ?? batch.meta.scannedSize,
      total: batch.meta.universeSize,
      updatedAt: batch.meta.generatedAt,
      nextOffset: batch.meta.nextOffset ?? undefined,
      universeId: batch.meta.universeId,
    };
    if (published) {
      const completed = await getLatestStoredScreenerRun();
      if (completed) return NextResponse.json(completed, { headers });
    }
    scheduleRefresh(progress);
    if (!stale) return NextResponse.json({ refreshing: true, progress, message: "Scan pertama berjalan di server." }, { status: 202, headers });
    return NextResponse.json({ ...stale, meta: { ...stale.meta, refreshing: true, progress, refreshMessage: "Menampilkan hasil sesi sebelumnya sementara scan berjalan di server." } }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal mengambil hasil screener." }, { status: 502, headers });
  }
}
