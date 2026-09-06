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
        <div className="fixed bottom-5 right-5 z-50 flex gap-2">
          <Link
            href="/dividends"
            className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-indigo-700 shadow-lg ring-1 ring-indigo-100 transition hover:bg-indigo-50"
          >
            Dividen
          </Link>
          <Link
            href="/analysis"
            className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-700"
          >
            ✦ Analisa AI
          </Link>
        </div>
        <Analytics />
      </body>
    </html>
  );
}
