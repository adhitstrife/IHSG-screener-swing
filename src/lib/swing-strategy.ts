import type { MarketCandle } from "./market-data";

export const STRATEGY_VERSION = "swing-v2";
export const SWING_RULES = {
  minimumHistory: 60, minimumScore: 70, maxHoldingSessions: 15,
  minAverageTurnover: 10_000_000_000, minMedianTurnover: 5_000_000_000,
  buyFee: 0.0015, sellFee: 0.0025, slippage: 0.001,
} as const;

export type SwingSetup = "breakout" | "pullback" | "watch";
export type SwingIndicators = {
  sma20: number; sma50: number; ema20: number; sma50SlopePercent: number;
  rsi14: number; atr14: number; atrPercent: number; volumeRatio20: number;
  averageTurnover20: number; medianTurnover20: number; momentum20: number;
  support20: number; resistance20: number; extensionAtr: number;
};
export type SwingPlan = {
  entry: number; entryMin: number; entryMax: number; stop: number; target: number;
  riskPercent: number; potentialRewardPercent: number; netRewardRisk: number; maxHoldingSessions: number;
  targetBasis: "resistance60" | "3R projection";
};
export type SwingAssessment = {
  strategyVersion: string; setup: SwingSetup; score: number; eligible: boolean;
  signal: string; reasons: string[]; warnings: string[];
  indicators: SwingIndicators; plan: SwingPlan | null;
  scoreBreakdown: { trend: number; momentum: number; volume: number; setup: number; liquidity: number; risk: number };
};

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const lastAverage = (values: number[], period: number) => average(values.slice(-period));
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return (sorted[9] + sorted[10]) / 2; };

export function ema(values: number[], period: number) {
  let value = average(values.slice(0, period));
  for (let i = period; i < values.length; i++) value += (values[i] - value) * 2 / (period + 1);
  return value;
}

export function wilderIndicators(candles: MarketCandle[], period = 14) {
  let gain = 0; let loss = 0; let atr = 0;
  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    if (i <= period) { gain += Math.max(change, 0) / period; loss += Math.max(-change, 0) / period; atr += tr / period; }
    else { gain = (gain * (period - 1) + Math.max(change, 0)) / period; loss = (loss * (period - 1) + Math.max(-change, 0)) / period; atr = (atr * (period - 1) + tr) / period; }
  }
  return { atr14: atr, rsi14: gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) };
}

/** Regular-board indicative ticks. Recheck the stock's trading-day tick before ordering. */
export function tickSize(referencePrice: number) {
  return referencePrice < 200 ? 1 : referencePrice < 500 ? 2 : referencePrice < 2000 ? 5 : referencePrice < 5000 ? 10 : 25;
}
export function roundPrice(price: number, direction: "up" | "down", referencePrice = price) {
  const tick = tickSize(referencePrice);
  return (direction === "up" ? Math.ceil(price / tick) : Math.floor(price / tick)) * tick;
}

export function netRewardRisk(entry: number, stop: number, target: number) {
  const cost = entry * (1 + SWING_RULES.slippage) * (1 + SWING_RULES.buyFee);
  const proceeds = (price: number) => price * (1 - SWING_RULES.slippage) * (1 - SWING_RULES.sellFee);
  const risk = cost - proceeds(stop);
  return risk > 0 ? (proceeds(target) - cost) / risk : 0;
}

/** Only completed, validated candles through the signal date may be passed here. */
export function evaluateSwing(candles: MarketCandle[]): SwingAssessment {
  if (candles.length < SWING_RULES.minimumHistory) throw new Error(`Butuh minimal ${SWING_RULES.minimumHistory} candle harian lengkap; tersedia ${candles.length}.`);
  const latest = candles.at(-1)!; const previous = candles.at(-2)!;
  const closes = candles.map((candle) => candle.close);
  const prior20 = candles.slice(-21, -1);
  const sma20 = lastAverage(closes, 20); const sma50 = lastAverage(closes, 50);
  const priorSma50 = lastAverage(closes.slice(0, -5), 50);
  const ema20 = ema(closes, 20);
  const { atr14, rsi14 } = wilderIndicators(candles);
  const volumeBaseline = average(prior20.map((candle) => candle.volume));
  const turnover = prior20.map((candle) => candle.close * candle.volume);
  const resistance20 = Math.max(...prior20.map((candle) => candle.high));
  const indicators: SwingIndicators = {
    sma20, sma50, ema20, sma50SlopePercent: (sma50 / priorSma50 - 1) * 100,
    rsi14, atr14, atrPercent: atr14 / latest.close * 100,
    volumeRatio20: volumeBaseline > 0 ? latest.volume / volumeBaseline : 0,
    averageTurnover20: average(turnover), medianTurnover20: median(turnover),
    momentum20: (latest.close / closes.at(-21)! - 1) * 100,
    support20: Math.min(...prior20.map((candle) => candle.low)), resistance20,
    extensionAtr: atr14 > 0 ? (latest.close - ema20) / atr14 : 0,
  };
  const trend = latest.close > sma20 && sma20 > sma50 && sma50 > priorSma50;
  const liquid = indicators.averageTurnover20 >= SWING_RULES.minAverageTurnover && indicators.medianTurnover20 >= SWING_RULES.minMedianTurnover && prior20.filter((candle) => candle.volume > 0).length >= 18 && latest.volume > 0;
  const momentum = rsi14 >= 45 && rsi14 <= 75 && indicators.momentum20 > 0;
  const volatility = indicators.atrPercent >= 1 && indicators.atrPercent <= 6;
  const extended = indicators.extensionAtr > 2.5;
  const closePosition = latest.high > latest.low ? (latest.close - latest.low) / (latest.high - latest.low) : 0.5;
  const breakout = latest.close > resistance20 && indicators.volumeRatio20 >= 1.5 && closePosition >= 0.65;
  const pullback = Math.abs(latest.close - ema20) <= atr14 && latest.low <= ema20 + 0.5 * atr14 && latest.close > previous.close && latest.close >= latest.open && rsi14 >= 45 && rsi14 <= 65 && indicators.volumeRatio20 >= 0.8 && closePosition >= 0.6;
  const setup: SwingSetup = breakout ? "breakout" : pullback ? "pullback" : "watch";
  const discontinuity = candles.slice(-20).some((candle, i) => Math.abs(candle.close / candles[candles.length - 21 + i].close - 1) > 0.35);
  let plan: SwingPlan | null = null;
  if (setup !== "watch" && atr14 > 0) {
    const entry = roundPrice(latest.close, "up", latest.close);
    const stop = roundPrice(Math.min(entry - 1.5 * atr14, Math.min(...candles.slice(-5).map((candle) => candle.low)) - 0.25 * atr14), "down", latest.close);
    const risk = entry - stop;
    const overhead = candles.slice(-60, -1).map((candle) => candle.high).filter((high) => high > entry);
    const resistance = overhead.length ? Math.min(...overhead) - tickSize(latest.close) : Infinity;
    const projected = entry + 3 * risk;
    const target = roundPrice(Math.min(projected, resistance), "down", latest.close);
    if (stop > 0 && stop < entry && target > entry) {
      // The same next-open entry band is used by the simulator and the dashboard.
      const entryMin = roundPrice(Math.max(stop + tickSize(latest.close), entry - 0.5 * atr14), "up", latest.close);
      const entryMax = roundPrice(entry + 0.5 * atr14, "down", latest.close);
      plan = { entry, entryMin, entryMax, stop, target, riskPercent: risk / entry * 100, potentialRewardPercent: (target - entry) / entry * 100, netRewardRisk: netRewardRisk(entry, stop, target), maxHoldingSessions: SWING_RULES.maxHoldingSessions, targetBasis: resistance < projected ? "resistance60" : "3R projection" };
    }
  }
  const scoreBreakdown = {
    trend: (latest.close > sma20 ? 8 : 0) + (sma20 > sma50 ? 10 : 0) + (sma50 > priorSma50 ? 7 : 0),
    momentum: (rsi14 >= 45 && rsi14 <= 75 ? 8 : 0) + (indicators.momentum20 > 0 ? 7 : 0),
    volume: indicators.volumeRatio20 >= 1.5 ? 15 : indicators.volumeRatio20 >= 1 ? 10 : indicators.volumeRatio20 >= 0.8 ? 5 : 0,
    setup: setup === "watch" ? 0 : 20,
    liquidity: liquid ? 10 : 0,
    risk: (plan ? 10 : 0) + (volatility && !extended ? 5 : 0),
  };
  const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  const reasons: string[] = []; const warnings: string[] = [];
  if (trend) reasons.push("Tren naik: close > SMA20 > SMA50; SMA50 menanjak."); else warnings.push("Tren menengah belum terkonfirmasi.");
  if (liquid) reasons.push("Likuiditas 20 sesi memenuhi batas rata-rata dan median."); else warnings.push("Likuiditas atau aktivitas perdagangan belum cukup.");
  if (setup !== "watch") reasons.push(setup === "breakout" ? "Breakout high 20 sesi dengan volume ≥1,5×." : "Pantulan dekat EMA20 dengan konfirmasi candle dan volume."); else warnings.push("Belum ada breakout atau pullback yang terkonfirmasi.");
  if (!momentum) warnings.push("Momentum/RSI di luar rentang swing.");
  if (!volatility) warnings.push("ATR di luar rentang 1–6% harga.");
  if (extended) warnings.push("Harga terlalu jauh dari EMA20 (>2,5 ATR).");
  if (setup !== "watch" && !plan) warnings.push("Target atau zona entry valid belum tersedia pada struktur harga saat ini.");
  if (discontinuity) warnings.push("Lompatan harga >35%: periksa aksi korporasi/penyesuaian data.");
  const eligible = score >= SWING_RULES.minimumScore && trend && liquid && momentum && volatility && !extended && setup !== "watch" && !!plan && !discontinuity;
  return { strategyVersion: STRATEGY_VERSION, setup, score, eligible, signal: eligible ? (setup === "breakout" ? "Swing breakout" : "Swing pullback") : "Tunggu konfirmasi", reasons, warnings, indicators, plan, scoreBreakdown };
}
