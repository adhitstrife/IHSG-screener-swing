"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

type Analysis = {
  source: string; symbol: string; asOf: string; verdict: "LAYAK_DIPERTIMBANGKAN" | "TUNGGU_KONFIRMASI" | "HINDARI_SEMENTARA";
  confidence: number; summary: string; positives: string[]; risks: string[];
  levels: { buyTarget: number | null; sellTarget: number | null; cutLoss: number | null; rationale: string };
  tradePlan: { entryCondition: string; invalidation: string; exitPlan: string };
  fundamental: { score: number; summary: string; positives: string[]; risks: string[]; data: FundamentalData; web: { coverage: "available" | "not-configured" | "unavailable"; warning: string | null }; sources: WebSource[] };
  disclaimer: string;
};
type FundamentalMetric = { value: number; asOf: string; currency?: string } | null;
type FundamentalData = { companyName: string | null; sector: string | null; industry: string | null; marketCap: FundamentalMetric; annualRevenue: FundamentalMetric; annualNetIncome: FundamentalMetric; annualDilutedEps: FundamentalMetric; revenueGrowthPercent: number | null; netIncomeGrowthPercent: number | null; epsGrowthPercent: number | null };
type WebSource = { title: string; url: string; snippet: string; publishedDate: string | null };

const colors = {
  LAYAK_DIPERTIMBANGKAN: "border-emerald-200 bg-emerald-50 text-emerald-800",
  TUNGGU_KONFIRMASI: "border-amber-200 bg-amber-50 text-amber-800",
  HINDARI_SEMENTARA: "border-rose-200 bg-rose-50 text-rose-800",
};

export default function AnalysisPage() {
  const [symbol, setSymbol] = useState(""); const [analysis, setAnalysis] = useState<Analysis>();
  const [error, setError] = useState<string>(); const [loading, setLoading] = useState(false);
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("symbol") ?? "";
    if (/^[A-Z]{4}$/.test(initial)) {
      const timer = window.setTimeout(() => setSymbol(initial), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(undefined); setAnalysis(undefined);
    try {
      const response = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol }) });
      const data = await response.json() as Analysis & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Analisis gagal dibuat.");
      setAnalysis(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Analisis gagal dibuat."); } finally { setLoading(false); }
  }
  return <main className="min-h-screen bg-[#f6f8fb] px-5 py-10 text-slate-900"><div className="mx-auto max-w-3xl">
    <Link href="/" className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">← Kembali ke screener</Link>
    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><p className="text-sm font-bold text-indigo-600">Analisis Swing Saham IDX · 3–15 sesi</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Periksa rencana swing satu saham.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">AI menjelaskan setup teknikal, fundamental Yahoo Finance, dan bila pencarian web dikonfigurasi, konteks berita terbaru beserta sumbernya. Level entry, stop, dan target tetap dihitung engine dari candle harian.</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-3 sm:flex-row"><input aria-label="Kode saham IDX" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} maxLength={10} required placeholder="Contoh: BBCA" className="flex-1 rounded-xl border border-slate-300 px-4 py-3 font-semibold uppercase outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /><button disabled={loading} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Menganalisis…" : "Analisa saham"}</button></form>
      {error && <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
    </section>
    {analysis && <section className="mt-6 space-y-5"><div className={`rounded-2xl border p-5 ${colors[analysis.verdict]}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{analysis.verdict.replaceAll("_", " ")}</p><p className="text-sm font-semibold">Keyakinan AI {analysis.confidence}/100 · bukan peluang profit</p></div><p className="mt-3 text-sm leading-6">{analysis.summary}</p><p className="mt-3 text-xs opacity-80">{analysis.source} · {analysis.symbol} · {analysis.asOf}</p></div>
      <div className="grid gap-5 md:grid-cols-2"><Insight title="Faktor pendukung" items={analysis.positives} tone="positive" /><Insight title="Risiko" items={analysis.risks} tone="risk" /></div>
      <FundamentalCard fundamental={analysis.fundamental} />
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold text-indigo-950">Level rencana swing</h2><span className="text-xs font-semibold text-indigo-700">Hanya aktif untuk verdict layak</span></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><Level label="Target beli" value={analysis.levels.buyTarget} tone="buy" /><Level label="Target jual" value={analysis.levels.sellTarget} tone="sell" /><Level label="Cut-loss" value={analysis.levels.cutLoss} tone="cut" /></div><p className="mt-4 text-xs leading-5 text-indigo-900">{analysis.levels.rationale}</p></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Rencana evaluasi 3–15 sesi</h2><dl className="mt-4 space-y-3 text-sm"><Row label="Entry" value={analysis.tradePlan.entryCondition} /><Row label="Invalidasi" value={analysis.tradePlan.invalidation} /><Row label="Exit" value={analysis.tradePlan.exitPlan} /></dl></div>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">{analysis.disclaimer} Skor fundamental AI bukan rating kredit, target harga, atau peluang profit.</p>
    </section>}
  </div></main>;
}

function Insight({ title, items, tone }: { title: string; items: string[]; tone: "positive" | "risk" }) { const color = tone === "positive" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"; return <div className={`rounded-2xl border p-5 ${color}`}><h2 className="font-bold">{title}</h2><ul className="mt-3 space-y-2 text-sm leading-5">{items.length ? items.map((item) => <li key={item}>• {item}</li>) : <li>• Tidak ada data yang cukup.</li>}</ul></div>; }
function FundamentalCard({ fundamental }: { fundamental: Analysis["fundamental"] }) { const data = fundamental.data; const coverage = fundamental.web.coverage === "available" ? "Pencarian web aktif" : fundamental.web.coverage === "not-configured" ? "Pencarian web belum dikonfigurasi" : "Pencarian web sementara tidak tersedia"; return <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-violet-950">Fundamental & konteks web</h2><p className="mt-1 text-xs text-violet-800">{data.companyName ?? "Emiten IDX"}{data.sector ? ` · ${data.sector}` : ""}{data.industry ? ` · ${data.industry}` : ""}</p></div><span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-violet-900">Skor fundamental AI {fundamental.score}/100</span></div><p className="mt-3 text-sm leading-6 text-violet-950">{fundamental.summary}</p><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><Metric label="Pendapatan tahunan" metric={data.annualRevenue} growth={data.revenueGrowthPercent} /><Metric label="Laba bersih tahunan" metric={data.annualNetIncome} growth={data.netIncomeGrowthPercent} /><Metric label="EPS diluted" metric={data.annualDilutedEps} growth={data.epsGrowthPercent} /><Metric label="Kapitalisasi pasar" metric={data.marketCap} /></div><div className="mt-5 grid gap-4 md:grid-cols-2"><Insight title="Faktor fundamental" items={fundamental.positives} tone="positive" /><Insight title="Risiko & keterbatasan" items={fundamental.risks} tone="risk" /></div><p className="mt-4 text-xs font-semibold text-violet-900">{coverage}{fundamental.web.warning ? ` · ${fundamental.web.warning}` : ""}</p>{fundamental.sources.length > 0 && <div className="mt-4"><h3 className="text-sm font-bold text-violet-950">Sumber web yang dipakai AI</h3><ul className="mt-2 space-y-3">{fundamental.sources.map((source) => <li key={source.url} className="rounded-xl border border-violet-200 bg-white p-3 text-xs leading-5 text-slate-700"><a href={source.url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline">{source.title}</a>{source.publishedDate && <span className="ml-2 text-slate-500">{source.publishedDate}</span>}{source.snippet && <p className="mt-1">{source.snippet}</p>}</li>)}</ul></div>}</section>; }
function Metric({ label, metric, growth }: { label: string; metric: FundamentalMetric; growth?: number | null }) { const currency = metric?.currency === "IDR" ? "Rp" : metric?.currency ? `${metric.currency} ` : ""; const value = metric ? `${currency}${new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 2 }).format(metric.value)}` : "—"; return <div className="rounded-xl border border-violet-200 bg-white p-3"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 font-bold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-500">{metric ? `${metric.asOf}${growth !== null && growth !== undefined ? ` · ${growth >= 0 ? "+" : ""}${growth.toFixed(1)}% YoY` : ""}` : "Belum tersedia"}</p></div>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="grid gap-1 sm:grid-cols-[100px_1fr]"><dt className="font-semibold text-slate-500">{label}</dt><dd className="text-slate-700">{value}</dd></div>; }
function Level({ label, value, tone }: { label: string; value: number | null; tone: "buy" | "sell" | "cut" }) { const color = tone === "buy" ? "border-indigo-200 bg-white text-indigo-950" : tone === "sell" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-rose-200 bg-rose-50 text-rose-950"; return <div className={`rounded-xl border p-4 ${color}`}><p className="text-xs font-semibold opacity-70">{label}</p><p className="mt-1 text-lg font-bold">{value ? `Rp${new Intl.NumberFormat("id-ID").format(value)}` : "—"}</p></div>; }
