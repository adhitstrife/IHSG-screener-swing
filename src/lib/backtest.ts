import { backtestUniverse } from "./backtest-universe";
import { getDailyHistory } from "./yahoo-finance";
import { YAHOO_DATA_VERSION, YAHOO_SOURCE } from "./yahoo-data";
import { calculateSwingTrades, portfolioMetrics, type SwingTrade } from "./swing-backtest";
import { STRATEGY_VERSION, SWING_RULES } from "./swing-strategy";
import { evaluateShortSwing, SHORT_SWING_RULES, SHORT_SWING_VERSION } from "./short-swing-strategy";

export type BacktestSummary = { from: string; to: string; trades: number; wins: number; winRate: number; averageGrossReturn: number; averageNetReturn: number; cumulativeNetReturn: number; maxDrawdown: number; buyFee: number; sellFee: number; slippage: number; averageHoldingSessions: number };
export type BacktestStock = { symbol: string; name: string; trades: number; winRate: number; averageNetReturn: number };
export type BacktestMode = "swing" | "short";
export type BacktestResult = { strategyVersion: string; mode: BacktestMode; dataVersion: string; source: string; summary: BacktestSummary; stocks: BacktestStock[]; trades: SwingTrade[]; assumptions: string[] };
const cache = new Map<BacktestMode, { expiresAt: number; data: BacktestResult }>();
const pending = new Map<BacktestMode, Promise<BacktestResult>>();
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export async function runBacktest(force = false, mode: BacktestMode = "swing"): Promise<BacktestResult> {
  const running = pending.get(mode); if (running) return running;
  const cached = cache.get(mode); if (!force && cached && cached.expiresAt > Date.now()) return cached.data;
  const task = executeBacktest(force, mode).finally(() => { pending.delete(mode); });
  pending.set(mode, task);
  return task;
}

async function executeBacktest(force: boolean, mode: BacktestMode): Promise<BacktestResult> {
  const now = new Date(); const from = new Date(now); from.setUTCFullYear(from.getUTCFullYear() - 2);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const benchmark = await getDailyHistory("^JKSE", iso(from), iso(now), force).catch(() => undefined);
  const series = [];
  const stocks: BacktestStock[] = [];
  for (const stock of backtestUniverse) {
    const { candles } = await getDailyHistory(stock.symbol, iso(from), iso(now), force);
    if (candles.length < SWING_RULES.minimumHistory + SWING_RULES.maxHoldingSessions + 1) throw new Error(`Histori ${stock.symbol} tidak cukup untuk backtest swing.`);
    const trades = mode === "short" ? calculateSwingTrades(stock.symbol, candles, 70, benchmark?.candles, evaluateShortSwing, SHORT_SWING_RULES.maxHoldingSessions) : calculateSwingTrades(stock.symbol, candles, SWING_RULES.minimumScore, benchmark?.candles);
    series.push({ candles, trades });
    stocks.push({ ...stock, trades: trades.length, winRate: trades.length ? trades.filter((trade) => trade.netReturn > 0).length / trades.length : 0, averageNetReturn: mean(trades.map((trade) => trade.netReturn)) });
  }
  const trades = series.flatMap((item) => item.trades).sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.symbol.localeCompare(b.symbol));
  const wins = trades.filter((trade) => trade.netReturn > 0).length;
  const data: BacktestResult = {
    strategyVersion: mode === "short" ? SHORT_SWING_VERSION : STRATEGY_VERSION, mode, dataVersion: YAHOO_DATA_VERSION, source: YAHOO_SOURCE,
    summary: { from: iso(from), to: iso(now), trades: trades.length, wins, winRate: trades.length ? wins / trades.length : 0, averageGrossReturn: mean(trades.map((trade) => trade.grossReturn)), averageNetReturn: mean(trades.map((trade) => trade.netReturn)), ...portfolioMetrics(series), buyFee: SWING_RULES.buyFee, sellFee: SWING_RULES.sellFee, slippage: SWING_RULES.slippage, averageHoldingSessions: mean(trades.map((trade) => trade.sessions)) },
    stocks, trades,
    assumptions: [
      "Watchlist referensi terpisah: " + backtestUniverse.map(stock => stock.symbol).join(", ") + ". Filter kandidat Yahoo hari ini tidak direkonstruksi historis; ini bukan backtest discovery dinamis.",
      mode === "short" ? "Aturan short swing identik dengan scanner: breakout momentum harian, entry hanya pada open sesi berikutnya dalam zona entry, maksimal dua sesi." : "Aturan swing identik dengan scanner; sinyal dari penutupan, entry hanya pada open sesi berikutnya dalam zona entry.",
      "Stop/target aktif sejak entry; bila keduanya tersentuh dalam satu candle, stop didahulukan. Gap stop memakai harga open.",
      mode === "short" ? "Posisi short yang belum menyentuh stop/target ditutup pada close sesi kedua. Jendela akhir yang belum lengkap tidak disimulasikan." : "Exit tren pada open berikutnya setelah close < EMA20 mulai sesi ke-3; time exit maksimal 15 sesi. Jendela akhir yang belum lengkap tidak disimulasikan.",
      "Fee beli 0,15%, jual 0,25%, slippage 0,10% per sisi adalah asumsi; sesuaikan broker. Tidak memodelkan antrean/auto-rejection.",
      "Return portofolio: modal sama per saham, satu posisi per saham, idle cash, mark-to-market harian; tidak mengalikan return posisi yang tumpang tindih.",
      "OHLC dan volume memakai data Yahoo yang disesuaikan split; adjusted close dividen tidak dicampur dengan OHLC. Dividen tunai tidak masuk return; fraksi historis setelah split adalah pendekatan.",
      "Universe saat ini memiliki survivorship bias. Suspensi, status papan dan kelengkapan penyesuaian Yahoo belum diverifikasi independen; belum merupakan bukti edge live. Ukuran lot tidak dimodelkan.",
    ],
  };
  cache.set(mode, { data, expiresAt: Date.now() + 60 * 60 * 1000 });
  return data;
}
