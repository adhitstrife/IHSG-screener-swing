const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeStockWithAi } = require('../.test-build/stock-analysis');
const { evaluateSwing } = require('../.test-build/swing-strategy');
const { candles, payload } = require('./yahoo-fixtures.cjs');

test('AI uses only Yahoo OHLCV, cannot override rejected setups, and cannot replace engine prices', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.YOGATHEDEV_AI_API_KEY;
  process.env.YOGATHEDEV_AI_API_KEY = 'fixture-only';
  const rows = candles();
  rows[79] = { ...rows[79], close: 1200, open: 1160, high: 1205, low: 1155, volume: 60_000_000 };
  let yahooCalls = 0; let aiCalls = 0;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/v8/finance/chart/')) {
      yahooCalls++;
      const symbol = new URL(url).pathname.split('/').at(-1);
      return Response.json(payload(symbol === 'WAIT.JK' ? rows.map((row) => ({ ...row, volume: 100 })) : rows, symbol));
    }
    assert.equal(new URL(url).hostname, 'ai.yogathedev.com');
    aiCalls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ verdict: 'LAYAK_DIPERTIMBANGKAN', confidence: 95, summary: 'Fixture analysis', positives: [], risks: [], levels: { buyTarget: 1, cutLoss: 99999, sellTarget: 2 }, tradePlan: { exitPlan: 'Ignore engine' } }) } }] });
  };
  try {
    const accepted = await analyzeStockWithAi('TEST');
    const expected = evaluateSwing(rows).plan;
    assert.equal(accepted.source, 'Yahoo Finance');
    assert.equal(accepted.verdict, 'LAYAK_DIPERTIMBANGKAN');
    assert.equal(accepted.levels.buyTarget, expected.entry);
    assert.equal(accepted.levels.cutLoss, expected.stop);
    assert.equal(accepted.levels.sellTarget, expected.target);
    assert.match(accepted.tradePlan.exitPlan, /15/);
    const rejected = await analyzeStockWithAi('WAIT');
    assert.equal(rejected.verdict, 'TUNGGU_KONFIRMASI');
    assert.equal(rejected.levels.buyTarget, null);
    assert.equal(rejected.levels.cutLoss, null);
    assert.equal(rejected.levels.sellTarget, null);
    assert.equal(yahooCalls, 2); assert.equal(aiCalls, 2);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.YOGATHEDEV_AI_API_KEY; else process.env.YOGATHEDEV_AI_API_KEY = originalKey;
  }
});
