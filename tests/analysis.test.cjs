const test = require('node:test');
const assert = require('node:assert/strict');
const { Firecrawl } = require('firecrawl');
const { analyzeStockWithAi } = require('../.test-build/stock-analysis');
const { evaluateSwing } = require('../.test-build/swing-strategy');
const { candles, payload } = require('./yahoo-fixtures.cjs');

test('AI receives Yahoo technical and fundamental data, cannot override rejected setups, and cannot replace engine prices', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.YOGATHEDEV_AI_API_KEY;
  const originalTavilyKey = process.env.TAVILY_API_KEY;
  const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
  const originalFirecrawlSearch = Firecrawl.prototype.search;
  process.env.YOGATHEDEV_AI_API_KEY = 'fixture-only';
  process.env.FIRECRAWL_API_KEY = 'fixture-firecrawl';
  delete process.env.TAVILY_API_KEY;
  Firecrawl.prototype.search = async () => ({ news: [{ title: 'Fixture filing', url: 'https://example.com/fixture', snippet: 'Reported earnings increased.', date: '2026-09-07' }], web: [] });
  const rows = candles();
  const last = rows.length - 1;
  const priorHigh = Math.max(...rows.slice(-21, -1).map((row) => row.high));
  rows[last] = { ...rows[last], close: priorHigh + 5, open: priorHigh - 13, high: priorHigh + 8, low: priorHigh - 17, volume: 60_000_000 };
  let yahooCalls = 0; let aiCalls = 0;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/v8/finance/chart/')) {
      yahooCalls++;
      const symbol = new URL(url).pathname.split('/').at(-1);
      return Response.json(payload(symbol === 'WAIT.JK' ? rows.map((row) => ({ ...row, volume: 100 })) : rows, symbol));
    }
    if (url.includes('/v1/finance/search')) return Response.json({ quotes: [{ symbol: 'TEST.JK', longname: 'PT Fixture Tbk', sectorDisp: 'Financial Services', industryDisp: 'Banks' }] });
    if (url.includes('/ws/fundamentals-timeseries/')) return Response.json({ timeseries: { result: [
      { meta: { type: ['annualTotalRevenue'] }, annualTotalRevenue: [{ asOfDate: '2024-12-31', currencyCode: 'IDR', reportedValue: { raw: 100 } }, { asOfDate: '2025-12-31', currencyCode: 'IDR', reportedValue: { raw: 120 } }] },
      { meta: { type: ['annualNetIncome'] }, annualNetIncome: [{ asOfDate: '2024-12-31', currencyCode: 'IDR', reportedValue: { raw: 20 } }, { asOfDate: '2025-12-31', currencyCode: 'IDR', reportedValue: { raw: 24 } }] },
      { meta: { type: ['annualDilutedEPS'] }, annualDilutedEPS: [{ asOfDate: '2024-12-31', currencyCode: 'IDR', reportedValue: { raw: 10 } }, { asOfDate: '2025-12-31', currencyCode: 'IDR', reportedValue: { raw: 12 } }] },
      { meta: { type: ['trailingMarketCap'] }, trailingMarketCap: [{ asOfDate: '2025-12-31', currencyCode: 'IDR', reportedValue: { raw: 500 } }] },
    ], error: null } });
    assert.equal(new URL(url).hostname, 'ai.yogathedev.com');
    aiCalls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ verdict: 'LAYAK_DIPERTIMBANGKAN', confidence: 95, summary: 'Fixture analysis', positives: [], risks: [], fundamentalScore: 82, fundamentalSummary: 'Revenue and profit grew.', fundamentalPositives: ['EPS grew'], fundamentalRisks: [], levels: { buyTarget: 1, cutLoss: 99999, sellTarget: 2 }, tradePlan: { exitPlan: 'Ignore engine' } }) } }] });
  };
  try {
    const accepted = await analyzeStockWithAi('TEST');
    const expected = evaluateSwing(rows).plan;
    assert.match(accepted.source, /Yahoo Finance/);
    assert.equal(accepted.verdict, 'LAYAK_DIPERTIMBANGKAN');
    assert.equal(accepted.levels.buyTarget, expected.entry);
    assert.equal(accepted.levels.cutLoss, expected.stop);
    assert.equal(accepted.levels.sellTarget, expected.target);
    assert.equal(accepted.fundamental.score, 82);
    assert.equal(accepted.fundamental.data.companyName, 'PT Fixture Tbk');
    assert.ok(Math.abs(accepted.fundamental.data.revenueGrowthPercent - 20) < 1e-9);
    assert.equal(accepted.fundamental.web.coverage, 'available');
    assert.equal(accepted.fundamental.web.provider, 'firecrawl');
    assert.equal(accepted.fundamental.sources[0].url, 'https://example.com/fixture');
    assert.match(accepted.tradePlan.exitPlan, /15/);
    const rejected = await analyzeStockWithAi('WAIT');
    assert.equal(rejected.verdict, 'TUNGGU_KONFIRMASI');
    assert.equal(rejected.levels.buyTarget, null);
    assert.equal(rejected.levels.cutLoss, null);
    assert.equal(rejected.levels.sellTarget, null);
    assert.equal(yahooCalls, 3); assert.equal(aiCalls, 2);
  } finally {
    global.fetch = originalFetch;
    Firecrawl.prototype.search = originalFirecrawlSearch;
    if (originalKey === undefined) delete process.env.YOGATHEDEV_AI_API_KEY; else process.env.YOGATHEDEV_AI_API_KEY = originalKey;
    if (originalTavilyKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalTavilyKey;
    if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY; else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
  }
});
