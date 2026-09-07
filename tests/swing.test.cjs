const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSwing, wilderIndicators, tickSize, roundPrice } = require('../.test-build/swing-strategy');
const { normalizeDailyCandles, completedDailyCandles, weekdayAge, isCurrentDailyScreenerRun, isFreshSnapshot } = require('../.test-build/market-data');
const { simulateSwingTrade, calculateSwingTrades, portfolioMetrics } = require('../.test-build/swing-backtest');

function candle(date, close, extra = {}) {
  return { date, open: close - 5, high: close + 10, low: close - 15, close, volume: 30_000_000, foreignbuy: 0, foreignsell: 0, ...extra };
}
function history(length = 80) {
  return Array.from({ length }, (_, i) => candle(new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), 1000 + i * 2 + Math.sin(i * 1.3) * 20));
}
function breakout() {
  const candles = history();
  candles[79] = candle(candles[79].date, 1200, { open: 1160, high: 1205, low: 1155, volume: 60_000_000 });
  return candles;
}

test('normalizes numeric strings, chronological order, share units and identical duplicate dates', () => {
  const a = candle('2026-09-03', 1000); const b = candle('2026-09-04', 1010);
  const rows = [b, { ...a, close: '1000', volume: '12' }, { ...a, close: '1000', volume: '12' }];
  const result = normalizeDailyCandles(rows, 100);
  assert.deepEqual(result.map((row) => row.date), ['2026-09-03', '2026-09-04']);
  assert.equal(result[0].volume, 1200);
});

test('rejects malformed OHLC, absent prices, non-finite values and conflicting duplicates', () => {
  for (const extra of [{ low: 2000 }, { close: null }, { high: 'NaN' }, { volume: -1 }, { date: '2026-02-30' }]) {
    assert.throws(() => normalizeDailyCandles([candle('2026-09-04', 1000, extra)]));
  }
  assert.throws(() => normalizeDailyCandles([candle('2026-09-04', 1000), candle('2026-09-04', 1001)]));
});

test('only includes the current daily bar at the conservative 16:30 Jakarta cutoff', () => {
  const rows = [candle('2026-09-03', 1000), candle('2026-09-04', 1000), candle('2026-09-07', 1000)];
  assert.equal(completedDailyCandles(rows, new Date('2026-09-04T09:29:59Z')).length, 1);
  assert.equal(completedDailyCandles(rows, new Date('2026-09-04T09:30:00Z')).length, 2);
  assert.equal(weekdayAge('2026-09-04', new Date('2026-09-06T12:00:00Z')), 0);
  assert.equal(weekdayAge('2026-09-01', new Date('2026-09-07T12:00:00Z')), 4);
});

test('Wilder RSI handles flat, rising and falling series; ATR includes overnight gaps', () => {
  const flat = Array.from({ length: 20 }, (_, i) => candle(String(i), 100, { open: 100, high: 105, low: 95 }));
  assert.equal(wilderIndicators(flat).rsi14, 50);
  assert.ok(Math.abs(wilderIndicators(flat).atr14 - 10) < 1e-9);
  assert.equal(wilderIndicators(flat.map((row, i) => ({ ...row, close: 100 + i }))).rsi14, 100);
  assert.equal(wilderIndicators(flat.map((row, i) => ({ ...row, close: 100 - i }))).rsi14, 0);
  flat[19] = candle('19', 125, { open: 125, high: 130, low: 120 });
  assert.ok(Math.abs(wilderIndicators(flat).atr14 - (10 * 13 + 30) / 14) < 1e-9);
});

test('snapshot expiry cannot cross the daily publication cutoff or accept future timestamps', () => {
  const now = new Date('2026-09-04T09:35:00Z');
  assert.equal(isFreshSnapshot('2026-09-04T09:29:00Z', now), false);
  assert.equal(isFreshSnapshot('2026-09-04T09:30:00Z', now), true);
  assert.equal(isFreshSnapshot('2026-09-04T09:40:00Z', now), false);
  assert.equal(isFreshSnapshot('invalid', now), false);
  assert.equal(isFreshSnapshot('2026-09-04T09:30:00Z', new Date('2026-09-04T09:45:00Z')), false);
});

test('daily screener run stays available until the next completed weekday session', () => {
  assert.equal(isCurrentDailyScreenerRun('2026-09-04T10:00:00Z', new Date('2026-09-05T02:00:00Z')), true);
  assert.equal(isCurrentDailyScreenerRun('2026-09-04T10:00:00Z', new Date('2026-09-07T02:00:00Z')), true);
  assert.equal(isCurrentDailyScreenerRun('2026-09-04T10:00:00Z', new Date('2026-09-07T10:00:00Z')), false);
  assert.equal(isCurrentDailyScreenerRun('2026-09-07T10:00:00Z', new Date('2026-09-07T10:30:00Z')), true);
});

test('a pullback with nearby overhead supply remains a technical setup while retaining its objective R:R', () => {
  const rows = history();
  for (let index = 19; index < 79; index++) rows[index].high = 1180;
  rows[78] = candle(rows[78].date, 1140, { open: 1160, high: 1180, low: 1130 });
  rows[79] = candle(rows[79].date, 1160, { open: 1142, high: 1163, low: 1138 });
  const signal = evaluateSwing(rows);
  assert.equal(signal.setup, 'pullback');
  assert.equal(signal.eligible, true);
  assert.ok(signal.plan.netRewardRisk < 2);
  assert.ok(signal.plan.riskPercent > 8);
});

test('requires 60 bars and confirms an independently constructed liquid breakout', () => {
  assert.throws(() => evaluateSwing(history(59)), /60/);
  const signal = evaluateSwing(breakout());
  assert.equal(signal.setup, 'breakout');
  assert.equal(signal.eligible, true, JSON.stringify(signal));
  assert.ok(signal.plan.stop < signal.plan.entry && signal.plan.entry < signal.plan.target);
  assert.equal(signal.score, Object.values(signal.scoreBreakdown).reduce((sum, value) => sum + value, 0));
  assert.ok(signal.plan.entryMax >= signal.plan.entry);
});

test('a one-day volume spike cannot conceal poor multi-session liquidity', () => {
  const rows = breakout().map((row, i) => ({ ...row, volume: i === 79 ? 60_000_000 : 1000 }));
  const signal = evaluateSwing(rows);
  assert.equal(signal.eligible, false);
  assert.equal(signal.scoreBreakdown.liquidity, 0);
});

test('overheated momentum and zero-volume signals cannot qualify', () => {
  const rows = breakout(); rows[79].volume = 0;
  assert.equal(evaluateSwing(rows).eligible, false);
  const rising = history().map((row, i) => candle(row.date, 1000 + i * 10));
  assert.equal(evaluateSwing(rising).eligible, false);
  assert.equal(evaluateSwing(rising).indicators.rsi14, 100);
});

test('reference-price ticks remain consistent across a price-band boundary', () => {
  assert.deepEqual([199, 200, 500, 2000, 5000].map(tickSize), [1, 2, 5, 10, 25]);
  assert.equal(roundPrice(501, 'up', 490), 502);
  assert.equal(roundPrice(1999, 'down', 2000), 1990);
});

const plan = { entry: 1000, entryMin: 990, entryMax: 1010, stop: 950, target: 1200, riskPercent: 5, potentialRewardPercent: 20, netRewardRisk: 3, maxHoldingSessions: 15, targetBasis: '3R projection' };
test('entry is next open, not the signal close; rejects chase gaps', () => {
  const rows = [candle('2026-01-01', 800), candle('2026-01-02', 1000, { open: 1000, high: 1210, low: 990 })];
  const trade = simulateSwingTrade(rows, 0, plan, 'TEST');
  assert.equal(trade.entryDate, '2026-01-02');
  assert.ok(Math.abs(trade.entry - 1001) < 1e-9);
  assert.equal(trade.exitReason, 'target');
  rows[1].open = 1050;
  assert.equal(simulateSwingTrade(rows, 0, plan, 'TEST'), undefined);
});

test('same-bar ambiguity takes stop first; stop gaps fill at open and include all costs', () => {
  const rows = [candle('2026-01-01', 1000), candle('2026-01-02', 1000, { open: 1000, low: 940, high: 1210 })];
  assert.equal(simulateSwingTrade(rows, 0, plan, 'TEST').exitReason, 'stop');
  rows[1] = candle('2026-01-02', 1000, { open: 1000 });
  rows.push(candle('2026-01-03', 910, { open: 900, high: 920, low: 890 }));
  const trade = simulateSwingTrade(rows, 0, plan, 'TEST');
  assert.equal(trade.exit, 900 * 0.999);
  assert.ok(Math.abs(trade.netReturn - ((900 * 0.999 * 0.9975) / (1000 * 1.001 * 1.0015) - 1)) < 1e-12);
});

test('time exit is session 15; incomplete windows do not invent a sale', () => {
  const rows = Array.from({ length: 16 }, (_, i) => candle(`2026-01-${String(i + 1).padStart(2, '0')}`, 1000, { open: 1000 }));
  const trade = simulateSwingTrade(rows, 0, plan, 'TEST');
  assert.equal(trade.sessions, 15);
  assert.equal(trade.exitReason, 'time');
  assert.equal(simulateSwingTrade(rows.slice(0, 8), 0, plan, 'TEST'), undefined);
});

test('signals are prefix-only and trades do not overlap per symbol', () => {
  const rows = breakout(); const first = evaluateSwing(rows);
  const future = Array.from({ length: 30 }, (_, i) => candle(new Date(Date.UTC(2025, 0, 81 + i)).toISOString().slice(0, 10), 1200, { open: 1200, high: 1600, low: 1190 }));
  const full = [...rows, ...future];
  assert.deepEqual(evaluateSwing(full.slice(0, 80)), first);
  const trades = calculateSwingTrades('TEST', full);
  assert.ok(trades.some((trade) => trade.signalDate === rows[79].date));
  for (let i = 1; i < trades.length; i++) assert.ok(trades[i].entryDate > trades[i - 1].exitDate);
});

test('simultaneous positions use equal capital, not sequential compounded returns', () => {
  const trade = { symbol: 'TEST', signalDate: '2026-01-01', entryDate: '2026-01-02', exitDate: '2026-01-03', entry: 100, exit: 110, sessions: 2, exitReason: 'target', netReturn: 110 * 0.9975 / (100 * 1.0015) - 1, grossReturn: 0.1 };
  const series = { candles: [candle('2026-01-02', 100), candle('2026-01-03', 110)], trades: [trade] };
  const result = portfolioMetrics([series, series]);
  assert.ok(Math.abs(result.cumulativeNetReturn - trade.netReturn) < 1e-12);
  assert.ok(result.maxDrawdown < 0); // entry costs are marked on day one
});
