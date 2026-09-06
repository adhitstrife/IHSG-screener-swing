import { NextResponse } from "next/server";
import { CandidatePageChangedError, getScreenerPage } from "@/lib/screener";
import { getCandidateUniverse } from "@/lib/yahoo-universe";
import { getStoredScreenerPage, saveScreenerPage } from "@/lib/screener-storage";

export const runtime = "nodejs";
export const maxDuration = 240;
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? 1);
    const refresh = params.get("refresh") === "1";
    if (!Number.isSafeInteger(page) || page < 1 || params.has("offset")) return NextResponse.json({ error: "Gunakan nomor halaman positif (page), bukan offset batch." }, { status: 400, headers });
    const candidates = await getCandidateUniverse(refresh);
    const expectedId = params.get("universeId");
    if (expectedId && expectedId !== candidates.id) throw new CandidatePageChangedError("Daftar kandidat berubah. Muat ulang dari halaman pertama.");
    const warnings: string[] = [];
    if (!refresh) {
      try {
        const stored = await getStoredScreenerPage(candidates.id, page);
        if (stored) return NextResponse.json(stored, { headers });
      } catch { warnings.push("Cache penyimpanan tidak tersedia."); }
    }
    const snapshot = await getScreenerPage(page, candidates.id, refresh, candidates);
    let persisted = false;
    try { persisted = await saveScreenerPage(snapshot); }
    catch (error) { warnings.push(error instanceof Error ? error.message : "Cache halaman belum tersimpan."); }
    return NextResponse.json({ ...snapshot, meta: { ...snapshot.meta, persisted, warnings: [...snapshot.meta.warnings, ...warnings] } }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal mengambil halaman saham." }, { status: error instanceof CandidatePageChangedError ? 409 : 502, headers });
  }
}
