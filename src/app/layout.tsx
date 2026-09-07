import type { Metadata } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IDX Swing Screener | Trend, Setup & Risk",
  description:
    "Screener swing saham IDX: tren 20/50 sesi, breakout dan pullback, likuiditas, serta rencana risiko untuk horizon 3–15 sesi.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <header className="sticky top-0 z-50 border-b border-slate-200 bg-white shadow-sm">
          <nav
            aria-label="Navigasi utama"
            className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3"
          >
            <Link href="/" className="font-bold tracking-tight text-slate-900">
              IDX Swing Screener
            </Link>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Link
                href="/"
                className="rounded-lg px-3 py-2 text-slate-700 transition hover:bg-slate-100 hover:text-indigo-700"
              >
                Screener
              </Link>
              <Link
                href="/dividends"
                className="rounded-lg px-3 py-2 text-white shadow-sm transition"
                style={{ backgroundColor: "#4f46e5" }}
              >
                Dividen
              </Link>
              <Link
                href="/analysis"
                className="rounded-lg px-3 py-2 text-white shadow-sm transition"
                style={{ backgroundColor: "#0f172a" }}
              >
                ✦ Analisa AI
              </Link>
            </div>
          </nav>
        </header>
        {children}
        <aside
          aria-label="Peringatan risiko investasi"
          className="border-y border-amber-200 bg-amber-50 px-5 py-4 text-amber-950"
        >
          <div className="mx-auto max-w-7xl">
            <p className="text-sm font-bold">Peringatan risiko investasi</p>
            <p className="mt-1 text-xs leading-5 sm:text-sm">
              Informasi di situs ini hanya untuk edukasi dan referensi, bukan
              ajakan, rekomendasi, atau nasihat untuk membeli maupun menjual
              saham. Gunakan dengan hati-hati; seluruh keputusan dan risiko
              investasi menjadi tanggung jawab Anda sendiri.
            </p>
          </div>
        </aside>
        <Analytics />
      </body>
    </html>
  );
}
