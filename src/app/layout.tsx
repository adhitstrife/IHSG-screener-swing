import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = { title: "IDX Swing Screener | Trend, Setup & Risk", description: "Screener swing saham IDX: tren 20/50 sesi, breakout dan pullback, likuiditas, serta rencana risiko untuk horizon 3–15 sesi." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="id"><body>{children}<div className="fixed bottom-5 right-5 z-50 flex gap-2"><Link href="/dividends" className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-indigo-700 shadow-lg ring-1 ring-indigo-100 transition hover:bg-indigo-50">Dividen</Link><Link href="/analysis" className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-700">✦ Analisa AI</Link></div></body></html>; }
