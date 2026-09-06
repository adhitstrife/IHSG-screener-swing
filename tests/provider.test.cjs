const test = require('node:test');
const assert = require('node:assert/strict');
const { createScreenerService } = require('../.test-build/screener');
const { YahooDataError } = require('../.test-build/yahoo-finance');
const { normalizeYahooChart, YAHOO_DATA_VERSION } = require('../.test-build/yahoo-data');
const { candles, chart } = require('./yahoo-fixtures.cjs');
const universe = ['FAIL', 'LATE', 'GOOD'].map((symbol) => ({ symbol, name: symbol }));

test('scan coalesces refreshes, isolates symbol failures, excludes stale candidates, and preserves source timestamps', async () => {
  let calls = 0;
  const rows = candles(90);
  const service = createScreenerService(async (symbol, from, to) => {
    calls++;
    if (symbol === 'FAIL') throw new Error('Invalid history');
    return normalizeYahooChart(chart(symbol === 'LATE' ? rows.slice(0, -10) : rows, symbol + '.JK'), symbol, from, to);
  }, universe);
  const [first, concurrent] = await Promise.all([service(true), service(true)]);
  assert.equal(first, concurrent); assert.equal(calls, 3);
  assert.equal(first.meta.failures.length, 1); assert.equal(first.meta.scannedSize, 2);
  assert.equal(first.meta.source, 'Yahoo Finance'); assert.equal(first.meta.dataVersion, YAHOO_DATA_VERSION);
  const stale = first.data.find((stock) => stock.symbol === 'LATE');
  assert.equal(stale.stale, true); assert.equal(stale.eligible, false);
  const cached = await service(); assert.equal(cached.meta.generatedAt, first.meta.generatedAt); assert.equal(calls, 3);
  await service(true); assert.equal(calls, 6);
});

test('Yahoo access denial stops remaining requests and an empty scan fails honestly', async () => {
  let calls = 0;
  const service = createScreenerService(async () => { calls++; throw new YahooDataError('Yahoo HTTP 403', 403); }, universe);
  await assert.rejects(service(), /403/);
  assert.equal(calls, 1);
});
