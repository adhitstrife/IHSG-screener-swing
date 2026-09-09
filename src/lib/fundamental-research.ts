import { Firecrawl } from "firecrawl";

type YahooPoint = { asOfDate?: unknown; currencyCode?: unknown; reportedValue?: { raw?: unknown } };
type YahooSeries = { [key: string]: unknown; meta?: { symbol?: unknown; type?: unknown } };

export type FundamentalMetric = { value: number; asOf: string; currency?: string };
export type FundamentalResearch = {
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: FundamentalMetric | null;
  annualRevenue: FundamentalMetric | null;
  annualNetIncome: FundamentalMetric | null;
  annualDilutedEps: FundamentalMetric | null;
  revenueGrowthPercent: number | null;
  netIncomeGrowthPercent: number | null;
  epsGrowthPercent: number | null;
  warnings: string[];
};

export type WebSource = { title: string; url: string; snippet: string; publishedDate: string | null };
export type WebResearch = { coverage: "available" | "not-configured" | "unavailable"; provider: "firecrawl" | "tavily" | null; sources: WebSource[]; warning: string | null };

const researchCache = new Map<string, { expiresAt: number; value: Promise<{ fundamentals: FundamentalResearch; web: WebResearch }> }>();
const TTL_MS = 15 * 60 * 1000;

function finite(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; }
}

function metric(point: unknown): FundamentalMetric | null {
  if (!point || typeof point !== "object") return null;
  const item = point as YahooPoint;
  const value = finite(item.reportedValue?.raw); const asOf = text(item.asOfDate);
  return value === undefined || !asOf ? null : { value, asOf, currency: text(item.currencyCode) ?? undefined };
}

function seriesPoints(result: YahooSeries | undefined, key: string) {
  const points = Array.isArray(result?.[key]) ? result?.[key] : [];
  return points.map(metric).filter((point): point is FundamentalMetric => point !== null).sort((a, b) => a.asOf.localeCompare(b.asOf));
}

function latestAndGrowth(result: YahooSeries | undefined, key: string) {
  const points = seriesPoints(result, key);
  const latest = points.at(-1) ?? null; const prior = points.at(-2);
  const growth = latest && prior && prior.value !== 0 ? (latest.value / prior.value - 1) * 100 : null;
  return { latest, growth };
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { "user-agent": "IDX-Swing-Screener/1.0" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Sumber merespons ${response.status}.`);
  return response.json() as Promise<unknown>;
}

async function fundamentals(symbol: string): Promise<{ research: FundamentalResearch; companyQuery: string }> {
  const end = Math.floor(Date.now() / 1000); const start = end - 6 * 365 * 24 * 60 * 60;
  const profileUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(`${symbol}.JK`)}&quotesCount=1&newsCount=0`;
  const seriesUrl = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(`${symbol}.JK`)}?type=annualTotalRevenue,annualNetIncome,annualDilutedEPS,trailingMarketCap&merge=false&period1=${start}&period2=${end}`;
  const [profileResult, seriesResult] = await Promise.allSettled([fetchJson(profileUrl), fetchJson(seriesUrl)]);
  const warnings: string[] = [];
  const profile = profileResult.status === "fulfilled" && profileResult.value && typeof profileResult.value === "object" ? profileResult.value as { quotes?: unknown } : undefined;
  const quote = Array.isArray(profile?.quotes) ? profile.quotes.find((item) => item && typeof item === "object" && (item as { symbol?: unknown }).symbol === `${symbol}.JK`) as { longname?: unknown; shortname?: unknown; sectorDisp?: unknown; industryDisp?: unknown } | undefined : undefined;
  if (profileResult.status === "rejected") warnings.push("Profil emiten Yahoo Finance belum tersedia.");
  const series = seriesResult.status === "fulfilled" && seriesResult.value && typeof seriesResult.value === "object" ? seriesResult.value as { timeseries?: { result?: unknown; error?: unknown } } : undefined;
  const results = Array.isArray(series?.timeseries?.result) ? series?.timeseries?.result.filter((item): item is YahooSeries => !!item && typeof item === "object") : [];
  const byType = (type: string) => results.find((item) => Array.isArray(item.meta?.type) && item.meta.type.includes(type));
  if (seriesResult.status === "rejected" || series?.timeseries?.error) warnings.push("Data laporan keuangan Yahoo Finance belum lengkap.");
  const revenue = latestAndGrowth(byType("annualTotalRevenue"), "annualTotalRevenue");
  const netIncome = latestAndGrowth(byType("annualNetIncome"), "annualNetIncome");
  const eps = latestAndGrowth(byType("annualDilutedEPS"), "annualDilutedEPS");
  const marketCap = latestAndGrowth(byType("trailingMarketCap"), "trailingMarketCap").latest;
  const companyName = text(quote?.longname) ?? text(quote?.shortname);
  return {
    research: { companyName, sector: text(quote?.sectorDisp), industry: text(quote?.industryDisp), marketCap, annualRevenue: revenue.latest, annualNetIncome: netIncome.latest, annualDilutedEps: eps.latest, revenueGrowthPercent: revenue.growth, netIncomeGrowthPercent: netIncome.growth, epsGrowthPercent: eps.growth, warnings },
    companyQuery: companyName ?? `${symbol} saham IDX`,
  };
}

function webSources(items: unknown[]): WebSource[] {
  const seen = new Set<string>();
  return items.flatMap((item): WebSource[] => {
    if (!item || typeof item !== "object") return [];
    const result = item as { title?: unknown; url?: unknown; description?: unknown; snippet?: unknown; date?: unknown; markdown?: unknown; metadata?: { title?: unknown; url?: unknown; sourceURL?: unknown; publishedTime?: unknown; publishedDate?: unknown } };
    const url = safeUrl(result.url) ?? safeUrl(result.metadata?.url) ?? safeUrl(result.metadata?.sourceURL);
    const title = text(result.title) ?? text(result.metadata?.title);
    if (!url || !title || seen.has(url)) return [];
    seen.add(url);
    const snippet = text(result.markdown) ?? text(result.snippet) ?? text(result.description) ?? "";
    return [{ title: title.slice(0, 240), url, snippet: snippet.slice(0, 1_800), publishedDate: text(result.date) ?? text(result.metadata?.publishedTime) ?? text(result.metadata?.publishedDate) }];
  }).slice(0, 5);
}

async function firecrawlSearch(symbol: string, companyQuery: string): Promise<WebResearch | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new Firecrawl({ apiKey });
    const result = await client.search(`${companyQuery} ${symbol} IDX Indonesia berita kinerja keuangan aksi korporasi`, {
      sources: ["news", "web"], limit: 5, tbs: "qdr:m", country: "ID", ignoreInvalidURLs: true, timeout: 25_000,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true, fastMode: true, blockAds: true, removeBase64Images: true, timeout: 20_000, maxAge: 86_400_000, storeInCache: true },
    });
    const sources = webSources([...(result.news ?? []), ...(result.web ?? [])]);
    return { coverage: sources.length ? "available" : "unavailable", provider: "firecrawl", sources, warning: sources.length ? null : "Firecrawl tidak menemukan sumber yang relevan dalam 30 hari terakhir." };
  } catch (error) {
    return { coverage: "unavailable", provider: "firecrawl", sources: [], warning: error instanceof Error ? `Firecrawl gagal: ${error.message}` : "Firecrawl gagal." };
  }
}

async function tavilySearch(symbol: string, companyQuery: string): Promise<WebResearch> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { coverage: "not-configured", provider: null, sources: [], warning: "Pencarian web belum dikonfigurasi." };
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query: `${companyQuery} ${symbol} IDX Indonesia berita kinerja keuangan aksi korporasi`, topic: "news", search_depth: "basic", days: 30, max_results: 5, include_answer: false, include_raw_content: false }),
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Pencarian web merespons ${response.status}.`);
    const payload = await response.json() as { results?: unknown };
    const seen = new Set<string>();
    const sources = (Array.isArray(payload.results) ? payload.results : []).flatMap((item): WebSource[] => {
      if (!item || typeof item !== "object") return [];
      const result = item as { title?: unknown; url?: unknown; content?: unknown; published_date?: unknown };
      const url = safeUrl(result.url); const title = text(result.title);
      if (!url || !title || seen.has(url)) return [];
      seen.add(url);
      return [{ title: title.slice(0, 240), url, snippet: (text(result.content) ?? "").slice(0, 1_200), publishedDate: text(result.published_date) }];
    });
    return { coverage: "available", provider: "tavily", sources, warning: sources.length ? null : "Tidak ada hasil web relevan dalam 30 hari terakhir." };
  } catch (error) {
    return { coverage: "unavailable", provider: "tavily", sources: [], warning: error instanceof Error ? error.message : "Pencarian web gagal." };
  }
}

async function webSearch(symbol: string, companyQuery: string): Promise<WebResearch> {
  const firecrawl = await firecrawlSearch(symbol, companyQuery);
  if (firecrawl?.coverage === "available") return firecrawl;
  const tavily = await tavilySearch(symbol, companyQuery);
  if (tavily.coverage === "available") return { ...tavily, warning: firecrawl?.warning ? `${firecrawl.warning} Memakai fallback Tavily.` : null };
  return firecrawl ?? tavily;
}

export function getFundamentalAndWebResearch(symbol: string) {
  const cached = researchCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = fundamentals(symbol).then(async ({ research, companyQuery }) => ({ fundamentals: research, web: await webSearch(symbol, companyQuery) }));
  researchCache.set(symbol, { expiresAt: Date.now() + TTL_MS, value });
  return value;
}
