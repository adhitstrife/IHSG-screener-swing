import type { MarketCandle } from "./market-data";
import { evaluateSwing, netRewardRisk, roundPrice, SWING_RULES, type SwingAssessment, type SwingContext } from "./swing-strategy";

export const SHORT_SWING_VERSION = "short-swing-v1";
export const SHORT_SWING_RULES = { maxHoldingSessions: 2, stopAtr: 1.15, targetRiskMultiple: 2, minimumRewardRisk: 1.2, maximumExtensionAtr: 1.5, minimumRsi: 55, maximumRsi: 70 } as const;

/** A two-session momentum continuation setup. It deliberately accepts confirmed breakouts only. */
export function evaluateShortSwing(candles: MarketCandle[], context: SwingContext = {}): SwingAssessment {
  const base = evaluateSwing(candles, context);
  const { indicators } = base;
  const latest = candles.at(-1)!;
  const entry = roundPrice(latest.close, "up", latest.close);
  const stop = roundPrice(entry - SHORT_SWING_RULES.stopAtr * indicators.atr14, "down", latest.close);
  const risk = entry - stop;
  const entryMin = roundPrice(Math.max(stop + 1, entry - 0.35 * indicators.atr14), "up", latest.close);
  const entryMax = roundPrice(entry + 0.35 * indicators.atr14, "down", latest.close);
  // A short hold cannot assume it will travel to a distant resistance. The target is
  // capped at 2R and still respects the nearest observed resistance from the daily engine.
  const resistanceTarget = base.plan?.target;
  const projectedTarget = entry + SHORT_SWING_RULES.targetRiskMultiple * risk;
  const target = roundPrice(resistanceTarget ? Math.min(resistanceTarget, projectedTarget) : projectedTarget, "down", latest.close);
  const plan = stop > 0 && stop < entry && target > entryMax ? {
    entry, entryMin, entryMax, stop, target, riskPercent: risk / entry * 100,
    potentialRewardPercent: (target - entry) / entry * 100,
    netRewardRisk: netRewardRisk(entry, stop, target), maxHoldingSessions: SHORT_SWING_RULES.maxHoldingSessions,
    targetBasis: resistanceTarget && resistanceTarget <= projectedTarget ? "historical-resistance" as const : "projected-2R" as const,
    targetConfidence: base.dataQuality.missingInRecent60 ? "reduced" as const : "high" as const,
  } : null;
  const momentumReady = base.setup === "breakout" && base.trend === "bullish" && indicators.volumeRatio20 >= SWING_RULES.setup.breakoutVolumeRatio && indicators.closeLocation >= SWING_RULES.setup.breakoutCloseLocation && indicators.extensionAtr <= SHORT_SWING_RULES.maximumExtensionAtr && indicators.rsi14 >= SHORT_SWING_RULES.minimumRsi && indicators.rsi14 <= SHORT_SWING_RULES.maximumRsi;
  const rewardScore = !plan ? 0 : plan.netRewardRisk >= 1.5 ? 20 : plan.netRewardRisk >= SHORT_SWING_RULES.minimumRewardRisk ? 14 : plan.netRewardRisk >= 1 ? 7 : 0;
  const entryQuality = Math.round(Math.min(100, Math.max(0, base.entryQuality - base.scoreBreakdown.entry.rewardRisk + rewardScore)));
  const score = Math.round(base.setupQuality * 0.55 + entryQuality * 0.45);
  const eligible = momentumReady && !!plan && plan.netRewardRisk >= SHORT_SWING_RULES.minimumRewardRisk && base.dataQuality.missingRate <= SWING_RULES.maximumMissingRate && base.scoreBreakdown.setup.liquidity >= SWING_RULES.weights.setup.liquidity && score >= 70;
  const warnings = [...base.warnings];
  if (!momentumReady) warnings.push("Short swing membutuhkan breakout harian yang terkonfirmasi, momentum RSI 55–70, dan extension maksimal 1,5 ATR.");
  if (plan && plan.netRewardRisk < SHORT_SWING_RULES.minimumRewardRisk) warnings.push(`R:R net ${plan.netRewardRisk.toFixed(2)} di bawah batas short swing 1:${SHORT_SWING_RULES.minimumRewardRisk.toFixed(1)}.`);
  if (plan?.targetBasis === "projected-2R") warnings.push("Target short swing dibatasi maksimum 2R; tidak ada resistance terdekat yang dapat dipakai.");
  return { ...base, strategyVersion: SHORT_SWING_VERSION, setup: momentumReady ? "breakout" : "watch", plan, entryQuality, score, eligible, signal: eligible ? "Momentum 1–2 hari" : momentumReady ? "Momentum kuat, tunggu entry" : "Tunggu momentum", warnings: [...new Set(warnings)], scoreBreakdown: { ...base.scoreBreakdown, entry: { ...base.scoreBreakdown.entry, rewardRisk: rewardScore } } };
}
