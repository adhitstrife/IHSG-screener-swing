"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ScreenerSnapshot, ScreenerStock } from "@/lib/screener";
import type { BacktestResult } from "@/lib/backtest";

const fmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const price = (value: number) => `Rp${fmt.format(value)}`;
const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const turnover = (value: number) => `Rp${(value / 1_000_000_000).toFixed(1)} M`;
const inputClass = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
type RefreshProgress = { processed: number; total: number; updatedAt: string };
type ScannerMode = "swing" | "short";

function assessmentForMode(stock: ScreenerStock, mode: ScannerMode): ScreenerStock {
  return mode === "short" ? { ...stock, ...stock.shortTerm } : stock;
}

export default function Home() {
  const scanRequest = useRef<AbortController | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [query, setQuery] = useState("");
  const [minimumScore, setMinimumScore] = useState(0);
  const [minimumRewardRisk, setMinimumRewardRisk] = useState(1.5);
  const [mode, setMode] = useState<ScannerMode>("swing");
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [setup, setSetup] = useState("all");
  const [sort, setSort] = useState("score");
  const [snapshot, setSnapshot] = useState<ScreenerSnapshot>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<RefreshProgress>();
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [backtest, setBacktest] = useState<BacktestResult>();
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string>();

  const loadScreener = useCallback(async () => {
    scanRequest.current?.abort();
    const controller = new AbortController();
    scanRequest.current = controller;
    setExpanded(undefined); setError(undefined);
    setLoading(true);
    try {
      const response = await fetch("/api/screener", { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as (ScreenerSnapshot & { error?: string; refreshing?: boolean; progress?: RefreshProgress });
      if (controller.signal.aborted) return;
      if (response.status === 202) {
        setRefreshing(Boolean(payload.refreshing)); setRefreshProgress(payload.progress); return;
      }
      if (!response.ok) {
        throw new Error(payload.error ?? "Gagal memuat halaman saham.");
      }
      setSnapshot(payload);
      if (!(payload.meta && "refreshing" in payload.meta && payload.meta.refreshing)) setPage(1);
      setPageCount(Math.max(1, Math.ceil(payload.data.length / 10)));
      setRefreshing(Boolean(payload.meta && "refreshing" in payload.meta && payload.meta.refreshing));
      setRefreshProgress(payload.meta && "progress" in payload.meta ? payload.meta.progress as RefreshProgress | undefined : undefined);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Gagal memuat halaman saham."); }
    finally { if (scanRequest.current === controller) setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void loadScreener(); }, 0); return () => { window.clearTimeout(timer); scanRequest.current?.abort(); }; }, [loadScreener]);
  useEffect(() => { if (!refreshing) return; const timer = window.setInterval(() => { void loadScreener(); }, 3000); return () => window.clearInterval(timer); }, [refreshing, loadScreener]);

  const modeRows = useMemo(() => (snapshot?.data ?? []).map((stock) => assessmentForMode(stock, mode)), [snapshot, mode]);
  const results = useMemo(() => {
    const rows = modeRows.filter((stock) => `${stock.symbol} ${stock.name}`.toLowerCase().includes(query.trim().toLowerCase()) && stock.score >= minimumScore && (minimumRewardRisk === 0 || (stock.plan?.netRewardRisk ?? -Infinity) >= minimumRewardRisk) && (!onlyEligible || stock.eligible) && (setup === "all" || stock.setup === setup));
    return rows.sort((a, b) => sort === "rr" ? (b.plan?.netRewardRisk ?? -1) - (a.plan?.netRewardRisk ?? -1) : sort === "momentum" ? b.indicators.momentum20 - a.indicators.momentum20 : Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.symbol.localeCompare(b.symbol));
  }, [modeRows, query, minimumScore, minimumRewardRisk, onlyEligible, setup, sort]);
  const pageRows = results.slice((page - 1) * 10, page * 10);
  const activeCount = modeRows.filter((stock) => stock.eligible).length;
  const dates = [...new Set(snapshot?.data.map((stock) => stock.asOf) ?? [])].sort();
  const latestDate = dates.at(-1) ?? "—";
  const scanWarnings = snapshot ? [...snapshot.meta.warnings, ...snapshot.meta.failures.map((failure) => `${failure.symbol}: ${failure.reason}`)] : [];
  const staleCount = snapshot?.data.filter((stock) => stock.stale).length ?? 0;

  async function runBacktest() {
    setTesting(true); setTestError(undefined);
    try {
      const response = await fetch(`/api/backtest?mode=${mode}`, { cache: "no-store" });
      const payload = await response.json() as BacktestResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Backtest gagal.");
      setBacktest(payload);
    } catch (reason) { setTestError(reason instanceof Error ? reason.message : "Backtest gagal."); }
    finally { setTesting(false); }
  }

  return <main className="min-h-screen bg-[#f6f8fb] text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
      <Link href="/" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-lg font-black text-white">S</span><span><span className="block text-sm font-bold">IDX Swing Screener</span><span className="block text-xs text-slate-500">Trend · Setup · Risk</span></span></Link>
      <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">{mode === "short" ? "Horizon 1–2 sesi" : "Horizon 3–15 sesi"}</span>
    </div></header>
    <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
      <section className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div><p className="mb-2 text-sm font-semibold text-indigo-600">{mode === "short" ? "Momentum pendek · Bursa Efek Indonesia" : "Swing trading · Bursa Efek Indonesia"}</p><h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">Cari tren yang kuat.<br className="hidden sm:block" /> Masuk dengan rencana.</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">{mode === "short" ? "Short swing hanya mencari breakout momentum yang terkonfirmasi untuk rencana hold satu sampai dua sesi." : "Temukan breakout dan pantulan di tren naik dengan konfirmasi volume, likuiditas, serta ruang target yang cukup. Setiap kandidat memiliki alasan, batas entry, dan risiko yang terukur."}</p></div>
        <button onClick={() => void loadScreener()} disabled={loading || testing} className="shrink-0 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Memuat hasil scan…" : "Muat ulang hasil ↗"}</button>
      </section>
      <section className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Setup teknikal siap" value={snapshot ? String(activeCount) : "—"} note="Belum menerapkan preferensi R:R Anda" />
        <Metric label="Cakupan scan" value={snapshot ? `${snapshot.meta.scannedSize} / ${snapshot.meta.universeSize}` : "—"} note={snapshot?.meta.failures.length ? `${snapshot.meta.failures.length} saham gagal / dilewati` : `Dari ${snapshot?.meta.universeSize ?? 0} kandidat filter awal`} />
        <Metric label="Candle selesai terbaru" value={latestDate} note={dates.length > 1 ? `Tanggal bervariasi; ${staleCount} data tertinggal` : "Candle hari ini dipakai mulai 16.30 WIB"} />
        <Metric label="Scan dibuat" value={snapshot ? new Date(snapshot.meta.generatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) + " WIB" : "—"} note={snapshot ? `${snapshot.meta.source} · snapshot harian` : "Menunggu hasil scheduler"} />
      </section>
      {snapshot?.meta.candidateFilter && <p className="mb-4 text-sm text-slate-600">{snapshot.meta.candidateSource}: {snapshot.meta.candidateFilter}. Cakupan adalah kandidat filter, bukan seluruh BEI.</p>}
      {loading && <p role="status" className="mb-4 text-sm text-indigo-700">Memuat snapshot scan harian dari penyimpanan…</p>}
      {refreshing && <RefreshStatus progress={refreshProgress} />}
      {error && <p role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
      {scanWarnings.length > 0 && <details className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><summary className="cursor-pointer font-semibold">Scan memiliki {scanWarnings.length} catatan cakupan / penyimpanan</summary><ul className="mt-3 space-y-2">{scanWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-500">Mode strategi<select value={mode} onChange={(event) => { setMode(event.target.value as ScannerMode); setPage(1); setSetup("all"); }} className={`${inputClass} mt-1.5 block`}><option value="swing">Swing · 3–15 sesi</option><option value="short">Short swing · 1–2 sesi</option></select></label>
          <label className="min-w-52 flex-1 text-xs font-semibold text-slate-500">Cari hasil scan<input aria-label="Cari kode atau nama saham" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Kode atau nama saham" className={`${inputClass} mt-1.5 block w-full font-normal`} /></label>
          <label className="text-xs font-semibold text-slate-500">Setup<select value={setup} onChange={(event) => setSetup(event.target.value)} className={`${inputClass} mt-1.5 block`}><option value="all">Semua setup</option><option value="breakout">Breakout</option><option value="pullback">Pullback</option><option value="watch">Belum terbentuk</option></select></label>
          <label className="text-xs font-semibold text-slate-500">Skor minimum<select value={minimumScore} onChange={(event) => setMinimumScore(Number(event.target.value))} className={`${inputClass} mt-1.5 block`}><option value={0}>Semua skor</option><option value={60}>60</option><option value={70}>70</option><option value={80}>80</option><option value={90}>90</option></select></label>
          <label className="text-xs font-semibold text-slate-500">Minimum R:R net<select aria-label="Minimum R:R net" value={minimumRewardRisk} onChange={(event) => { setMinimumRewardRisk(Number(event.target.value)); setPage(1); }} className={`${inputClass} mt-1.5 block`}><option value={0}>Semua</option><option value={1}>1 : 1,0</option><option value={1.5}>1 : 1,5</option><option value={2}>1 : 2,0</option><option value={2.5}>1 : 2,5</option><option value={3}>1 : 3,0</option></select></label>
          <label className="text-xs font-semibold text-slate-500">Urutkan<select value={sort} onChange={(event) => setSort(event.target.value)} className={`${inputClass} mt-1.5 block`}><option value="score">Kelayakan & skor</option><option value="rr">R:R net</option><option value="momentum">Momentum 20 sesi</option></select></label>
          <label className="flex cursor-pointer items-center gap-2 py-2 text-sm text-slate-600"><input checked={onlyEligible} onChange={(event) => setOnlyEligible(event.target.checked)} type="checkbox" className="h-4 w-4 accent-indigo-600" /> Hanya setup lolos</label>
        </div>
      </section>
      <section aria-busy={loading || refreshing} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold">{mode === "short" ? "Watchlist short swing" : "Watchlist swing"}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{mode === "short" ? "Breakout momentum harian dengan target maksimum 2R dan batas hold dua sesi." : "Hasil scan harian diurutkan dan difilter untuk seluruh kandidat sebelum dibagi 10 saham per halaman."}</p></div><span className="shrink-0 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{results.length} saham</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1160px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{["Saham / harga", "Setup", "Trend / IHSG", "Volume / RSI", "Zona entry", "Stop / target", "R:R", "Kualitas", ""].map((title) => <th key={title} className="px-4 py-3 font-semibold">{title}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{pageRows.map((stock) => <Fragment key={stock.symbol}><tr className="transition hover:bg-slate-50">
            <td className="px-4 py-4"><p className="font-bold">{stock.symbol} <span className="ml-1 font-medium text-slate-500">{price(stock.price)}</span></p><p className="mt-1 max-w-48 truncate text-xs text-slate-500">{stock.name}</p><p className="mt-1 text-xs text-slate-400">{stock.asOf}{stock.stale ? " · tertinggal" : ""}</p></td>
            <td className="px-4 py-4"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${stock.eligible ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{stock.signal}</span></td>
            <td className={`px-4 py-4 font-semibold ${stock.indicators.momentum20 >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{stock.trend}<p className="mt-1 text-xs font-normal text-slate-500">RS IHSG {stock.indicators.relativeStrength20 === null ? "—" : percent(stock.indicators.relativeStrength20)}</p><p className="mt-1 text-xs font-normal text-slate-500">IHSG {stock.marketRegime}</p></td>
            <td className="px-4 py-4"><p className="font-semibold">{stock.indicators.volumeRatio20.toFixed(2)}×</p><p className="mt-1 text-xs text-slate-500">RSI {stock.indicators.rsi14.toFixed(1)}</p></td>
            <td className="px-4 py-4 text-xs font-semibold">{stock.plan ? <>{price(stock.plan.entryMin)}<br />– {price(stock.plan.entryMax)}</> : <span className="text-slate-400">Belum tersedia</span>}</td>
            <td className="px-4 py-4 text-xs font-semibold">{stock.plan ? <><p className="text-rose-600">{price(stock.plan.stop)}</p><p className="mt-1 text-emerald-600">{price(stock.plan.target)}</p></> : "—"}</td>
            <td className="px-4 py-4 text-xs font-semibold">{stock.plan ? <><p className="text-rose-600">Risk {stock.plan.riskPercent.toFixed(1)}%</p><p className="mt-1 text-emerald-600">Reward {stock.plan.potentialRewardPercent.toFixed(1)}%</p><p className="mt-1 font-bold text-slate-800">1 : {stock.plan.netRewardRisk.toFixed(2)}</p></> : "—"}</td>
            <td className="px-4 py-4"><p className="font-bold">Overall {stock.score}<span className="text-xs font-normal text-slate-400"> /100</span></p><p className="mt-1 text-xs text-slate-600">Setup {stock.setupQuality} · Entry {stock.entryQuality}</p><div className="mt-2 h-1 w-16 rounded bg-slate-100"><div className="h-1 rounded bg-indigo-500" style={{ width: `${stock.score}%` }} /></div></td>
            <td className="px-4 py-4"><button aria-expanded={expanded === stock.symbol} aria-controls={`detail-${stock.symbol}`} onClick={() => setExpanded(expanded === stock.symbol ? undefined : stock.symbol)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">{expanded === stock.symbol ? "Tutup" : "Detail"}</button></td>
          </tr>{expanded === stock.symbol && <tr id={`detail-${stock.symbol}`}><td colSpan={9} className="bg-slate-50 px-5 py-5"><StockDetail stock={stock} /></td></tr>}</Fragment>)}</tbody>
        </table></div>
        {loading && !snapshot && <p role="status" className="p-10 text-center text-sm text-slate-500">Memuat hasil scan harian yang tersimpan.</p>}
        {!loading && !results.length && <div className="p-10 text-center"><p className="font-semibold">{error && !snapshot ? "Data scan belum tersedia." : snapshot?.meta.universeSize === 0 ? "Tidak ada kandidat dari filter awal." : snapshot?.meta.scannedSize === 0 && snapshot.meta.failures.length ? "Histori seluruh kandidat gagal diproses." : "Belum ada saham yang sesuai filter."}</p><p className="mt-2 text-sm text-slate-500">Ubah minimum R:R untuk melihat setup dengan profil risiko berbeda.</p><button onClick={() => { setMinimumScore(0); setMinimumRewardRisk(0); setOnlyEligible(false); setSetup("all"); setQuery(""); }} className="mt-4 text-sm font-semibold text-indigo-600">Lihat semua hasil halaman ini</button></div>}
      </section>
      <nav aria-label="Halaman saham" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <button disabled={loading || page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-200 px-4 py-2 font-semibold disabled:opacity-40">Sebelumnya</button>
        <label className="flex items-center gap-2">Halaman<select aria-label="Pilih halaman saham" value={page} disabled={loading} onChange={event => setPage(Number(event.target.value))} className={inputClass}>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select><span>dari {pageCount}</span></label>
        <button disabled={loading || page >= pageCount} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-200 px-4 py-2 font-semibold disabled:opacity-40">Berikutnya</button>
        <p className="w-full text-xs text-slate-500">Filter berlaku untuk seluruh snapshot scan harian. Berpindah halaman tidak menjalankan analisis ulang.</p>
      </nav>
      <section className="mt-7 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Cara membaca kualitas</h2><p className="mt-3 text-sm leading-6 text-slate-600">{mode === "short" ? "Short swing hanya menerima breakout dengan volume, RSI 55–70, dan extension maksimal 1,5 ATR. Target maksimum 2R dan R:R net minimal 1:1,2 karena horizon hanya dua sesi." : "Setup Quality menilai struktur tren, breakout/pullback, volume, relative strength terhadap IHSG, turnover, dan regime pasar. Entry Quality menilai extension dari EMA20, risiko, R:R, RSI, posisi breakout, serta kualitas candle. Overall = Setup 60% + Entry 40%."}</p><p className="mt-3 text-xs leading-5 text-slate-500">{mode === "short" ? "Mode ini tetap memakai candle harian selesai dan tidak dapat menangkap pergerakan intraday." : "Target memakai resistance historis hingga 220 sesi. Jika tidak ada resistance valid, target diberi label Projected 3R; sistem tidak menaikkan target hanya untuk mengejar R:R."}</p></div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-bold text-amber-950">Rencana berlaku untuk sesi berikutnya</h2><p className="mt-3 text-sm leading-6 text-amber-900">{mode === "short" ? "Entry hanya pada open sesi berikutnya dalam zona. Stop dan target aktif sejak entry; posisi yang belum exit ditutup pada close sesi kedua." : "Entry hanya jika harga open berada dalam zona. Stop dan target aktif sejak entry; tidak perlu menunggu 3 sesi bila tersentuh. Mulai sesi ke-3, close di bawah EMA20 memicu exit pada open berikutnya. Batas waktu 15 sesi."}</p><p className="mt-3 text-xs leading-5 text-amber-800">Yahoo Finance · kuotasi IDX tertunda sekitar 10 menit. Scan memakai candle harian selesai. Gap dan suspensi dapat menggagalkan stop. Berita, kalender libur, status papan dan kelengkapan penyesuaian split Yahoo belum terverifikasi independen. Turnover adalah estimasi close × volume saham.</p></div>
      </section>
      <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-bold">Uji aturan yang sama</h2><p className="mt-1 text-sm text-slate-500">Simulasi histori 2 tahun untuk mode {mode === "short" ? "short swing 1–2 sesi" : "swing 3–15 sesi"} pada watchlist referensi terpisah. Kandidat filter hari ini tidak dipakai untuk menghindari bias seleksi tambahan.</p></div><button disabled={testing || loading} onClick={() => void runBacktest()} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">{testing ? "Menghitung backtest…" : "Jalankan backtest"}</button></div>
        {testError && <p role="alert" className="mt-4 text-sm text-rose-700">{testError}</p>}
        {backtest && <div className="mt-5"><div className="grid gap-4 sm:grid-cols-4"><Metric label="Transaksi" value={String(backtest.summary.trades)} note={`${backtest.summary.from} – ${backtest.summary.to}`} /><Metric label="Win rate net" value={backtest.summary.trades ? `${(backtest.summary.winRate * 100).toFixed(1)}%` : "—"} note={`Rata-rata hold ${backtest.summary.averageHoldingSessions.toFixed(1)} sesi`} /><Metric label="Return portofolio" value={percent(backtest.summary.cumulativeNetReturn * 100)} note="Modal sama per saham, termasuk idle cash" /><Metric label="Max drawdown" value={percent(backtest.summary.maxDrawdown * 100)} note="Dari nilai portofolio harian" /></div><details className="mt-4 text-sm text-slate-600"><summary className="cursor-pointer font-semibold">Asumsi dan keterbatasan backtest</summary><ul className="mt-3 space-y-2">{backtest.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></details></div>}
      </section>
      <p className="mt-7 pb-14 text-xs leading-5 text-slate-500">Screening edukatif; belum ada klaim edge atau peningkatan win rate yang tervalidasi. Estimasi biaya: beli 0,15%, jual 0,25%, slippage 0,10% per sisi. Sesuaikan dengan broker dan kondisi pasar.</p>
    </div>
  </main>;
}

function StockDetail({ stock }: { stock: ScreenerStock }) {
  const i = stock.indicators;
  return <div className="grid gap-5 lg:grid-cols-3">
    <div><h3 className="text-sm font-bold">Alasan & penghambat</h3><ul className="mt-3 space-y-2 text-xs leading-5">{stock.reasons.map((reason) => <li key={reason} className="text-emerald-800">✓ {reason}</li>)}{stock.warnings.map((warning) => <li key={warning} className="text-amber-900">• {warning}</li>)}</ul></div>
    <div><h3 className="text-sm font-bold">Indikator swing</h3><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs"><dt>Trend / IHSG</dt><dd>{stock.trend} / {stock.marketRegime}</dd><dt>RS 20D vs IHSG</dt><dd>{i.relativeStrength20 === null ? "—" : percent(i.relativeStrength20)}</dd><dt>ATR14 / ATR%</dt><dd>{i.atr14.toFixed(1)} / {i.atrPercent.toFixed(2)}%</dd><dt>Extension EMA20</dt><dd>{i.extensionAtr.toFixed(2)} ATR</dd><dt>Volume avg / median</dt><dd>{i.averageVolume20.toFixed(0)} / {i.medianVolume20.toFixed(0)}</dd><dt>Turnover avg / median</dt><dd>{turnover(i.averageTurnover20)} / {turnover(i.medianTurnover20)}</dd><dt>Close location</dt><dd>{(i.closeLocation * 100).toFixed(0)}%</dd><dt>Data quality</dt><dd>{stock.dataQuality.validBars} valid · {stock.dataQuality.skippedBars} skipped</dd></dl></div>
    <div><h3 className="text-sm font-bold">Rincian skor</h3><p className="mt-2 text-xs font-semibold">Setup Quality {stock.setupQuality}/100</p><dl className="mt-2 grid grid-cols-2 gap-2 text-xs">{Object.entries(stock.scoreBreakdown.setup).map(([label, value]) => <Fragment key={label}><dt className="capitalize">{label}</dt><dd className="font-semibold">{value}</dd></Fragment>)}</dl><p className="mt-3 text-xs font-semibold">Entry Quality {stock.entryQuality}/100</p><dl className="mt-2 grid grid-cols-2 gap-2 text-xs">{Object.entries(stock.scoreBreakdown.entry).map(([label, value]) => <Fragment key={label}><dt className="capitalize">{label}</dt><dd className="font-semibold">{value}</dd></Fragment>)}</dl>{stock.plan && <p className="mt-3 text-xs leading-5 text-slate-600">Risiko harga {stock.plan.riskPercent.toFixed(2)}% · potensi reward {stock.plan.potentialRewardPercent.toFixed(2)}% · R:R net 1 : {stock.plan.netRewardRisk.toFixed(2)}. Target {stock.plan.targetBasis === "historical-resistance" ? "resistance historis" : stock.plan.targetBasis === "projected-2R" ? "Projected 2R" : "Projected 3R"}{stock.plan.targetConfidence === "reduced" ? " (confidence berkurang karena data hilang)" : ""}. Maksimal {stock.plan.maxHoldingSessions} sesi.</p>}<Link href={`/analysis?symbol=${encodeURIComponent(stock.symbol)}`} className="mt-4 inline-block text-xs font-semibold text-indigo-600">Analisis swing {stock.symbol} →</Link></div>
  </div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold tracking-tight">{value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{note}</p></div>;
}

function RefreshStatus({ progress, compact = false }: { progress?: RefreshProgress; compact?: boolean }) {
  const percent = progress?.total ? Math.min(100, Math.round(progress.processed / progress.total * 100)) : 0;
  return <div role="status" className={compact ? "mx-auto max-w-md text-center" : "mb-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950"}>
    <p className="text-sm font-bold">Memperbarui scan Yahoo Finance</p>
    <p className="mt-1 text-xs leading-5 text-indigo-800">{progress ? `${progress.processed} dari ${progress.total} kandidat telah diproses. Halaman akan memperbarui otomatis setelah selesai.` : "Menyiapkan kandidat untuk scan. Halaman akan memperbarui otomatis."}</p>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-indigo-100"><div className="h-full rounded-full bg-indigo-600 transition-all duration-500" style={{ width: `${percent}%` }} /></div>
    <p className="mt-1 text-right text-xs font-semibold text-indigo-700">{progress ? `${percent}%` : "Memulai…"}</p>
  </div>;
}
