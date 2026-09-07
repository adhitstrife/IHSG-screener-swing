const test = require('node:test');
const assert = require('node:assert/strict');
const { toYahooSymbol, yahooDateRange, normalizeYahooChart } = require('../.test-build/yahoo-data');
const { createYahooHistoryProvider, YahooDataError } = require('../.test-build/yahoo-finance');
const { candles, chart } = require('./yahoo-fixtures.cjs');

test('IDX suffix is normalized once, and other exchanges/URL-like symbols are rejected', () => {
  assert.equal(toYahooSymbol(' bbca '), 'BBCA.JK');
  assert.equal(toYahooSymbol('bbca.jk'), 'BBCA.JK');
  assert.equal(toYahooSymbol('^JKSE'), '^JKSE');
  for (const symbol of ['BBCA.US', 'BBCA.JK.JK', '../BBCA', '']) assert.throws(() => toYahooSymbol(symbol));
});

test('inclusive Jakarta ranges include the full final trading date and reject invalid dates', () => {
  const range = yahooDateRange('2026-09-04', '2026-09-04');
  assert.equal(range.period1.toISOString(), '2026-09-03T17:00:00.000Z');
  assert.equal(range.period2.toISOString(), '2026-09-04T17:00:00.000Z');
  assert.throws(() => yahooDateRange('2026-02-30', '2026-09-04'));
  assert.throws(() => yahooDateRange('2026-09-05', '2026-09-04'));
});

test('OHLC and share volumes remain on Yahoo split-adjusted basis; adjclose and split ratios are not reapplied', () => {
  const rows = candles(10);
  const data = chart(rows);
  data.events = { splits: [{ date: data.quotes[5].date, numerator: 2, denominator: 1, splitRatio: '2:1' }] };
  const result = normalizeYahooChart(data, 'TEST', rows[0].date, rows.at(-1).date);
  assert.equal(result.candles[0].close, rows[0].close);
  assert.equal(result.candles[0].open, rows[0].open);
  assert.equal(result.candles[0].volume, rows[0].volume);
  assert.equal('foreignbuy' in result.candles[0], false);
  assert.equal(result.splits[0].ratio, '2:1');
  assert.ok(result.warnings.length > 0);
});

test('timestamps map to Jakarta session dates and partial current bars are excluded before normalization', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ date: `2026-08-${String(24 + i).padStart(2, '0')}`, open: 1000, high: 1020, low: 980, close: 1010, volume: 1e6 }));
  const data = chart(rows);
  data.quotes.push({ date: new Date('2026-09-03T18:00:00Z'), open: null, high: null, low: null, close: null, volume: null });
  const result = normalizeYahooChart(data, 'TEST', '2026-08-01', '2026-09-04', new Date('2026-09-04T09:29:00Z'));
  assert.equal(result.candles.length, 8);
  // A partly filled completed bar is skipped and recorded for data-quality scoring.
  data.quotes.at(-1).close = 1000;
  const skipped = normalizeYahooChart(data, 'TEST', '2026-08-01', '2026-09-04', new Date('2026-09-04T09:30:00Z'));
  assert.equal(skipped.quality.skippedBars, 1);
});

test('Yahoo all-null weekday holiday placeholders are skipped without creating artificial sessions', () => {
  const rows = candles(10);
  const data = chart(rows);
  data.quotes[3] = { date: data.quotes[3].date, open: null, high: null, low: null, close: null, volume: null };
  const result = normalizeYahooChart(data, 'TEST', rows[0].date, rows.at(-1).date);
  assert.equal(result.candles.length, 9);
  assert.equal(result.candles.some((candle) => candle.date === rows[3].date), false);
  assert.match(result.warnings[0], /bar Yahoo/);
  data.quotes[3].volume = 1000;
  assert.equal(normalizeYahooChart(data, 'TEST', rows[0].date, rows.at(-1).date).quality.skippedBars, 1);
});

test('wrong currency/exchange, null completed OHLC and conflicting sessions cannot produce signals', () => {
  const rows = candles(10);
  for (const meta of [{ currency: 'USD' }, { symbol: 'OTHER.JK' }, { exchangeName: 'NYQ' }, { dataGranularity: '1wk' }]) {
    const data = chart(rows); Object.assign(data.meta, meta);
    assert.throws(() => normalizeYahooChart(data, 'TEST', rows[0].date, rows.at(-1).date), /Metadata/);
  }
  const data = chart(rows); data.quotes[0].close = null;
  assert.equal(normalizeYahooChart(data, 'TEST', rows[0].date, rows.at(-1).date).quality.skippedBars, 1);
  const duplicate = chart(rows); duplicate.quotes.push({ ...duplicate.quotes[0], close: duplicate.quotes[0].close + 1 });
  assert.throws(() => normalizeYahooChart(duplicate, 'TEST', rows[0].date, rows.at(-1).date), /duplikat/);
});

test('history requests coalesce, retain cache timestamps, and force refresh bypasses cached data', async () => {
  const rows = candles(); let calls = 0;
  const provider = createYahooHistoryProvider(async (symbol, range, signal) => {
    calls++;
    assert.equal(symbol, 'TEST.JK'); assert.ok(range.period2 > range.period1); assert.equal(signal.aborted, false);
    return chart(rows);
  }, 0);
  const args = ['TEST', rows[0].date, rows.at(-1).date];
  const [a, b] = await Promise.all([provider(...args), provider(...args)]);
  assert.equal(a, b); assert.equal(calls, 1);
  assert.equal((await provider(...args)).fetchedAt, a.fetchedAt); assert.equal(calls, 1);
  await provider(...args, true); assert.equal(calls, 2);
});

test('transient errors retry once, rate limits do not retry, and failed results are not cached', async () => {
  const rows = candles(); const args = ['TEST', rows[0].date, rows.at(-1).date];
  let calls = 0;
  const recovered = createYahooHistoryProvider(async () => { if (++calls === 1) throw new YahooDataError('Unavailable', 503); return chart(rows); }, 0);
  assert.ok((await recovered(...args)).candles.length); assert.equal(calls, 2);
  calls = 0;
  const limited = createYahooHistoryProvider(async () => { calls++; throw new YahooDataError('Too many requests', 429); }, 0);
  await assert.rejects(limited(...args), (error) => error.status === 429);
  assert.equal(calls, 1);
  await assert.rejects(limited(...args)); assert.equal(calls, 2);
});
