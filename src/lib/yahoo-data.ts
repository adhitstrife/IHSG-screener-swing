import { jakartaClock, normalizeDailyCandles, type MarketCandle } from "./market-data";

// Include provider and adjustment policy in persistence keys, independently of strategy rules.
export const YAHOO_DATA_VERSION = "yahoo-daily-ohlcv-v1";
export const YAHOO_SOURCE = "Yahoo Finance";
export const YAHOO_PRICE_BASIS = "split-adjusted-ohlcv";

export type DailyHistory = {
  symbol: string;
  yahooSymbol: string;
  candles: MarketCandle[];
  source: string;
  dataVersion: string;
  priceBasis: string;
  fetchedAt: string;
  splits: { date: string; ratio: string }[];
  warnings: string[];
};

export function toYahooSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase().replace(/\.JK$/, "");
  if (!/^[A-Z]{4}$/.test(normalized)) throw new Error("Masukkan kode saham IDX 4 huruf, misalnya BBCA atau BBCA.JK.");
  return `${normalized}.JK`;
}

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00+07:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || jakartaClock(date).date !== value) throw new Error("Rentang tanggal histori tidak valid.");
  return date;
}

/** Public date range is inclusive; Yahoo period2 is exclusive. */
export function yahooDateRange(from: string, to: string) {
  const period1 = parseDate(from);
  const period2 = parseDate(to);
  if (period1 > period2) throw new Error("Tanggal awal histori harus sebelum tanggal akhir.");
  period2.setUTCDate(period2.getUTCDate() + 1);
  return { period1, period2 };
}

type YahooQuote = { date: Date; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null; adjclose?: number | null };
export type YahooDailyChart = {
  meta: { symbol: string; currency: string; exchangeName: string; exchangeTimezoneName: string; dataGranularity: string };
  quotes: YahooQuote[];
  events?: { splits?: { date: Date; numerator: number; denominator: number; splitRatio: string }[] };
};

/** Yahoo OHLC is already split-adjusted. Never substitute adjclose (also dividend-adjusted),
 * apply splits twice, or manufacture foreign-flow values that this source doesn't provide. */
export function normalizeYahooChart(chart: YahooDailyChart, symbol: string, from: string, to: string, now = new Date()): DailyHistory {
  const yahooSymbol = toYahooSymbol(symbol);
  const meta = chart?.meta;
  if (meta?.symbol !== yahooSymbol || meta.currency !== "IDR" || meta.exchangeName !== "JKT" || meta.exchangeTimezoneName !== "Asia/Jakarta" || meta.dataGranularity !== "1d") throw new Error(`Metadata Yahoo ${yahooSymbol} bukan candle harian saham IDX dalam Rupiah.`);
  if (!Array.isArray(chart.quotes)) throw new Error(`Histori Yahoo ${yahooSymbol} tidak tersedia.`);
  const clock = jakartaClock(now);
  const emptyDates: string[] = [];
  const rows = chart.quotes.flatMap((quote) => {
    if (!(quote.date instanceof Date) || !Number.isFinite(quote.date.getTime())) throw new Error(`Timestamp Yahoo ${yahooSymbol} tidak valid.`);
    const date = jakartaClock(quote.date).date;
    if (date < from || date > to || date > clock.date || (date === clock.date && clock.minutes < 990)) return [];
    // Yahoo emits all-null bars on some IDX holidays, including weekdays.
    // They are not trading sessions. Partially missing OHLC or positive volume
    // without prices still fail validation instead of being silently dropped.
    if ([quote.open, quote.high, quote.low, quote.close].every((value) => value === null) && (quote.volume === null || quote.volume === 0)) {
      emptyDates.push(date);
      return [];
    }
    return [{ date, open: quote.open, high: quote.high, low: quote.low, close: quote.close, volume: quote.volume }];
  });
  const candles = normalizeDailyCandles(rows);
  if (candles.length < 7) throw new Error(`Histori Yahoo ${yahooSymbol} tidak cukup (${candles.length} candle lengkap).`);
  const splits = (chart.events?.splits ?? []).map((split) => {
    if (!(split.date instanceof Date) || !Number.isFinite(split.date.getTime()) || !Number.isFinite(split.numerator) || !Number.isFinite(split.denominator) || split.numerator <= 0 || split.denominator <= 0) throw new Error(`Data split Yahoo ${yahooSymbol} tidak valid.`);
    return { date: jakartaClock(split.date).date, ratio: `${split.numerator}:${split.denominator}` };
  }).filter((split) => split.date >= from && split.date <= candles.at(-1)!.date);
  return {
    symbol: yahooSymbol.slice(0, -3), yahooSymbol, candles, source: YAHOO_SOURCE,
    dataVersion: YAHOO_DATA_VERSION, priceBasis: YAHOO_PRICE_BASIS, fetchedAt: now.toISOString(), splits,
    warnings: [
      ...(splits.length ? ["Histori memuat stock split; OHLCV memakai penyesuaian split Yahoo, tanpa penyesuaian ulang."] : []),
      ...(emptyDates.length ? [`${emptyDates.length} bar Yahoo tanpa harga/volume dilewati (libur atau tidak ada data); tidak dihitung sebagai sesi.`] : []),
    ],
  };
}
