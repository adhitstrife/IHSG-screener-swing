const test = require('node:test');
const assert = require('node:assert/strict');
const { createUniverseProvider, buildYahooScreen } = require('../.test-build/yahoo-universe');
const { createScreenerService } = require('../.test-build/screener');
const { mergeScanBatch } = require('../.test-build/screener-results');
const { YahooDataError } = require('../.test-build/yahoo-finance');
const quote = (n) => ({symbol: 'A' + String.fromCharCode(65 + Math.floor(n/676),65 + Math.floor(n/26)%26,65+n%26)+'.JK', exchange:'JKT',currency:'IDR',quoteType:'EQUITY',regularMarketPrice:1000,averageDailyVolume3Month:10000000});
const page = (total, start, quotes) => ({finance:{error:null,result:[{total,start,quotes}]}});

test('dynamic discovery pages beyond 250 and 30, applies proxy, and coalesces/cache/refreshes', async () => {
  let calls=0; const rows=Array.from({length:260},(_,i)=>quote(i));
  rows[5].averageDailyVolume3Month=1; rows[6].currency='USD';
  const load=createUniverseProvider(async body=> { calls++; assert.equal(body.size,250); return page(260,body.offset,rows.slice(body.offset,body.offset+250)); });
  const [a,b]=await Promise.all([load(),load()]);
  assert.equal(a,b);assert.equal(calls,2);assert.equal(a.stocks.length,258);assert.equal(a.excluded,2);assert.equal(a.yahooMatches,260);
  assert.equal(await load(),a);await load(true);assert.equal(calls,4);
});

test('upstream price bands preserve candidates meeting proxy, including extremely expensive stocks',()=> {
  const q=buildYahooScreen(5e9).query;
  const evaluate=(q,fields)=> q.operator==='AND'?q.operands.every(x=>evaluate(x,fields)):q.operator==='OR'?q.operands.some(x=>evaluate(x,fields)):q.operator==='EQ'?fields[q.operands[0]]===q.operands[1]:q.operator==='GTE'?fields[q.operands[0]]>=q.operands[1]:fields[q.operands[0]]<q.operands[1];
  for(const price of [1,199,200,499,500,999,1000,1999,2000,5000,10000,100000,1e7]) {
    assert.ok(evaluate(q,{region:'id',exchange:'JKT',intradayprice:price,avgdailyvol3m:5e9/price}));
  }
});

test('zero matches are valid; empty pages, duplicate pages, changed totals and wrong offsets fail without fallback',async()=> {
  const empty=await createUniverseProvider(async()=>page(0,0,[]))();assert.equal(empty.stocks.length,0);
  for(const response of [page(1,0,[]),page(1,5,[quote(0)]),page(2,0,[quote(0),quote(0)])]) await assert.rejects(createUniverseProvider(async()=>response)());
  await assert.rejects(createUniverseProvider(async body=> body.offset? page(3,body.offset,[quote(1)]):page(2,0,[quote(0)]))(),/berubah/);
  let calls=0;const denied=createUniverseProvider(async()=>{calls++;throw new YahooDataError('denied',429)});
  await assert.rejects(denied());await assert.rejects(denied());assert.equal(calls,2);
});

test('manual watchlist is explicit and has no 30 stock cap',async()=> {
  const saved={mode:process.env.SCREENER_MODE,symbols:process.env.SCREENER_SYMBOLS};
  try {
    process.env.SCREENER_MODE='watchlist';process.env.SCREENER_SYMBOLS=Array.from({length:40},(_,i)=>quote(i).symbol).join(',');
    const r=await createUniverseProvider(async()=>{throw new Error('must not fetch')})();assert.equal(r.stocks.length,40);
  } finally {
    for(const [key,value] of [['SCREENER_MODE',saved.mode],['SCREENER_SYMBOLS',saved.symbols]]) {if(value===undefined) delete process.env[key]; else process.env[key]=value;}
  }
});

test('a failed batch retains coverage and subsequent batches can complete; denial stops immediately',async()=> {
  const stocks=[{symbol:'FAIL',name:'fail'}];
  const run=createScreenerService(async()=>{throw new Error('No history')},stocks,true);
  const a=await run();assert.equal(a.meta.failures.length,1);assert.equal(a.data.length,0);
  const denied=createScreenerService(async()=>{throw new YahooDataError('denied',403)},stocks,true);await assert.rejects(denied(),/denied/);
  a.meta={...a.meta,universeId:'abc',universeSize:2,batchOffset:0,nextOffset:1,processedSize:1};
  const b={data:[],meta:{...a.meta,batchOffset:1,nextOffset:null,processedSize:2,failures:[{symbol:'NEXT',reason:'No data'}]}};
  const joined=mergeScanBatch(a,b);assert.equal(joined.meta.failures.length,2);assert.equal(joined.meta.nextOffset,null);
  assert.throws(()=>mergeScanBatch(a,{...b,meta:{...b.meta,universeId:'changed'}}),/berubah/);
});

test('stale checks span batch boundaries and do not mutate source batches',()=> {
  const stock=(symbol,asOf)=>({symbol,asOf,eligible:true,stale:false,score:90,warnings:[],plan:null});
  const a={data:[stock('OLD','2026-09-03')],meta:{universeId:'abc',nextOffset:3,scannedSize:1,failures:[],warnings:[],generatedAt:'2026-09-06T00:00:00Z'}};
  const b={data:[stock('NEW','2026-09-04')],meta:{...a.meta,batchOffset:3,nextOffset:null}};
  const combined=mergeScanBatch(a,b);assert.equal(combined.data.find(x=>x.symbol==='OLD').eligible,false);assert.equal(a.data[0].eligible,true);assert.equal(combined.meta.scannedSize,2);
});
