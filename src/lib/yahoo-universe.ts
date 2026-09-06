import { createHash } from "node:crypto";
import { isFreshSnapshot, jakartaClock } from "./market-data";
import { requestYahooScreen } from "./yahoo-finance";
import { toYahooSymbol } from "./yahoo-data";

export type UniverseStock = { symbol: string; name: string };
export type CandidateUniverse = {
  stocks: UniverseStock[]; id: string; fetchedAt: string;
  source: string; yahooMatches: number; excluded: number; filter: string; warnings: string[];
};
type Query = { operator: string; operands: (string | number | Query)[] };
const op = (operator: string, ...operands: Query["operands"]): Query => ({ operator, operands });

export function universeConfig() {
  const mode = process.env.SCREENER_MODE || "dynamic";
  if (mode !== "dynamic" && mode !== "watchlist") throw new Error("SCREENER_MODE harus dynamic atau watchlist.");
  const minimum = Number(process.env.SCREENER_MIN_TURNOVER ?? 5_000_000_000);
  if (!Number.isFinite(minimum) || minimum < 0) throw new Error("SCREENER_MIN_TURNOVER harus angka non-negatif dalam rupiah.");
  const symbols = mode === "watchlist" ? [...new Set((process.env.SCREENER_SYMBOLS || "").split(",").map(s => s.trim()).filter(Boolean).map(s => toYahooSymbol(s).slice(0, -3)))].sort() : [];
  if (mode === "watchlist" && !symbols.length) throw new Error("Isi SCREENER_SYMBOLS untuk mode watchlist.");
  return { mode, minimum, symbols, key: `yahoo-prefilter-v1:${mode}:${minimum}:${symbols.join(",")}` };
}

/** Yahoo cannot multiply fields. Price bands admit every stock whose price ×
 * avgdailyvol3m reaches the threshold; the exact proxy is checked after paging.
 * The open-ended band has no volume floor, avoiding a hidden maximum price.
 */
export function buildYahooScreen(minimum: number, offset = 0) {
  const ceilings = [200, 500, 1000, 2000, 5000, 10000, 25000, 100000];
  const bands = ceilings.map((ceiling, index) => op("AND",
    op("GTE", "intradayprice", index ? ceilings[index - 1] : 0),
    op("LT", "intradayprice", ceiling), op("GTE", "avgdailyvol3m", minimum / ceiling)));
  bands.push(op("GTE", "intradayprice", ceilings.at(-1)!));
  return { offset, size: 250, sortField: "ticker", sortType: "ASC", quoteType: "EQUITY", userId: "", userIdType: "guid",
    query: op("AND", op("EQ", "region", "id"), op("EQ", "exchange", "JKT"), op("OR", ...bands)) };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Format filter Yahoo tidak valid.");
  return value as Record<string, unknown>;
}

export function createUniverseProvider(request = requestYahooScreen) {
  let cached: { key: string; value: CandidateUniverse } | undefined;
  let pending: { key: string; task: Promise<CandidateUniverse> } | undefined;
  return async function getUniverse(force = false): Promise<CandidateUniverse> {
    const config = universeConfig();
    if (pending?.key === config.key) return pending.task;
    if (!force && cached?.key === config.key && isFreshSnapshot(cached.value.fetchedAt)) return cached.value;
    const task = (async () => {
      const fetchedAt = new Date().toISOString();
      const stocks = new Map<string, UniverseStock>();
      let total = 0; let offset = 0; let excluded = 0;
      if (config.mode === "watchlist") {
        for (const symbol of config.symbols) stocks.set(symbol, { symbol, name: symbol });
      } else {
        const seen = new Set<string>();
        do {
          const finance = record(record(await request(buildYahooScreen(config.minimum, offset))).finance);
          if (finance.error || !Array.isArray(finance.result) || finance.result.length !== 1) throw new Error("Yahoo tidak mengembalikan hasil filter yang valid.");
          const page = record(finance.result[0]);
          if (!Number.isSafeInteger(page.total) || Number(page.total) < 0 || page.start !== offset || !Array.isArray(page.quotes) || page.quotes.length > 250) throw new Error("Pagination filter Yahoo tidak valid.");
          if (offset && page.total !== total) throw new Error("Hasil filter Yahoo berubah saat pagination. Scan ulang untuk cakupan konsisten.");
          total = Number(page.total);
          if (offset + page.quotes.length > total || (!page.quotes.length && offset < total)) throw new Error("Halaman filter Yahoo tidak lengkap.");
          for (const value of page.quotes) {
            const quote = record(value);
            if (typeof quote.symbol !== "string" || seen.has(quote.symbol)) throw new Error("Simbol kosong/duplikat pada pagination Yahoo; scan ulang.");
            seen.add(quote.symbol);
            const price = quote.regularMarketPrice; const volume = quote.averageDailyVolume3Month;
            if (!/^[A-Z]{4}\.JK$/.test(quote.symbol) || quote.exchange !== "JKT" || quote.quoteType !== "EQUITY" || quote.currency !== "IDR" || typeof price !== "number" || !Number.isFinite(price) || price <= 0 || typeof volume !== "number" || !Number.isFinite(volume) || volume < 0 || price * volume < config.minimum) { excluded++; continue; }
            const symbol = quote.symbol.slice(0, -3);
            const name = typeof quote.longName === "string" ? quote.longName : typeof quote.shortName === "string" ? quote.shortName : symbol;
            stocks.set(symbol, { symbol, name });
          }
          offset += page.quotes.length;
        } while (offset < total);
      }
      const sorted = [...stocks.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
      // Stable across server instances within the same candle-publication period.
      const clock = jakartaClock(new Date(fetchedAt));
      const id = createHash("sha256").update(`${config.key}:${clock.date}:${clock.minutes >= 990}:${sorted.map(s => s.symbol).join(",")}`).digest("hex");
      const value: CandidateUniverse = { stocks: sorted, id, fetchedAt, source: config.mode === "dynamic" ? "Yahoo custom screener · JKT" : "Watchlist manual", yahooMatches: total, excluded,
        filter: config.mode === "dynamic" ? `Estimasi nilai transaksi: harga × volume rata-rata 3 bulan ≥Rp${config.minimum.toLocaleString("id-ID")}` : "Daftar saham manual tanpa batas jumlah",
        warnings: config.mode === "dynamic" ? ["Filter awal memakai kuotasi tertunda dan rata-rata volume 3 bulan; bukan nilai transaksi 20 sesi. Kandidat yang baru likuid dapat terlewat.", ...(excluded ? [`${excluded} hasil Yahoo tersaring oleh estimasi nilai transaksi atau validasi simbol/metadata.`] : [])] : [] };
      cached = { key: config.key, value };
      return value;
    })();
    pending = { key: config.key, task };
    try { return await task; } finally { if (pending?.task === task) pending = undefined; }
  };
}

export const getCandidateUniverse = createUniverseProvider();
