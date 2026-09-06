import type { MarketCandle } from "./market-data";
import { ema, evaluateSwing, netRewardRisk, SWING_RULES, type SwingPlan } from "./swing-strategy";

export type SwingTrade = {
  symbol: string; signalDate: string; entryDate: string; exitDate: string;
  entry: number; exit: number; sessions: number;
  exitReason: "stop" | "target" | "trend" | "time";
  grossReturn: number; netReturn: number;
};

/** Next-session open only; unfilled signals expire after that opening. */
export function simulateSwingTrade(candles: MarketCandle[], signalIndex: number, plan: SwingPlan, symbol: string): SwingTrade | undefined {
  const entryIndex = signalIndex + 1;
  const opening = candles[entryIndex];
  if (!opening || opening.volume <= 0 || opening.open < plan.entryMin || opening.open > plan.entryMax || opening.open <= plan.stop || opening.open >= plan.target) return undefined;
  if (netRewardRisk(opening.open, plan.stop, plan.target) < SWING_RULES.minNetRewardRisk || (opening.open - plan.stop) / opening.open * 100 > SWING_RULES.maxRiskPercent) return undefined;
  let trendExit = false;
  for (let i = entryIndex; i < candles.length && i < entryIndex + plan.maxHoldingSessions; i++) {
    const candle = candles[i];
    // A suspended/zero-volume session is not an executable fill.
    if (candle.volume <= 0) continue;
    let exit: number | undefined; let exitReason: SwingTrade["exitReason"] = "time";
    if (candle.open <= plan.stop) { exit = candle.open; exitReason = "stop"; }
    else if (candle.open >= plan.target) { exit = plan.target; exitReason = "target"; }
    else if (trendExit) { exit = candle.open; exitReason = "trend"; }
    // Daily OHLC does not reveal the path. If both are touched, stop wins.
    else if (candle.low <= plan.stop) { exit = plan.stop; exitReason = "stop"; }
    else if (candle.high >= plan.target) { exit = plan.target; exitReason = "target"; }
    else if (i === entryIndex + plan.maxHoldingSessions - 1) exit = candle.close;
    if (exit !== undefined) {
      const entryFill = opening.open * (1 + SWING_RULES.slippage);
      const exitFill = exit * (1 - SWING_RULES.slippage);
      return {
        symbol, signalDate: candles[signalIndex].date, entryDate: opening.date, exitDate: candle.date,
        entry: entryFill, exit: exitFill, sessions: i - entryIndex + 1, exitReason,
        grossReturn: exit / opening.open - 1,
        netReturn: exitFill * (1 - SWING_RULES.sellFee) / (entryFill * (1 + SWING_RULES.buyFee)) - 1,
      };
    }
    if (i - entryIndex + 1 >= 3) trendExit = candle.close < ema(candles.slice(0, i + 1).map((item) => item.close), 20);
  }
  return undefined;
}

export function calculateSwingTrades(symbol: string, candles: MarketCandle[], minimumScore = SWING_RULES.minimumScore as number) {
  const trades: SwingTrade[] = [];
  // Reserve the complete holding window. No fabricated end-of-data liquidations.
  for (let i = SWING_RULES.minimumHistory - 1; i < candles.length - SWING_RULES.maxHoldingSessions; i++) {
    const signal = evaluateSwing(candles.slice(0, i + 1));
    if (!signal.eligible || signal.score < minimumScore || !signal.plan) continue;
    const trade = simulateSwingTrade(candles, i, signal.plan, symbol);
    if (!trade) {
      // If opening was in range but no executable exit existed (e.g. suspension),
      // don't pretend the same capital can fund subsequent trades.
      const opening = candles[i + 1];
      if (opening.volume > 0 && opening.open >= signal.plan.entryMin && opening.open <= signal.plan.entryMax) throw new Error(`Posisi ${symbol} pada ${opening.date} tidak memiliki exit yang dapat dieksekusi. Backtest dibatalkan agar posisi terbuka tidak hilang dari hasil.`);
      continue;
    }
    trades.push(trade);
    i = candles.findIndex((candle) => candle.date === trade.exitDate);
  }
  return trades;
}

/** Equal capital sleeves, one position per symbol; daily liquidation-value marks. */
export function portfolioMetrics(series: { candles: MarketCandle[]; trades: SwingTrade[] }[]) {
  const dates = [...new Set(series.flatMap(({ candles }) => candles.map((candle) => candle.date)))].sort();
  const sleeves = series.map(({ candles, trades }) => ({
    closes: new Map(candles.map((candle) => [candle.date, candle.close])),
    entries: new Map(trades.map((trade) => [trade.entryDate, trade])),
    cash: 1, shares: 0, lastClose: 0, active: undefined as SwingTrade | undefined,
  }));
  let equity = 1; let peak = 1; let maxDrawdown = 0;
  for (const date of dates) {
    for (const sleeve of sleeves) {
      sleeve.lastClose = sleeve.closes.get(date) ?? sleeve.lastClose;
      const entry = sleeve.entries.get(date);
      if (entry) { sleeve.active = entry; sleeve.shares = sleeve.cash / (entry.entry * (1 + SWING_RULES.buyFee)); sleeve.cash = 0; }
      if (sleeve.active?.exitDate === date) { sleeve.cash = sleeve.shares * sleeve.active.exit * (1 - SWING_RULES.sellFee); sleeve.shares = 0; sleeve.active = undefined; }
    }
    equity = sleeves.length ? sleeves.reduce((sum, sleeve) => sum + sleeve.cash + sleeve.shares * sleeve.lastClose * (1 - SWING_RULES.slippage) * (1 - SWING_RULES.sellFee), 0) / sleeves.length : 1;
    peak = Math.max(peak, equity); maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
  }
  return { cumulativeNetReturn: equity - 1, maxDrawdown };
}
