import type { MarketCandle } from "./market-data";

/** All strategy thresholds live here so each component can be changed and backtested independently. */
export const STRATEGY_VERSION = "swing-v3";
export const SWING_RULES = {
  minimumHistory: 120,
  minimumScore: 70,
  minimumSetupQuality: 65,
  minimumEntryQuality: 60,
  maxHoldingSessions: 15,
  historyLookbackSessions: 220,
  minAverageTurnover: 10_000_000_000,
  minMedianTurnover: 5_000_000_000,
  minimumPositiveVolumeSessions: 18,
  maximumMissingRate: 0.08,
  buyFee: 0.0015,
  sellFee: 0.0025,
  slippage: 0.001,
  lookback: { trendFast: 20, trendSlow: 50, rsi: 14, atr: 14, momentum: 20, breakout: 20, slope: 10 },
  setup: { breakoutVolumeRatio: 1.5, breakoutCloseLocation: 0.7, pullbackTouchAtr: 0.5, pullbackMaxBelowEmaAtr: 0.5 },
  entry: { idealExtensionAtr: 1.5, cautionExtensionAtr: 2, chaseExtensionAtr: 2.5, maxRiskPercent: 10, minimumRewardRisk: 1.5 },
  weights: {
    setup: { trend: 25, structure: 20, volume: 15, momentum: 15, relativeStrength: 10, liquidity: 10, marketRegime: 5 },
    entry: { extension: 25, risk: 20, rewardRisk: 20, momentum: 15, breakoutPosition: 10, candle: 10 },
    overall: { setup: 0.6, entry: 0.4 },
  },
} as const;

export type SwingSetup = "breakout" | "pullback" | "watch";
export type MarketRegime = "bullish" | "neutral" | "bearish" | "unavailable";
export type DataQuality = { validBars: number; skippedBars: number; missingRate: number; missingInRecent20: boolean; missingInRecent60: boolean; zeroVolumeSessions: number };
export type SwingIndicators = {
  sma20: number; sma50: number; ema20: number; sma50SlopePercent: number;
  rsi14: number; atr14: number; atrPercent: number;
  volumeRatio20: number; medianVolumeRatio20: number; averageVolume20: number; medianVolume20: number;
  averageTurnover20: number; medianTurnover20: number; momentum20: number;
  ihsgReturn20: number | null; relativeStrength20: number | null;
  support20: number; resistance20: number; extensionAtr: number; closeLocation: number; oneDayReturn: number;
};
export type SwingPlan = {
  entry: number; entryMin: number; entryMax: number; stop: number; target: number;
  riskPercent: number; potentialRewardPercent: number; netRewardRisk: number; maxHoldingSessions: number;
  targetBasis: "historical-resistance" | "projected-3R"; targetConfidence: "high" | "reduced";
};
export type ScoreBreakdown = { setup: Record<string, number>; entry: Record<string, number> };
export type SwingAssessment = {
  strategyVersion: string; setup: SwingSetup; score: number; setupQuality: number; entryQuality: number; eligible: boolean;
  signal: string; trend: "bullish" | "neutral" | "bearish"; marketRegime: MarketRegime;
  reasons: string[]; warnings: string[]; indicators: SwingIndicators; plan: SwingPlan | null;
  dataQuality: DataQuality; scoreBreakdown: ScoreBreakdown;
};
export type SwingContext = { benchmarkCandles?: MarketCandle[]; dataQuality?: Partial<DataQuality> };

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const lastAverage = (values: number[], period: number) => average(values.slice(-period));
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

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
    else { gain = (gain * (period - 1) + Math.max(change, 0)) / period; loss = (loss * (period -1) + Math.max(-change, 0)) / period; atr = (atr * (period - 1) + tr) / period; }
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

function benchmarkContext(candles: MarketCandle[], benchmark: MarketCandle[] | undefined): { regime: MarketRegime; return20: number | null; relativeStrength: number | null } {
  if (!benchmark || benchmark.length < SWING_RULES.minimumHistory) return { regime: "unavailable", return20: null, relativeStrength: null };
  const lastDate = candles.at(-1)!.date;
  const aligned = benchmark.filter((bar) => bar.date <= lastDate);
  if (aligned.length < 51) return { regime: "unavailable", return20: null, relativeStrength: null };
  const closes = aligned.map((bar) => bar.close); const last = aligned.at(-1)!;
  const sma20 = lastAverage(closes, 20); const sma50 = lastAverage(closes, 50);
  const regime: MarketRegime = last.close > sma20 && sma20 > sma50 ? "bullish" : last.close < sma20 && sma20 < sma50 ? "bearish" : "neutral";
  const ihsgReturn20 = (last.close / closes.at(-21)! - 1) * 100;
  const stockReturn20 = (candles.at(-1)!.close / candles.at(-21)!.close - 1) * 100;
  return { regime, return20: ihsgReturn20, relativeStrength: stockReturn20 - ihsgReturn20 };
}

function quality(candles: MarketCandle[], given?: Partial<DataQuality>): DataQuality {
  const validBars = given?.validBars ?? candles.length; const skippedBars = given?.skippedBars ?? 0;
  return { validBars, skippedBars, missingRate: given?.missingRate ?? skippedBars / Math.max(1, validBars + skippedBars),
    missingInRecent20: given?.missingInRecent20 ?? false, missingInRecent60: given?.missingInRecent60 ?? false,
    zeroVolumeSessions: given?.zeroVolumeSessions ?? candles.filter((candle) => candle.volume === 0).length };
}

/** Only completed, validated candles through the signal date may be passed here. */
export function evaluateSwing(candles: MarketCandle[], context: SwingContext = {}): SwingAssessment {
  if (candles.length < SWING_RULES.minimumHistory) throw new Error(`Butuh minimal ${SWING_RULES.minimumHistory} candle harian valid; tersedia ${candles.length}.`);
  const latest = candles.at(-1)!; const previous = candles.at(-2)!; const closes = candles.map((candle) => candle.close);
  const prior20 = candles.slice(-21, -1); const priorLong = candles.slice(-Math.min(SWING_RULES.historyLookbackSessions + 1, candles.length), -1);
  const sma20 = lastAverage(closes, 20); const sma50 = lastAverage(closes, 50); const priorSma50 = lastAverage(closes.slice(0, -SWING_RULES.lookback.slope), 50);
  const ema20 = ema(closes, 20); const { atr14, rsi14 } = wilderIndicators(candles);
  const volumes = prior20.map((candle) => candle.volume); const turnover = prior20.map((candle) => candle.close * candle.volume);
  const averageVolume20 = average(volumes); const medianVolume20 = median(volumes);
  const resistance20 = Math.max(...prior20.map((candle) => candle.high)); const closeLocation = latest.high > latest.low ? (latest.close - latest.low) / (latest.high - latest.low) : 0.5;
  const market = benchmarkContext(candles, context.benchmarkCandles); const dataQuality = quality(candles, context.dataQuality);
  const indicators: SwingIndicators = {
    sma20, sma50, ema20, sma50SlopePercent: (sma50 / priorSma50 - 1) * 100, rsi14, atr14, atrPercent: atr14 / latest.close * 100,
    volumeRatio20: averageVolume20 > 0 ? latest.volume / averageVolume20 : 0, medianVolumeRatio20: medianVolume20 > 0 ? latest.volume / medianVolume20 : 0,
    averageVolume20, medianVolume20, averageTurnover20: average(turnover), medianTurnover20: median(turnover), momentum20: (latest.close / closes.at(-21)! - 1) * 100,
    ihsgReturn20: market.return20, relativeStrength20: market.relativeStrength, support20: Math.min(...prior20.map((candle) => candle.low)), resistance20,
    extensionAtr: atr14 > 0 ? (latest.close - ema20) / atr14 : 0, closeLocation, oneDayReturn: (latest.close / previous.close - 1) * 100,
  };
  const trend = latest.close > sma20 && sma20 > sma50 && indicators.sma50SlopePercent > 0;
  const trendState: SwingAssessment["trend"] = trend ? "bullish" : latest.close < sma20 && sma20 < sma50 && indicators.sma50SlopePercent < 0 ? "bearish" : "neutral";
  const liquid = indicators.averageTurnover20 >= SWING_RULES.minAverageTurnover && indicators.medianTurnover20 >= SWING_RULES.minMedianTurnover && prior20.filter((candle) => candle.volume > 0).length >= SWING_RULES.minimumPositiveVolumeSessions && latest.volume > 0;
  const breakout = trend && liquid && latest.close > resistance20 && indicators.volumeRatio20 >= SWING_RULES.setup.breakoutVolumeRatio && closeLocation >= SWING_RULES.setup.breakoutCloseLocation && indicators.extensionAtr <= SWING_RULES.entry.cautionExtensionAtr;
  const bullishCandle = latest.close >= latest.open && latest.close > previous.close && closeLocation >= 0.55;
  const impulseVolume = average(prior20.filter((candle) => candle.close > candle.open).map((candle) => candle.volume));
  const pullbackVolumeHealthy = !impulseVolume || latest.volume <= impulseVolume * 1.1;
  const pullback = trend && liquid && latest.low <= ema20 + SWING_RULES.setup.pullbackTouchAtr * atr14 && latest.low >= ema20 - SWING_RULES.setup.pullbackMaxBelowEmaAtr * atr14 && latest.close >= ema20 && bullishCandle && pullbackVolumeHealthy;
  const setup: SwingSetup = breakout ? "breakout" : pullback ? "pullback" : "watch";
  let plan: SwingPlan | null = null;
  if (setup !== "watch" && atr14 > 0) {
    const entry = roundPrice(latest.close, "up", latest.close);
    const stop = roundPrice(Math.min(entry - 1.5 * atr14, Math.min(...candles.slice(-5).map((candle) => candle.low)) - 0.25 * atr14), "down", latest.close);
    const risk = entry - stop;
    const overhead = priorLong.map((candle) => candle.high).filter((high) => high > entry);
    const hasHistoricalResistance = overhead.length > 0;
    const resistance = hasHistoricalResistance ? Math.min(...overhead) - tickSize(latest.close) : 0;
    const projected = entry + 3 * risk;
    // A projected 3R target is only permitted when historical overhead supply
    // cannot be observed in the configured lookback.
    const targetBasis = hasHistoricalResistance ? "historical-resistance" : "projected-3R";
    const target = roundPrice(hasHistoricalResistance ? resistance : projected, "down", latest.close);
    if (stop > 0 && stop < entry && target > entry) {
      const entryMin = roundPrice(Math.max(stop + tickSize(latest.close), entry - 0.5 * atr14), "up", latest.close);
      const entryMax = roundPrice(entry + 0.5 * atr14, "down", latest.close);
      plan = { entry, entryMin, entryMax, stop, target, riskPercent: risk / entry * 100, potentialRewardPercent: (target - entry) / entry * 100, netRewardRisk: netRewardRisk(entry, stop, target), maxHoldingSessions: SWING_RULES.maxHoldingSessions, targetBasis,
        targetConfidence: dataQuality.missingInRecent60 ? "reduced" : "high" };
    }
  }
  const w = SWING_RULES.weights;
  const setupBreakdown = {
    trend: (latest.close > sma20 ? 8 : 0) + (sma20 > sma50 ? 9 : 0) + (indicators.sma50SlopePercent > 0 ? 8 : 0),
    structure: setup === "breakout" ? 20 : setup === "pullback" ? 18 : 0,
    volume: indicators.volumeRatio20 >= 1.5 ? 15 : indicators.volumeRatio20 >= 1 ? 10 : indicators.volumeRatio20 >= 0.8 ? 5 : 0,
    momentum: rsi14 >= 60 && rsi14 <= 65 ? 15 : rsi14 >= 50 && rsi14 < 60 ? 12 : rsi14 > 65 && rsi14 <= 70 ? 12 : rsi14 > 70 ? 7 : rsi14 >= 45 && indicators.momentum20 > 0 ? 6 : 0,
    relativeStrength: market.relativeStrength === null ? 5 : market.relativeStrength >= 5 ? 10 : market.relativeStrength >= 0 ? 7 : market.relativeStrength >= -3 ? 3 : 0,
    liquidity: liquid ? 10 : 0,
    marketRegime: market.regime === "bullish" ? 5 : market.regime === "neutral" || market.regime === "unavailable" ? 3 : 0,
  };
  const extension = indicators.extensionAtr;
  const entryBreakdown = {
    extension: extension <= 0.5 ? 22 : extension <= 1 ? 25 : extension <= SWING_RULES.entry.idealExtensionAtr ? 23 : extension <= SWING_RULES.entry.cautionExtensionAtr ? 15 : extension <= SWING_RULES.entry.chaseExtensionAtr ? 7 : 0,
    risk: !plan ? 0 : plan.riskPercent <= 5 ? 20 : plan.riskPercent <= 8 ? 16 : plan.riskPercent <= 10 ? 10 : 3,
    rewardRisk: !plan ? 0 : plan.netRewardRisk >= 3 ? 20 : plan.netRewardRisk >= 2 ? 17 : plan.netRewardRisk >= SWING_RULES.entry.minimumRewardRisk ? 14 : plan.netRewardRisk >= 1 ? 7 : 0,
    momentum: rsi14 >= 50 && rsi14 <= 65 ? 15 : rsi14 > 65 && rsi14 <= 70 ? 10 : rsi14 > 70 ? 4 : rsi14 >= 45 ? 8 : 0,
    breakoutPosition: setup === "breakout" ? (extension <= 1.5 ? 10 : extension <= 2 ? 6 : 0) : setup === "pullback" ? 10 : 0,
    candle: closeLocation >= 0.7 ? 10 : closeLocation >= 0.55 ? 6 : 2,
  };
  let setupQuality = Object.values(setupBreakdown).reduce((sum, value) => sum + value, 0);
  let entryQuality = Object.values(entryBreakdown).reduce((sum, value) => sum + value, 0);
  if (dataQuality.missingRate > SWING_RULES.maximumMissingRate) { setupQuality = Math.min(setupQuality, 60); entryQuality = Math.min(entryQuality, 60); }
  if (dataQuality.missingInRecent20) entryQuality = Math.min(entryQuality, 75);
  if (dataQuality.missingInRecent60) setupQuality = Math.min(setupQuality, 85);
  if (rsi14 > 70) entryQuality = Math.min(entryQuality, 75);
  if (extension > 2) entryQuality = Math.min(entryQuality, 70);
  if (extension > 2.5) entryQuality = Math.min(entryQuality, 55);
  if (plan && plan.riskPercent > SWING_RULES.entry.maxRiskPercent) entryQuality = Math.min(entryQuality, 70);
  const score = Math.round(clamp(setupQuality) * w.overall.setup + clamp(entryQuality) * w.overall.entry);
  const reasons: string[] = []; const warnings: string[] = [];
  if (trend) reasons.push("Close > SMA20 > SMA50 dan slope SMA50 positif."); else warnings.push("Struktur uptrend utama belum lengkap.");
  if (market.relativeStrength !== null && market.relativeStrength > 0) reasons.push(`Outperform IHSG 20 sesi: +${market.relativeStrength.toFixed(2)}%.`); else if (market.relativeStrength !== null) warnings.push(`Underperform IHSG 20 sesi: ${market.relativeStrength.toFixed(2)}%.`);
  if (market.regime === "bearish") warnings.push("Regime IHSG bearish; kualitas setup dikurangi.");
  if (liquid) reasons.push("Likuiditas 20 sesi memenuhi rata-rata dan median turnover."); else warnings.push("Likuiditas/turnover 20 sesi belum memenuhi syarat.");
  if (setup === "breakout") reasons.push("Breakout high 20 sesi sebelumnya dengan volume dan penutupan dekat high.");
  else if (setup === "pullback") reasons.push("Pullback sehat di EMA20 dengan candle konfirmasi bullish.");
  else warnings.push("Belum ada breakout atau pullback EMA20 yang terkonfirmasi.");
  if (rsi14 > 70) warnings.push(`RSI ${rsi14.toFixed(1)} sudah overextended; entry quality diturunkan.`); else if (rsi14 >= 65) warnings.push(`RSI ${rsi14.toFixed(1)} kuat namun mulai extended.`);
  if (extension > 2.5) warnings.push(`Harga ${extension.toFixed(2)} ATR di atas EMA20: sangat berisiko dikejar.`); else if (extension > 2) warnings.push(`Harga ${extension.toFixed(2)} ATR di atas EMA20: chase risk.`); else if (extension > 1.5) warnings.push(`Harga ${extension.toFixed(2)} ATR di atas EMA20: mulai extended.`);
  if (plan?.riskPercent && plan.riskPercent > SWING_RULES.entry.maxRiskPercent) warnings.push(`Risk ${plan.riskPercent.toFixed(1)}% melebihi batas referensi ${SWING_RULES.entry.maxRiskPercent}%.`);
  if (plan?.targetBasis === "projected-3R") warnings.push("Target memakai proyeksi 3R karena resistance historis valid tidak ditemukan.");
  if (dataQuality.skippedBars) warnings.push(`${dataQuality.skippedBars} bar Yahoo dilewati; ${dataQuality.validBars} sesi valid tersedia.`);
  if (dataQuality.missingRate > SWING_RULES.maximumMissingRate) warnings.push("Missing rate data terlalu tinggi; confidence diturunkan.");
  if (dataQuality.missingInRecent20) warnings.push("Ada candle Yahoo yang hilang dalam 20 sesi terbaru.");
  if (dataQuality.zeroVolumeSessions) warnings.push(`${dataQuality.zeroVolumeSessions} sesi volume nol; periksa likuiditas/suspensi.`);
  const eligible = setup !== "watch" && !!plan && liquid && dataQuality.missingRate <= SWING_RULES.maximumMissingRate && setupQuality >= SWING_RULES.minimumSetupQuality && entryQuality >= SWING_RULES.minimumEntryQuality && score >= SWING_RULES.minimumScore;
  const signal = eligible ? (setup === "breakout" ? "Swing breakout" : "Swing pullback") : setup !== "watch" && setupQuality >= SWING_RULES.minimumSetupQuality ? "Setup kuat, tunggu entry" : "Tunggu konfirmasi";
  return { strategyVersion: STRATEGY_VERSION, setup, score, setupQuality: Math.round(clamp(setupQuality)), entryQuality: Math.round(clamp(entryQuality)), eligible, signal, trend: trendState, marketRegime: market.regime, reasons, warnings, indicators, plan, dataQuality, scoreBreakdown: { setup: setupBreakdown, entry: entryBreakdown } };
}
