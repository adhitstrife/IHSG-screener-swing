export type DividendEvent = {
  symbol: string; companyName: string; dividendPerShare: number; currency: "IDR";
  dividendKind: "Interim" | "Final" | "Cash"; cumDateRegular: string; exDateRegular: string | null;
  recordDate: string | null; paymentDate: string | null; announcementDate: string | null;
  sourceUrl: string; sourceReference: string | null; sourceHash: string;
};

const months: Record<string, string> = { Januari: "01", Februari: "02", Maret: "03", April: "04", Mei: "05", Juni: "06", Juli: "07", Agustus: "08", September: "09", Oktober: "10", November: "11", Desember: "12" };
const datePattern = "(\\d{1,2})\\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\\s+(\\d{4})";

export function kseiDate(value: string): string | null {
  const match = value.match(new RegExp(datePattern, "i"));
  if (!match) return null;
  const month = months[match[2][0].toUpperCase() + match[2].slice(1).toLowerCase()];
  return month ? `${match[3]}-${month}-${match[1].padStart(2, "0")}` : null;
}

const after = (text: string, label: string) => kseiDate(text.match(new RegExp(`${label}\\s*${datePattern}`, "i"))?.[0] ?? "");
const allDates = (text: string) => [...text.matchAll(new RegExp(datePattern, "gi"))].map((match) => kseiDate(match[0])).filter((date): date is string => !!date);

/** KSEI PDFs may serialize the two-column schedule out of visual order. Payment is
 * therefore the latest stated schedule date, never a date inferred from settlement. */
export function parseKseiDividendText(text: string, source: { url: string; announcementDate: string | null; sourceReference: string | null; sourceHash: string }): DividendEvent | null {
  const compact = text.replace(/\s+/g, " ").trim();
  const securityField = compact.match(/Kode dan Nama Saham\s+Kode ISIN Saham\s*:\s*([^:]+?)\s*:\s*([A-Z]{4})\s*,\s*([^:]+?)\s*:\s*ID\d+/i);
  const legacySecurityField = compact.match(/Kode dan Nama Saham\s*:\s*([A-Z]{4})\s*,\s*([^:]+?)(?:\s+Kode ISIN|$)/i);
  const titleField = compact.match(/Jadwal Pelaksanaan Pembagian Dividen.*?atas Efek\s+(.+?)\s*\(([A-Z]{4})\)/i) ?? compact.match(/Jadwal Pelaksanaan Pembagian Deviden.*?atas Efek\s+(.+?)\s*\(([A-Z]{4})\)/i);
  const symbol = securityField?.[2]?.toUpperCase() ?? legacySecurityField?.[1]?.toUpperCase() ?? titleField?.[2]?.toUpperCase();
  const companyName = securityField?.[1]?.trim() ?? securityField?.[3]?.trim() ?? legacySecurityField?.[2]?.trim() ?? titleField?.[1]?.trim();
  const amount = compact.match(/setiap\s+1\s*\([^)]*\)\s+saham\s+akan\s+mendapatkan\s+dividen(?:\s+(?:interim|final))?\s+sebesar\s+Rp\.?\s*([\d.,]+)/i)?.[1];
  const cumDateRegular = after(compact, "Tanggal Cum Dividen di Pasar Reguler\\s*&\\s*Pasar Negosiasi");
  if (!symbol || !companyName || !amount || !cumDateRegular) return null;
  const dividendPerShare = Number(amount.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(dividendPerShare) || dividendPerShare <= 0) return null;
  const scheduleDates = allDates(compact);
  const recordDate = after(compact, "Tanggal Pencatatan\\s*\\(Recording Date\\)");
  const later = scheduleDates.filter((date) => !recordDate || date >= recordDate).sort().at(-1) ?? null;
  return { symbol, companyName, dividendPerShare, currency: "IDR",
    dividendKind: /dividen\s+final/i.test(compact) ? "Final" : /dividen\s+interim/i.test(compact) ? "Interim" : "Cash",
    cumDateRegular, exDateRegular: after(compact, "Tanggal Ex Dividen di Pasar Regular\\s*&\\s*Pasar Negosiasi"),
    recordDate, paymentDate: later, announcementDate: source.announcementDate,
    sourceUrl: source.url, sourceReference: source.sourceReference, sourceHash: source.sourceHash };
}
