import type { ScreenerSnapshot, ScreenerStock } from "./screener";

/** Shared by the server and browser so stale checks span all batches. */
export function rankScanResults(rows: ScreenerStock[]) {
  const newest = rows.reduce((date, stock) => stock.asOf > date ? stock.asOf : date, "");
  return rows.map(stock => {
    if (!stock.stale && stock.asOf >= newest) return stock;
    const warning = "Data tertinggal terhadap kandidat lain atau >3 hari kerja; hari libur bursa belum terhubung.";
    return { ...stock, stale: true, eligible: false, signal: "Data tertinggal", warnings: [...new Set([...stock.warnings, warning])] };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || (b.plan?.netRewardRisk ?? 0) - (a.plan?.netRewardRisk ?? 0) || a.symbol.localeCompare(b.symbol));
}

export function mergeScanBatch(previous: ScreenerSnapshot | undefined, batch: ScreenerSnapshot): ScreenerSnapshot {
  if (!previous) return { ...batch, data: rankScanResults(batch.data) };
  if (previous.meta.universeId !== batch.meta.universeId || previous.meta.nextOffset !== batch.meta.batchOffset) throw new Error("Urutan/cakupan batch berubah. Jalankan scan ulang.");
  return { data: rankScanResults([...previous.data, ...batch.data]), meta: { ...batch.meta,
    generatedAt: previous.meta.generatedAt, scannedSize: previous.meta.scannedSize + batch.meta.scannedSize,
    failures: [...previous.meta.failures, ...batch.meta.failures], warnings: [...new Set([...previous.meta.warnings, ...batch.meta.warnings])],
  } };
}
