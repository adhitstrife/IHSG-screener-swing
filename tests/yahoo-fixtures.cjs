function candles(length = 80) {
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 1);
  return Array.from({ length }, (_, i) => {
    const date = new Date(end); date.setUTCDate(date.getUTCDate() - length + 1 + i);
    const close = 1000 + i * 2 + Math.sin(i * 1.3) * 20;
    return { date: date.toISOString().slice(0, 10), open: close - 5, high: close + 10, low: close - 15, close, volume: 30_000_000 };
  });
}

function chart(rows = candles(), symbol = 'TEST.JK') {
  return {
    meta: { symbol, currency: 'IDR', exchangeName: 'JKT', exchangeTimezoneName: 'Asia/Jakarta', dataGranularity: '1d' },
    quotes: rows.map((row) => ({ ...row, date: new Date(`${row.date}T02:00:00Z`), adjclose: row.close * 0.9 })),
  };
}

/** Raw Yahoo wire format also exercises the pinned client's validation/coercion. */
function payload(rows, symbol = 'TEST.JK') {
  const times = rows.map((row) => Date.parse(`${row.date}T02:00:00Z`) / 1000);
  const latest = times.at(-1);
  const period = { timezone: 'WIB', start: latest, end: latest + 6 * 3600, gmtoffset: 25200 };
  return { chart: { error: null, result: [{
    meta: { ...chart(rows, symbol).meta, instrumentType: 'EQUITY', firstTradeDate: times[0], regularMarketTime: latest, gmtoffset: 25200, timezone: 'WIB', regularMarketPrice: rows.at(-1).close, priceHint: 2, currentTradingPeriod: { pre: period, regular: period, post: period }, range: '', validRanges: ['1mo', '1y', 'max'] },
    timestamp: times,
    indicators: {
      quote: [Object.fromEntries(['open', 'high', 'low', 'close', 'volume'].map((field) => [field, rows.map((row) => row[field])]))],
      adjclose: [{ adjclose: rows.map((row) => row.close * 0.9) }],
    },
  }] } };
}
module.exports = { candles, chart, payload };
