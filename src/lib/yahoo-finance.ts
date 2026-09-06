import YahooFinance from "yahoo-finance2";
import { isFreshSnapshot } from "./market-data";
import { normalizeYahooChart, toYahooSymbol, yahooDateRange, type DailyHistory, type YahooDailyChart } from "./yahoo-data";

export class YahooDataError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = "YahooDataError"; }
}

/** Statuses are preserved without exposing upstream HTML, cookies, or request URLs. */
async function yahooFetch(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  const response = await fetch(input, { ...init, cache: "no-store" });
  if (!response.ok && !(response.status >= 300 && response.status < 400)) {
    await response.body?.cancel();
    throw new YahooDataError(`Yahoo Finance merespons HTTP ${response.status}.`, response.status);
  }
  return response;
}

const yahoo = new YahooFinance({
  suppressNotices: ["yahooSurvey"], versionCheck: false,
  queue: { concurrency: 3, interval: 500 },
  validation: { logErrors: false, logOptionsErrors: false },
  fetch: yahooFetch,
});

/** Isolated adapter for the pinned v4 client: its public screener only supports presets.
 * Bootstrap with GET first: passing POST options to an uninitialized crumb flow breaks it.
 * Keep cookies/crumb and upstream errors server-side; retest when upgrading the client.
 */
export async function requestYahooScreen(body: object): Promise<unknown> {
  try {
    await yahoo.quote("BBCA.JK", {}, { fetchOptions: { signal: AbortSignal.timeout(20_000) }, validateResult: false });
    return await yahoo._fetch("https://query1.finance.yahoo.com/v1/finance/screener", {
      formatted: "false", lang: "en-US", region: "US",
    }, { fetchOptions: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) } }, "json", true);
  } catch (error) {
    if (error instanceof YahooDataError) throw friendlyError(error);
    throw new YahooDataError("Filter Yahoo Finance gagal. Coba ulang nanti; daftar saham tidak diganti dengan watchlist tetap.");
  }
}

export type YahooChartRequest = (symbol: string, range: { period1: Date; period2: Date }, signal: AbortSignal) => Promise<YahooDailyChart>;
const requestChart: YahooChartRequest = (symbol, range, signal) => yahoo.chart(symbol, {
  ...range, interval: "1d", includePrePost: false, events: "div|split", return: "array",
}, { fetchOptions: { signal } });

function friendlyError(error: unknown) {
  if (error instanceof YahooDataError) {
    if (error.status === 429) return new YahooDataError("Yahoo Finance membatasi request (429). Tunggu sebelum scan ulang.", 429);
    if (error.status === 401 || error.status === 403) return new YahooDataError(`Akses Yahoo Finance ditolak (${error.status}) dari server ini.`, error.status);
    if (error.status === 404) return new YahooDataError("Simbol atau histori tidak tersedia di Yahoo Finance (404).", 404);
    return error;
  }
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return new YahooDataError("Request Yahoo Finance timeout. Coba ulang nanti.");
  return new YahooDataError("Gagal membaca histori Yahoo Finance. Periksa koneksi atau ketersediaan simbol.");
}

/** Shared bounded history cache avoids refetching on every AI inspection. Failures are never cached. */
export function createYahooHistoryProvider(chartRequest: YahooChartRequest = requestChart, retryDelayMs = 750) {
  const cache = new Map<string, DailyHistory>();
  const pending = new Map<string, Promise<DailyHistory>>();
  return async function getDailyHistory(symbol: string, from: string, to: string, force = false): Promise<DailyHistory> {
    const yahooSymbol = toYahooSymbol(symbol);
    const range = yahooDateRange(from, to);
    const key = `${yahooSymbol}:${from}:${to}`;
    const running = pending.get(key);
    if (running) return running;
    const cached = cache.get(key);
    if (!force && cached && isFreshSnapshot(cached.fetchedAt)) return cached;
    const task = (async () => {
      const now = new Date();
      let chart: YahooDailyChart;
      try {
        try { chart = await chartRequest(yahooSymbol, range, AbortSignal.timeout(20_000)); }
        catch (error) {
          // One retry for transient transport/5xx failures, never for denial/rate limits.
          const retryable = error instanceof TypeError || (error instanceof YahooDataError && !!error.status && error.status >= 500);
          if (!retryable) throw error;
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          chart = await chartRequest(yahooSymbol, range, AbortSignal.timeout(20_000));
        }
      } catch (error) { throw friendlyError(error); }
      const history = normalizeYahooChart(chart, yahooSymbol, from, to, now);
      cache.delete(key);
      if (cache.size >= 90) cache.delete(cache.keys().next().value!);
      cache.set(key, history);
      return history;
    })().finally(() => { pending.delete(key); });
    pending.set(key, task);
    return task;
  };
}

export const getDailyHistory = createYahooHistoryProvider();
