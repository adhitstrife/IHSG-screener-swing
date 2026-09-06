# IDX Swing Screener

An Indonesian-language IDX screener for multi-session swing setups. The dashboard, AI context and daily backtest share one deterministic strategy engine. The intended horizon is 3–15 trading sessions; stops and targets can exit sooner.

## Run locally

Requires Node.js 22.x (also selected by package.json for deployment), Next.js 16, and yahoo-finance2 4.0.2.

```bash
npm install
# Optional: copy .env.example to .env.local for storage, AI, or a custom universe.
npm run dev
```

Open http://localhost:3000. Yahoo Finance market data requires no API key or Yahoo account. Supabase is optional for scanning; the app uses a process cache when persistent storage is absent. AI analysis separately requires `YOGATHEDEV_AI_API_KEY`. Existing RapidAPI environment values are unused and can be removed from your deployment.

Optional configuration:

| Variable | Default / purpose |
| --- | --- |
| `SCREENER_MODE` | `dynamic`: discover candidates using Yahoo custom filters; `watchlist` selects the manual list |
| `SCREENER_MIN_TURNOVER` | `5000000000` rupiah: minimum current price × 3-month average share volume; set `0` to remove this liquidity threshold |
| `SCREENER_SYMBOLS` | Only used in watchlist mode: comma-separated four-letter symbols, optionally `.JK`; no count cap |
| `BACKTEST_SYMBOLS` | Separate historical reference list; defaults to BBRI,BBCA,TLKM,ANTM,ASII,BMRI,INDF,ICBP,UNTR,KLBF |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional browser/session authentication key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for persistent scan history |
| `CRON_SECRET` | Bearer secret for the scheduled scan endpoint |
| `YOGATHEDEV_AI_API_KEY` | Server-only AI provider key |
| `YOGATHEDEV_AI_MODEL` | Existing configured model, default `deepseek-v4-flash` |

Do not commit real credentials. Dynamic discovery is the default even if an old SCREENER_SYMBOLS value exists. The scanner requests Indonesian JKT equities using price/volume bands in Yahoo's custom POST screener, pages through **all** results (250 per page), then checks the exact turnover proxy and symbol/currency metadata. There is no fixed total-stock limit or silent fallback to ten stocks. The default Rp5 billion proxy is a loose preliminary filter, not the strategy's prior-20-session turnover calculation; recently liquid stocks can be missed and missing Yahoo volume fields are excluded with coverage counts. No market-cap or daily-gainer filter is imposed.

The dashboard analyzes only the selected page of **10 candidates**, ordered by symbol before analysis. GET /api/screener?page=1 returns a single page with totalPages and universeId; it never auto-follows other pages. Previous/next and a page selector load pages on demand. Score/setup/search filters and ranking are page-local, so a page may show fewer than ten results. All results are shown by default. Coverage and setup counts describe only the current page.

Visited pages use a browser memory cache and a server process cache for up to 15 minutes, with the same daily publication cutoff rule. Supabase optionally stores each complete page under a separate universe/page key; no need to finish every page first. Returning to a fresh visited page makes no API call and does not repeat analysis. Refresh updates the selected page and discovery; a changed universe invalidates the browser page cache. Expired results are reloaded when revisited. Aborted navigation cannot replace the active page with an older response. Candidate changes or out-of-range pages return HTTP 409 and reset navigation to page one for an explicit reload. Discovery still fetches all lightweight candidate quotes, but historical OHLCV and swing evaluation are restricted to the selected ten symbols.

The custom adapter uses the pinned client's internal _fetch because its public screener supports only predefined screens. A normal GET quote initializes Yahoo's session before the POST request. Integration-test this boundary before upgrading yahoo-finance2.

## Swing rules

`src/lib/swing-strategy.ts` defines the versioned rules (`swing-v1`). A high score alone never overrides a failed eligibility filter.

- At least 60 completed daily candles. The scanner requests 240 calendar days of history, normalizes numeric fields, sorts dates, deduplicates matching candles and rejects inconsistent data.
- Trend: close > SMA20 > SMA50, with SMA50 above its value five sessions earlier.
- Momentum: 20-session return >0 and Wilder RSI14 between 45 and 75.
- Liquidity: prior 20-session average turnover ≥Rp10 billion, median ≥Rp5 billion, at least 18 active candles, and positive signal-day volume. Turnover is the proxy close × shares, not reported traded value. Today's spike does not enter the baseline.
- Breakout: close above the preceding 20-session high, relative volume ≥1.5, and close in the top 35% of the candle.
- Pullback: bullish recovery near EMA20 (within 1 ATR), low within 0.5 ATR above EMA20, close above the previous close, RSI 45–65, relative volume ≥0.8, and close in the top 40%.
- Volatility: ATR14 between 1% and 6% of price; extension above EMA20 ≤2.5 ATR. ATR and RSI use Wilder smoothing. Recent close-to-close moves exceeding 35% require data/corporate-action review and block eligibility.
- Risk: stop below the recent five-session low with a 0.25 ATR buffer, and at least 1.5 ATR from reference entry. Price risk must be ≤8%. This is a price-distance filter, not an account-risk or position-sizing recommendation.
- Target: the lower of a 3R projection and the nearest overhead high in the prior 59 candles, less a tick. A 3R projection is a planning assumption, not an observed resistance level. Nearby resistance is never ignored to manufacture a favorable R:R.
- Net reward-to-risk must be ≥2 after assumed buy fee 0.15%, sell fee 0.25%, and slippage 0.10% per side. Indicative levels use the signal close's regular-market price fraction; check the applicable trading-day tick before placing orders.

The score totals 100: trend 25, momentum 15, volume 15, setup 20, liquidity 10, risk 15. Default eligibility requires ≥70 plus every mandatory filter. These are explicit strategy hypotheses, not profit-optimized or out-of-sample-validated settings.

## Entry and exits

The signal uses completed candles only. Entry is modeled at the next session's open, within a ±0.5 ATR band further restricted by the net R:R and price-risk limits. If opening is outside that zone, the signal expires; rescan rather than chase.

Stop and target are active from entry. Starting on holding session 3, a close below EMA20 triggers exit on the following open. Otherwise exit at the close of holding session 15. Gap stops can execute below the intended stop price.

The AI explains the same indicators and filters. It cannot activate a rejected setup or replace the engine's entry/stop/target levels. AI context contains Yahoo daily OHLCV and the same computed indicators. Broker accumulation, foreign flows and news are not connected, and no placeholder flow values are fabricated.

## Data quality and storage

- Source: Yahoo Finance via the pinned server-side `yahoo-finance2` client. Four-letter symbols map to `.JK`; metadata must confirm IDX/Jakarta, IDR and daily granularity. Yahoo lists an approximately 10-minute IDX quote delay.
- Current-day candles are excluded until 16:30 Asia/Jakarta (a conservative post-close publication buffer). Requests use an inclusive date range translated to Yahoo's exclusive `period2`; timestamps are mapped to Jakarta trading dates.
- Yahoo sometimes emits all-null holiday bars. Rows with all four OHLC values null and null/zero volume are skipped with a coverage note, never counted as sessions or forward-filled. Partially missing completed bars and conflicting duplicate sessions are rejected.
- OHLC and share volume retain Yahoo's split-adjusted basis. Split events are recorded for context; ratios are not applied a second time. Dividend-adjusted `adjclose` is not mixed into OHLC or displayed as a tradable entry/stop/target. The backtest measures price return after trading costs, excluding cash dividends. Yahoo adjustments are not independently audited.
- A date lagging the newest successful symbol or older than three weekdays is ineligible. Weekdays are a heuristic: there is no IDX holiday calendar or benchmark feed.
- A failed symbol produces an explicit coverage warning while valid symbols remain visible. Access denial (401/403) and rate limits (429) stop further requests. All-history failures are reported; valid zero-candidate queries return an empty result.
- Concurrent scans and identical history requests share in-flight work. Yahoo requests have at most three concurrent requests per process, 500 ms start spacing and a 20-second timeout; each page uses up to three history workers for its ten candidates. Transport/5xx failures receive one bounded retry; denials/rate limits do not. The queue is per process, not distributed. Histories use a bounded cache of 90 symbol/date-range entries; manual scan refresh bypasses both history and scan caches.
- Process and Supabase caches expire after 15 minutes and cannot cross the daily publication cutoff. Generation timestamps are retained on cache reads. Persistent cache keys include the provider data version and price-adjustment policy, so previous RapidAPI results cannot be served as Yahoo scans.
- Apply `supabase/migrations/202609060001_swing_screener.sql` to your Supabase database before using persistent swing history. It creates a separate RLS-protected snapshot table; old BSJP runs remain intact and cannot be loaded as swing results. Each snapshot is saved atomically. Storage failure is a warning on the interactive scan, not a loss of market results.
- Scheduled scans run at 10:00 UTC / 17:00 WIB on weekdays (`vercel.json`). Cron requires Supabase and `CRON_SECRET`; the old intraday history sync is no longer part of this job. The scheduled job now warms only page one, rather than scanning the entire candidate list. Interactive and cron routes request 240 seconds; ensure hosting supports that timeout.

## Historical evaluation

`/api/backtest` and `/api/backtest/research` use the same swing engine on up to two years of daily data. The dashboard runs this only when requested, since it makes additional Yahoo history requests. Research reports `unvalidated`; positive historical returns do not prove a live edge. The previous intraday research endpoint returns HTTP 410 with the swing replacement endpoint.

Execution assumptions:

- No signal-close entry or future candles in signal indicators.
- One position per symbol. Stop-first when a daily candle touches both stop and target; opening gaps checked before intraday ranges.
- Complete 15-session windows are required for a signal to be simulated. Unexecutable open positions (for example suspension preventing any exit) fail evaluation rather than disappear from returns.
- Portfolio results allocate equal initial cash to each symbol, compound within each allocation and retain idle cash. Drawdown uses daily liquidation-value marks. Overlapping trades are not multiplied as though they used the same capital sequentially.
- Fractional position sizes are used; lot rounding, bid/ask queues, auto-rejection, market impact, cash dividends and board/suspension status are not fully modeled. Historical ticks/levels on Yahoo's split-adjusted price scale are approximate, not reconstructed historical order prices. The separate reference watchlist introduces survivorship bias. Backtests deliberately do not select symbols using today’s dynamic liquidity filter; this avoids adding look-ahead selection based on today’s data. It is not a backtest of historical Yahoo candidate discovery.

## Verification

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Tests use deterministic synthetic candles and mocked Yahoo responses; they make no external requests. They cover indicator arithmetic, malformed input, duplicate/order normalization, daily cutoff/cache expiry, liquidity traps, resistance-limited setups, next-open entry, gap and ambiguous exits, holding period, and concurrent scans/partial failures. Generated test files are ignored under `.test-build/`.

Live Yahoo data checks were performed during migration, including BBCA schema/price/volume verification and the configured ten-stock scan. These verify compatibility, not profitability. Automated tests also cover Yahoo ticker mapping, Jakarta date ranges, holiday placeholders, adjustment consistency, metadata validation, retries and caching. Desktop/mobile browser checks exercise filters and AI links.

## References

Indicator definitions: [Fidelity ATR](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr) and [Fidelity RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI). Trading sessions, 100-share lots and price fractions: [IDX trading hours and mechanism](https://www.idx.id/en/products-services/trading-hours-and-mechanism/), checked September 6, 2026. Strategy thresholds are application choices, not rules prescribed by these sources.

## Yahoo deployment checks

Run the production build on Node 22 and verify `/api/screener?refresh=1` from the actual deployment host. Yahoo access is unofficial and can be blocked or rate-limited by server IP; local success does not establish availability on Vercel. The app reports these failures instead of falling back to fabricated data. No Yahoo cookies, credentials or API keys need to be configured. Existing Supabase schema works unchanged because provider identity is part of the snapshot cache key.

Provider references: [Yahoo exchange coverage and data delay](https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html), [Yahoo adjusted close definition](https://help.yahoo.com/kb/SLN28256.html), and [yahoo-finance2 documentation](https://github.com/gadicc/yahoo-finance2). Public redistribution rights are separate from technical API access; Yahoo's data-use terms still apply.
