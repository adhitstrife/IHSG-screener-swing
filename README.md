# IDX Swing Screener

An Indonesian-language IDX screener for multi-session swing setups. The dashboard, AI context and daily backtest share one deterministic strategy engine. The intended horizon is 3–15 trading sessions; stops and targets can exit sooner.

## Run locally

Requires Node.js 22.x (also selected by package.json for deployment), Next.js 16, and yahoo-finance2 4.0.2.

```bash
npm install
# Optional: copy .env.example to .env.local for storage, AI, or a custom universe.
npm run dev
```

Open http://localhost:3000. Yahoo Finance market data requires no API key or Yahoo account. The dashboard reads the daily scan snapshot from Supabase; AI analysis separately requires `YOGATHEDEV_AI_API_KEY`. Existing RapidAPI environment values are unused and can be removed from your deployment.

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
| `TAVILY_API_KEY` | Optional server-only key for web research in `/analysis`; without it, AI uses Yahoo fundamental data only |

Do not commit real credentials. Dynamic discovery is the default even if an old SCREENER_SYMBOLS value exists. The scanner requests Indonesian JKT equities using price/volume bands in Yahoo's custom POST screener, pages through **all** results (250 per page), then checks the exact turnover proxy and symbol/currency metadata. There is no fixed total-stock limit or silent fallback to ten stocks. The default Rp5 billion proxy is a loose preliminary filter, not the strategy's prior-20-session turnover calculation; recently liquid stocks can be missed and missing Yahoo volume fields are excluded with coverage counts. No market-cap or daily-gainer filter is imposed.

The daily scan analyzes every dynamic Yahoo candidate, ranks the complete result set, and saves one atomic snapshot in Supabase. `GET /api/screener` only reads that stored snapshot; it never calls Yahoo Finance. Score/setup/search filters and ranking apply to the entire result set before the browser divides it into pages of ten. A score-90 stock is therefore returned by a score-80 filter regardless of its original alphabetical position.

The authenticated `/api/cron/screener` endpoint is the write boundary. It processes three symbols per request and stores its server-created batch. When a user opens the dashboard and the latest snapshot is stale, `GET /api/screener` immediately returns the prior snapshot, then starts the first authenticated batch after its response. Each batch schedules the next one until the final batch atomically publishes the complete snapshot. A failed batch does not overwrite the prior stored run. This on-demand flow needs no scheduler; when no visitor opens the dashboard after market close, the prior snapshot remains until the first later visit triggers refresh.

The custom adapter uses the pinned client's internal _fetch because its public screener supports only predefined screens. A normal GET quote initializes Yahoo's session before the POST request. Integration-test this boundary before upgrading yahoo-finance2.

## Swing rules

`src/lib/swing-strategy.ts` defines the versioned rules (`swing-v3`) in one configuration object. A high Setup Quality alone never makes an extended or high-risk entry actionable.

- At least 120 valid completed daily sessions. The scanner requests 360 calendar days, normally yielding roughly 120–250 sessions. Missing OHLC or null-volume bars are skipped and tracked; zero-volume bars remain sessions and are penalized by liquidity rules.
- Trend: close > SMA20 > SMA50 and a positive 10-session SMA50 slope.
- Relative strength: 20-session stock return minus IHSG 20-session return. IHSG is classified bullish, neutral, or bearish from its own SMA20/SMA50 structure.
- Liquidity: prior 20-session average turnover ≥Rp10 billion, median ≥Rp5 billion, at least 18 positive-volume sessions, and positive signal-day volume. Average/median share volume and turnover are reported separately.
- Breakout: close above the **previous** 20-session high, volume ratio ≥1.5, close location ≥0.70, bullish trend, valid liquidity, and no excessive EMA20 extension.
- Pullback: a bullish recovery at EMA20 in an uptrend, with a contained pullback low and volume no larger than the preceding bullish impulse baseline.
- Entry Quality uses EMA20 extension in ATR, technical price risk, net R:R, RSI state, position relative to the breakout, and close location. RSI above 70 and an extension above 2 ATR reduce Entry Quality rather than automatically rejecting a stock.
- Target: nearest overhead historical high observed across up to 220 sessions. A 3R target is used only where no valid resistance exists and is labelled `Projected 3R`; it is never presented as a resistance target.
- Net R:R includes assumed buy fee 0.15%, sell fee 0.25%, and slippage 0.10% per side. The dashboard starts with a user-selectable 1:1.5 filter; it can be changed without recalculating the technical snapshot.

Setup Quality totals 100: trend 25, structure 20, volume 15, momentum 15, relative strength 10, liquidity 10, market regime 5. Entry Quality totals 100: extension 25, risk 20, R:R 20, RSI/short-term momentum 15, breakout position 10, candle quality 10. Overall = Setup Quality ×60% + Entry Quality ×40%. Missing data, RSI above 70, extension above 2 ATR, risk above 10%, and weak data quality cap the relevant score.

## Entry and exits

The signal uses completed candles only. Entry is modeled at the next session's open, within a ±0.5 ATR band further restricted by the net R:R and price-risk limits. If opening is outside that zone, the signal expires; rescan rather than chase.

Stop and target are active from entry. Starting on holding session 3, a close below EMA20 triggers exit on the following open. Otherwise exit at the close of holding session 15. Gap stops can execute below the intended stop price.

The AI explains the same indicators and filters. It cannot activate a rejected setup or replace the engine's entry/stop/target levels. Its context includes Yahoo daily OHLCV plus Yahoo annual revenue, net income, diluted EPS and market capitalization. With `TAVILY_API_KEY`, it also receives a bounded set of recent web-search snippets and source links. Web snippets are treated as untrusted evidence, not instructions; when web search is unavailable, the result explicitly says so. Broker accumulation and foreign flows are not fabricated.

## Data quality and storage

- Source: Yahoo Finance via the pinned server-side `yahoo-finance2` client. Four-letter symbols map to `.JK`; metadata must confirm IDX/Jakarta, IDR and daily granularity. Yahoo lists an approximately 10-minute IDX quote delay.
- Current-day candles are excluded until 16:30 Asia/Jakarta (a conservative post-close publication buffer). Requests use an inclusive date range translated to Yahoo's exclusive `period2`; timestamps are mapped to Jakarta trading dates.
- Yahoo bars with missing OHLC or null volume are skipped with data-quality counters; they are never counted as sessions or forward-filled. A valid OHLC bar with volume zero is retained and marked as an illiquid session. Conflicting duplicate sessions are rejected.
- OHLC and share volume retain Yahoo's split-adjusted basis. Split events are recorded for context; ratios are not applied a second time. Dividend-adjusted `adjclose` is not mixed into OHLC or displayed as a tradable entry/stop/target. The backtest measures price return after trading costs, excluding cash dividends. Yahoo adjustments are not independently audited.
- A date lagging the newest successful symbol or older than three weekdays is ineligible. Weekdays are a heuristic: there is no IDX holiday calendar or benchmark feed.
- A failed symbol produces an explicit coverage warning while valid symbols remain visible. Access denial (401/403) and rate limits (429) stop further requests. All-history failures are reported; valid zero-candidate queries return an empty result.
- Concurrent scans and identical history requests share in-flight work. Yahoo requests have at most three concurrent requests per process, 500 ms start spacing and a 20-second timeout; each page uses up to three history workers for its ten candidates. Transport/5xx failures receive one bounded retry; denials/rate limits do not. The queue is per process, not distributed. Histories use a bounded cache of 90 symbol/date-range entries; manual scan refresh bypasses both history and scan caches.
- Process-level Yahoo history caches remain limited to 15 minutes; the completed Supabase snapshot remains valid through the next completed weekday session. Persistent cache keys include the provider data version and price-adjustment policy, so previous RapidAPI results cannot be served as Yahoo scans.
- Apply `supabase/migrations/202609060001_swing_screener.sql` to your Supabase database before enabling the dashboard. It creates `public.swing_screening_runs`, an RLS-protected table containing atomic, versioned scan snapshots; old BSJP runs remain separate. Vercel and Hermes do not schedule the screener job.

## Dividend calendar

`/dividends` lists announced IDX cash dividends from official KSEI documents. The purchase deadline is the published **Cum Dividen di Pasar Reguler & Pasar Negosiasi** date, not a date inferred from a provider’s ex-dividend field. It also displays the announced gross dividend per share, ex date, record date, payment date, and a source link.

Apply `supabase/migrations/202609070001_dividend_calendar.sql` before enabling the calendar. The Vercel deployment must have `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` configured for Production. KSEI announcements are parsed only by the authenticated `/api/cron/dividends` job; page visits read cached records and never download announcements or run stock analysis. The first import uses `GET /api/cron/dividends?bootstrap=1` with `Authorization: Bearer <CRON_SECRET>` to ingest the last 12 announcement months. `/dividends?bootstrap=1` is only the public calendar page and does not start an import. The daily Vercel cron then rechecks the current and prior two months at 06:00 WIB. Failed or incomplete source reads retain prior records and appear as synchronization warnings.

The calendar includes cash dividends for IDX shares only. It excludes stock dividends, rights issues, tax estimates, dividend yield calculations, and unannounced forecasts. KSEI can revise a schedule; a later notice with the same stock, regular-market cum date, and dividend type replaces the cached schedule and retains its official source URL.

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

Run the production build on Node 22, invoke authenticated batch POSTs to `/api/cron/screener` until `published: true`, then verify `/api/screener` from the actual deployment host. Yahoo access is unofficial and can be blocked or rate-limited by server IP; local success does not establish availability on Vercel. The app reports missing daily data instead of falling back to fabricated or partial results. No Yahoo cookies, credentials or API keys need to be configured. Existing Supabase schema works unchanged because provider identity is part of the snapshot cache key.

Provider references: [Yahoo exchange coverage and data delay](https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html), [Yahoo adjusted close definition](https://help.yahoo.com/kb/SLN28256.html), and [yahoo-finance2 documentation](https://github.com/gadicc/yahoo-finance2). Public redistribution rights are separate from technical API access; Yahoo's data-use terms still apply.
