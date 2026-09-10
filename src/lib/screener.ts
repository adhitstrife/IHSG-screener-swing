import { isFreshSnapshot, weekdayAge } from "./market-data";
import { evaluateSwing, STRATEGY_VERSION, type SwingAssessment } from "./swing-strategy";
import { evaluateShortSwing, SHORT_SWING_VERSION } from "./short-swing-strategy";
import { getDailyHistory, YahooDataError } from "./yahoo-finance";
import { YAHOO_DATA_VERSION, YAHOO_PRICE_BASIS, YAHOO_SOURCE } from "./yahoo-data";

import { getCandidateUniverse, type CandidateUniverse, type UniverseStock } from "./yahoo-universe";
import { rankScanResults } from "./screener-results";

export const SCREENER_STRATEGY_VERSION = `${STRATEGY_VERSION}+${SHORT_SWING_VERSION}`;

export type ScreenerStock = SwingAssessment & { shortTerm: SwingAssessment; symbol: string; name: string; price: number; change: number; volume: string; asOf: string; stale: boolean };
export type ScreenerSnapshot = {
  data: ScreenerStock[];
  meta: {
    strategyVersion: string; dataVersion: string; priceBasis: string;
    generatedAt: string; universeSize: number; scannedSize: number;
    universeId?: string; candidateSource?: string; candidateFilter?: string; yahooMatches?: number;
    batchOffset?: number; nextOffset?: number | null; processedSize?: number;
    page?: number; pageSize?: number; pageCandidateCount?: number; totalPages?: number;
    failures: { symbol: string; reason: string }[];
    source: string; quoteDelayMinutes: number; warnings: string[];
  };
};

function formatVolume(volume: number) {
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(1).replace(".", ",")}K`;
  return String(volume);
}

/** Provider boundary keeps strategy scoring independent from Yahoo's request format. */
export function createScreenerService(loadHistory = getDailyHistory, universe: UniverseStock[] | ((force?: boolean) => Promise<CandidateUniverse>) = getCandidateUniverse, allowFailedBatch = false, concurrency = 1, loadBenchmark: typeof getDailyHistory | undefined = loadHistory === getDailyHistory ? getDailyHistory : undefined) {
  let cached: ScreenerSnapshot | undefined;
  let pending: Promise<ScreenerSnapshot> | undefined;

  async function scanUniverse(force: boolean): Promise<ScreenerSnapshot> {
    const candidates = typeof universe === "function" ? await universe(force) : undefined;
    const stocks = candidates?.stocks ?? universe as UniverseStock[];
    const now = new Date(); const from = new Date(now); from.setUTCDate(from.getUTCDate() - 360);
    // One benchmark request is shared by every stock in this scan; its cache is
    // also reused by subsequent page/batch requests in the same server instance.
    let ihsg: Awaited<ReturnType<typeof getDailyHistory>> | undefined;
    try { ihsg = loadBenchmark ? await loadBenchmark("^JKSE", from.toISOString().slice(0, 10), now.toISOString().slice(0, 10), force) : undefined; }
    catch { /* A missing benchmark reduces context only; stock scan remains available. */ }
    const results: ScreenerStock[] = [];
    const failures: ScreenerSnapshot["meta"]["failures"] = [];
    let cursor = 0;
    let denied: YahooDataError | undefined;
    async function worker() {
      while (cursor < stocks.length && !denied) {
      const stock = stocks[cursor++];
      try {
        const history = await loadHistory(stock.symbol, from.toISOString().slice(0, 10), now.toISOString().slice(0, 10), force);
        const candles = history.candles;
        const context = { benchmarkCandles: ihsg?.candles, dataQuality: history.quality };
        const assessment = evaluateSwing(candles, context);
        const shortTerm = evaluateShortSwing(candles, context);
        const latest = candles.at(-1)!; const previous = candles.at(-2)!;
        results.push({ ...stock, ...assessment, shortTerm: { ...shortTerm, warnings: [...shortTerm.warnings, ...history.warnings] }, warnings: [...assessment.warnings, ...history.warnings], price: latest.close, change: (latest.close / previous.close - 1) * 100, volume: formatVolume(latest.volume), asOf: latest.date, stale: weekdayAge(latest.date, now) > 3 });
      } catch (error) {
        failures.push({ symbol: stock.symbol, reason: error instanceof Error ? error.message : "Data tidak tersedia." });
        if (error instanceof YahooDataError && [401, 403, 429].includes(error.status ?? 0)) {
          denied = error;
        }
      }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (denied && allowFailedBatch) throw denied;
    if (denied) for (const skipped of stocks.slice(cursor)) failures.push({ symbol: skipped.symbol, reason: "Dilewati setelah Yahoo menolak request; coba ulang nanti." });
    if (!results.length && stocks.length && !allowFailedBatch) throw new Error(`Tidak ada data swing yang dapat diproses. ${failures[0]?.reason ?? "Universe kosong."}`);
    const data = rankScanResults(results);
    return {
      data,
      meta: { strategyVersion: SCREENER_STRATEGY_VERSION, dataVersion: YAHOO_DATA_VERSION, priceBasis: YAHOO_PRICE_BASIS, generatedAt: now.toISOString(), universeSize: stocks.length, scannedSize: data.length, failures, source: YAHOO_SOURCE, quoteDelayMinutes: 10, warnings: candidates?.warnings ?? [], universeId: candidates?.id, candidateSource: candidates?.source, candidateFilter: candidates?.filter, yahooMatches: candidates?.yahooMatches },
    };
  }

  return async function getScreenerSnapshot(force = false): Promise<ScreenerSnapshot> {
    if (pending) return pending;
    if (!force && cached && isFreshSnapshot(cached.meta.generatedAt)) return cached;
    pending = scanUniverse(force).then((snapshot) => { cached = snapshot; return snapshot; }).finally(() => { pending = undefined; });
    return pending;
  };
}

const batchServices = new Map<string, ReturnType<typeof createScreenerService>>();
// Keep each on-demand request bounded so it completes reliably on serverless.
export const SCAN_BATCH_SIZE = 3;

export async function getScreenerBatch(offset = 0, expectedId?: string, force = false): Promise<ScreenerSnapshot> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % SCAN_BATCH_SIZE !== 0) throw new Error("Offset scan tidak valid.");
  const candidates = await getCandidateUniverse(force && offset === 0);
  if (expectedId && candidates.id !== expectedId) throw new Error("Kandidat Yahoo berubah. Jalankan scan ulang.");
  if (offset > candidates.stocks.length) throw new Error("Offset melebihi jumlah kandidat.");
  const key = candidates.id + ":" + offset;
  let service = batchServices.get(key);
  if (!service) {
    if (batchServices.size >= 500) batchServices.delete(batchServices.keys().next().value!);
    service = createScreenerService(getDailyHistory, candidates.stocks.slice(offset, offset + SCAN_BATCH_SIZE), true);
    batchServices.set(key, service);
  }
  const snapshot = await service(force);
  const end = Math.min(offset + SCAN_BATCH_SIZE, candidates.stocks.length);
  return { ...snapshot, meta: { ...snapshot.meta, universeSize: candidates.stocks.length,
    universeId: candidates.id, candidateSource: candidates.source, candidateFilter: candidates.filter,
    yahooMatches: candidates.yahooMatches, warnings: [...candidates.warnings, ...snapshot.meta.warnings],
    batchOffset: offset, processedSize: end, nextOffset: end < candidates.stocks.length ? end : null,
  } };
}

// Full daily runs use Yahoo's bounded three-request queue and are persisted atomically.
export const getScreenerSnapshot = createScreenerService(getDailyHistory, getCandidateUniverse, false, 3);

export const SCAN_PAGE_SIZE = 10;
export class CandidatePageChangedError extends Error {}

/** Alphabetical candidate membership is fixed before analysis; sorting is page-local. */
export function createScreenerPageService(loadCandidates = getCandidateUniverse, loadHistory = getDailyHistory) {
  const services = new Map<string, ReturnType<typeof createScreenerService>>();
  return async (page = 1, expectedId?: string, force = false, discovered?: CandidateUniverse): Promise<ScreenerSnapshot> => {
    if (!Number.isSafeInteger(page) || page < 1) throw new Error("Halaman tidak valid.");
    const candidates = discovered ?? await loadCandidates(force);
    if (expectedId && candidates.id !== expectedId) throw new CandidatePageChangedError("Daftar kandidat berubah. Muat ulang halaman untuk daftar terbaru.");
    const totalPages = Math.max(1, Math.ceil(candidates.stocks.length / SCAN_PAGE_SIZE));
    if (page > totalPages) throw new CandidatePageChangedError("Halaman tidak tersedia pada daftar kandidat terbaru. Muat ulang dari halaman pertama.");
    const stocks = candidates.stocks.slice((page - 1) * SCAN_PAGE_SIZE, page * SCAN_PAGE_SIZE);
    const key = `${candidates.id}:page:${page}`;
    let service = services.get(key);
    if (!service) {
      if (services.size >= 300) services.delete(services.keys().next().value!);
      service = createScreenerService(loadHistory, stocks, true, 3);
      services.set(key, service);
    }
    const snapshot = await service(force);
    return { ...snapshot, meta: { ...snapshot.meta, universeId: candidates.id,
      universeSize: candidates.stocks.length, candidateSource: candidates.source,
      candidateFilter: candidates.filter, yahooMatches: candidates.yahooMatches,
      warnings: [...candidates.warnings, ...snapshot.meta.warnings],
      page, pageSize: SCAN_PAGE_SIZE, pageCandidateCount: stocks.length, totalPages,
    } };
  };
}

export const getScreenerPage = createScreenerPageService();
