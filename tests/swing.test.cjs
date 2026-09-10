const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSwing, wilderIndicators, tickSize, roundPrice } = require('../.test-build/swing-strategy');
const { evaluateShortSwing, SHORT_SWING_VERSION } = require('../.test-build/short-swing-strategy');
const { normalizeDailyCandles, completedDailyCandles, isCurrentDailyScreenerRun } = require('../.test-build/market-data');
const { simulateSwingTrade } = require('../.test-build/swing-backtest');

function candle(date, close, extra = {}) {
  return { date, open: close - 4, high: close + 8, low: close - 12, close, volume: 30_000_000, ...extra };
}
function history(length = 140, slope = 1.5) {
  return Array.from({ length }, (_, i) => candle(new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), 1000 + i * slope + Math.sin(i * 1.2) * 8));
}
function benchmark(length = 140) {
  return history(length, 0.35).map((row) => ({ ...row, volume: 0 }));
}
function breakout() {
  const rows = history();
  const previousHigh = Math.max(...rows.slice(-21, -1).map((row) => row.high));
  const close = previousHigh + 5;
  rows[rows.length - 1] = candle(rows.at(-1).date, close, { open: close - 18, high: close + 3, low: close - 22, volume: 60_000_000 });
  return rows;
}

test('requires 120 valid sessions and preserves zero-volume candles as liquidity data', () => {
  assert.throws(() => evaluateSwing(history(119)), /120/);
  const rows = breakout(); rows[20].volume = 0;
  const assessment = evaluateSwing(rows, { dataQuality: { validBars: 139, skippedBars: 1, missingRate: 1 / 140, zeroVolumeSessions: 1 } });
  assert.equal(assessment.dataQuality.validBars, 139);
  assert.equal(assessment.dataQuality.zeroVolumeSessions, 1);
  assert.ok(assessment.warnings.some((warning) => warning.includes('bar Yahoo')));
});

test('calculates IHSG-relative strength and bullish market regime separately from stock momentum', () => {
  const assessment = evaluateSwing(breakout(), { benchmarkCandles: benchmark() });
  assert.equal(assessment.marketRegime, 'bullish');
  assert.ok(assessment.indicators.relativeStrength20 > 0);
  assert.ok(assessment.scoreBreakdown.setup.relativeStrength >= 7);
});

test('breakout requires prior 20-session high, volume confirmation, close location and manageable extension', () => {
  const rows = breakout();
  const assessment = evaluateSwing(rows, { benchmarkCandles: benchmark() });
  assert.equal(assessment.setup, 'breakout');
  assert.ok(assessment.indicators.closeLocation > 0.7);
  assert.ok(assessment.indicators.volumeRatio20 >= 1.5);
  assert.ok(assessment.plan);
  assert.ok(assessment.plan.target > assessment.plan.entryMax, 'target must exceed the highest executable entry price');
  const chased = breakout();
  chased.at(-1).close += assessment.indicators.atr14 * 3;
  chased.at(-1).high += assessment.indicators.atr14 * 3;
  assert.notEqual(evaluateSwing(chased, { benchmarkCandles: benchmark() }).setup, 'breakout');
});

test('short swing has its own two-session momentum plan and never extends its target beyond 2R', () => {
  const assessment = evaluateShortSwing(breakout(), { benchmarkCandles: benchmark() });
  assert.equal(assessment.strategyVersion, SHORT_SWING_VERSION);
  assert.equal(assessment.plan.maxHoldingSessions, 2);
  const grossRisk = assessment.plan.entry - assessment.plan.stop;
  assert.ok(assessment.plan.target <= assessment.plan.entry + grossRisk * 2);
  assert.ok(assessment.warnings.some((warning) => warning.includes('Short swing')) || assessment.signal === 'Momentum 1–2 hari');
});

test('separates setup quality from entry quality and caps extended entries', () => {
  const rows = breakout();
  const base = evaluateSwing(rows, { benchmarkCandles: benchmark() });
  const extended = breakout();
  extended.at(-1).close += base.indicators.atr14 * 2.7;
  extended.at(-1).high += base.indicators.atr14 * 2.7;
  const assessment = evaluateSwing(extended, { benchmarkCandles: benchmark() });
  assert.ok(assessment.entryQuality <= 55);
  assert.ok(assessment.score <= Math.round(assessment.setupQuality * 0.6 + assessment.entryQuality * 0.4));
  assert.ok(assessment.warnings.some((warning) => warning.includes('ATR')));
});

test('Wilder indicators and tick rounding remain deterministic', () => {
  const flat = Array.from({ length: 20 }, (_, i) => candle(String(i), 100, { open: 100, high: 105, low: 95 }));
  assert.equal(wilderIndicators(flat).rsi14, 50);
  assert.ok(Math.abs(wilderIndicators(flat).atr14 - 10) < 1e-9);
  assert.deepEqual([199, 200, 500, 2000, 5000].map(tickSize), [1, 2, 5, 10, 25]);
  assert.equal(roundPrice(501, 'up', 490), 502);
});

test('completed daily candle cutoff remains conservative', () => {
  const rows = [candle('2026-09-03', 1000), candle('2026-09-04', 1000)];
  assert.equal(completedDailyCandles(rows, new Date('2026-09-04T09:29:59Z')).length, 1);
  assert.equal(completedDailyCandles(rows, new Date('2026-09-04T09:30:00Z')).length, 2);
  assert.equal(normalizeDailyCandles(rows).length, 2);
});

test('a screener snapshot from before the cutoff becomes stale after the daily candle is usable', () => {
  const beforeCloseRun = '2026-09-10T08:01:00.000Z'; // 15:01 WIB
  const afterCloseRun = '2026-09-10T09:31:00.000Z'; // 16:31 WIB
  assert.equal(isCurrentDailyScreenerRun(beforeCloseRun, new Date('2026-09-10T09:29:00.000Z')), true);
  assert.equal(isCurrentDailyScreenerRun(beforeCloseRun, new Date('2026-09-10T09:31:00.000Z')), false);
  assert.equal(isCurrentDailyScreenerRun(afterCloseRun, new Date('2026-09-10T09:32:00.000Z')), true);
});

test('next-open simulator still rejects chase gaps', () => {
  const plan = { entry: 1000, entryMin: 990, entryMax: 1010, stop: 950, target: 1200, riskPercent: 5, potentialRewardPercent: 20, netRewardRisk: 3, maxHoldingSessions: 15, targetBasis: 'projected-3R', targetConfidence: 'high' };
  const rows = [candle('2026-01-01', 800), candle('2026-01-02', 1000, { open: 1000, high: 1210, low: 990 })];
  assert.equal(simulateSwingTrade(rows, 0, plan, 'TEST').exitReason, 'target');
  rows[1].open = 1050;
  assert.equal(simulateSwingTrade(rows, 0, plan, 'TEST'), undefined);
});
