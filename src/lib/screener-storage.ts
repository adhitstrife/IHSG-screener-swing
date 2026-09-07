import { createClient } from "@supabase/supabase-js";
import type { ScreenerSnapshot } from "./screener";
import { universeConfig } from "./yahoo-universe";
import { YAHOO_DATA_VERSION, YAHOO_PRICE_BASIS } from "./yahoo-data";
import { STRATEGY_VERSION } from "./swing-strategy";
import { isCurrentDailyScreenerRun, isFreshSnapshot } from "./market-data";
import { mergeScanBatch } from "./screener-results";

const CACHE_TTL_MS = 15 * 60 * 1000;
const cacheKey = () => `${STRATEGY_VERSION}:${YAHOO_DATA_VERSION}:${YAHOO_PRICE_BASIS}:${universeConfig().key}`;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return undefined;
  return createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function isStorageConfigured() { return Boolean(getAdminClient()); }

const pageKey = (universeId: string, page: number) => `${cacheKey()}:page-v1:${universeId}:${page}`;

export async function getStoredScreenerPage(universeId: string, page: number): Promise<ScreenerSnapshot | undefined> {
  const client = getAdminClient();
  if (!client) return undefined;
  const { data, error } = await client.from("swing_screening_runs").select("snapshot, generated_at")
    .eq("cache_key", pageKey(universeId, page)).order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data || !isFreshSnapshot(data.generated_at)) return undefined;
  const snapshot = data.snapshot as ScreenerSnapshot;
  if (snapshot?.meta?.universeId !== universeId || snapshot.meta.page !== page || snapshot.meta.pageSize !== 10 || snapshot.meta.strategyVersion !== STRATEGY_VERSION || snapshot.meta.dataVersion !== YAHOO_DATA_VERSION || snapshot.meta.priceBasis !== YAHOO_PRICE_BASIS || !Array.isArray(snapshot.data) || !Array.isArray(snapshot.meta.failures) || snapshot.data.length + snapshot.meta.failures.length !== snapshot.meta.pageCandidateCount || !isFreshSnapshot(snapshot.meta.generatedAt)) return undefined;
  return snapshot;
}

export async function saveScreenerPage(snapshot: ScreenerSnapshot) {
  const client = getAdminClient();
  if (!client || !snapshot.meta.universeId || !snapshot.meta.page) return false;
  const { error } = await client.from("swing_screening_runs").insert({ cache_key: pageKey(snapshot.meta.universeId, snapshot.meta.page), strategy_version: STRATEGY_VERSION, generated_at: snapshot.meta.generatedAt, snapshot });
  if (error) throw new Error("Cache halaman belum tersimpan. Periksa konfigurasi Supabase.");
  return true;
}

/** One atomic insert prevents incomplete runs from becoming cached results. */
export async function saveScreenerRun(snapshot: ScreenerSnapshot, supabase = getAdminClient()) {
  if (!supabase) return false;
  if (snapshot.meta.batchOffset !== undefined) {
    if (!snapshot.meta.universeId) return false;
    const batchKey = `${cacheKey()}:batch:${snapshot.meta.universeId}`;
    const { error } = await supabase.from("swing_screening_runs").insert({ cache_key: batchKey, strategy_version: STRATEGY_VERSION, generated_at: snapshot.meta.generatedAt, snapshot });
    if (error) throw new Error("Batch belum tersimpan. Periksa migrasi swing_screening_runs dan konfigurasi Supabase.");
    if (snapshot.meta.nextOffset != null) return false;
    // Server-created batches can be joined across serverless instances. Never accept
    // client-submitted scores, and never publish an incomplete run as the full cache.
    const batches = new Map<number, ScreenerSnapshot>();
    for (let offset = 0; ; offset += 500) {
      const { data, error: readError } = await supabase.from("swing_screening_runs").select("snapshot")
        .eq("cache_key", batchKey).gte("generated_at", new Date(Date.now() - CACHE_TTL_MS).toISOString())
        .order("generated_at", { ascending: false }).range(offset, offset + 499);
      if (readError) throw new Error("Batch tersimpan, tetapi penggabungan riwayat gagal.");
      for (const row of data ?? []) {
        const batch = row.snapshot as ScreenerSnapshot;
        const index = batch.meta.batchOffset;
        if (index !== undefined && isFreshSnapshot(batch.meta.generatedAt) && !batches.has(index)) batches.set(index, batch);
      }
      if (!data || data.length < 500) break;
    }
    let combined: ScreenerSnapshot | undefined;
    let next = 0;
    do {
      const batch = batches.get(next);
      if (!batch) return false;
      combined = mergeScanBatch(combined, batch);
      if (batch.meta.nextOffset == null) break;
      next = batch.meta.nextOffset;
    } while (true);
    if (!combined || combined.meta.processedSize !== snapshot.meta.universeSize) return false;
    snapshot = { ...combined, meta: { ...combined.meta, batchOffset: undefined } };
  }
  const { error } = await supabase.from("swing_screening_runs").insert({
    cache_key: cacheKey(), strategy_version: STRATEGY_VERSION,
    generated_at: snapshot.meta.generatedAt, snapshot,
  });
  if (error) throw new Error("Riwayat swing belum tersimpan. Periksa migrasi swing_screening_runs dan konfigurasi Supabase.");
  return true;
}

export async function getLatestStoredScreenerRun(allowStale = false): Promise<ScreenerSnapshot | undefined> {
  const supabase = getAdminClient();
  if (!supabase) return undefined;
  const { data: run, error } = await supabase.from("swing_screening_runs")
    .select("snapshot, generated_at").eq("cache_key", cacheKey())
    .lte("generated_at", new Date().toISOString())
    .order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !run) return undefined;
  const snapshot = run.snapshot as ScreenerSnapshot;
  if (snapshot?.meta?.strategyVersion !== STRATEGY_VERSION || !Array.isArray(snapshot.data) || !Array.isArray(snapshot.meta.failures) || snapshot.meta.nextOffset != null || !snapshot.meta.universeId) return undefined;
  if (snapshot.meta.dataVersion !== YAHOO_DATA_VERSION || snapshot.meta.priceBasis !== YAHOO_PRICE_BASIS) return undefined;
  if (snapshot.data.some((stock) => stock.strategyVersion !== STRATEGY_VERSION || !stock.indicators || !Array.isArray(stock.warnings))) return undefined;
  if (!allowStale && !isCurrentDailyScreenerRun(run.generated_at)) return undefined;
  return { data: snapshot.data, meta: { ...snapshot.meta, source: "Yahoo Finance · Supabase cache" } };
}
