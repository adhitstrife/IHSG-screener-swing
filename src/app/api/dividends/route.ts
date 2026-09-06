import { NextResponse } from "next/server";
import { getDividendPage, isDividendStorageConfigured } from "@/lib/dividend-storage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    if (!isDividendStorageConfigured()) {
      return NextResponse.json(
        {
          error:
            "Kalender dividen sedang disiapkan. Silakan coba kembali setelah sinkronisasi data resmi tersedia.",
          code: "DIVIDEND_STORAGE_NOT_CONFIGURED",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? 1);
    const view = params.get("view") === "pending" ? "pending" : "eligible";
    const search = (params.get("search") ?? "").trim().slice(0, 80);
    if (!Number.isSafeInteger(page) || page < 1) return NextResponse.json({ error: "Nomor halaman tidak valid." }, { status: 400 });
    return NextResponse.json(await getDividendPage(view, search, page), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kalender dividen belum tersedia." }, { status: 503 });
  }
}
