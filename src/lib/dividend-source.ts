import { createHash } from "node:crypto";
import { getData as getPdfWorker } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { kseiDate, parseKseiDividendText, type DividendEvent } from "./dividend-parser";

const KSEI = "https://web.ksei.co.id";
type ListedNotice = { url: string; announcementDate: string | null; sourceReference: string | null };

// Next.js bundles server modules separately, so pdf-parse cannot infer its
// adjacent worker file. Its packaged data URL keeps the worker self-contained
// on Vercel and in local Next.js runtimes.
PDFParse.setWorker(getPdfWorker());

function stripHtml(value: string) { return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); }

export function parseKseiCashDividendListing(html: string): ListedNotice[] {
  const notices: ListedNotice[] = [];
  for (const row of html.match(/<tr>[\s\S]*?<\/tr>/gi) ?? []) {
    if (!/Pembagian\s+Deviden|Pembagian\s+Dividen/i.test(row)) continue;
    const href = row.match(/href="([^"]+\.pdf)"/i)?.[1];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1]));
    if (!href || cells.length < 3) continue;
    notices.push({ url: new URL(href, KSEI).toString(), sourceReference: cells[0] || null, announcementDate: kseiDate(cells.at(-1) ?? "") });
  }
  return [...new Map(notices.map((notice) => [notice.url, notice])).values()];
}

async function textFromPdf(url: string) {
  const parser = new PDFParse({ url });
  try { return (await parser.getText()).text; } finally { await parser.destroy(); }
}

export async function getKseiDividendEvents(months: Array<{ year: number; month: number }>, extract = textFromPdf): Promise<{ events: DividendEvent[]; warnings: string[] }> {
  const warnings: string[] = []; const notices = new Map<string, ListedNotice>();
  for (const { year, month } of months) {
    try {
      const response = await fetch(`${KSEI}/publications/corporate-action-schedules/cash-dividend?Month=${String(month).padStart(2, "0")}&Year=${year}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      for (const notice of parseKseiCashDividendListing(await response.text())) notices.set(notice.url, notice);
    } catch (error) { warnings.push(`Daftar pengumuman KSEI ${String(month).padStart(2, "0")}/${year} gagal dibaca: ${error instanceof Error ? error.message : "error tidak dikenal"}.`); }
  }
  const events: DividendEvent[] = [];
  const queue = [...notices.values()]; let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const notice = queue[cursor++];
      try {
        const text = await extract(notice.url);
        const sourceHash = createHash("sha256").update(text).digest("hex");
        const event = parseKseiDividendText(text, { ...notice, sourceHash });
        if (event) events.push(event); else warnings.push(`Pengumuman KSEI ${notice.sourceReference ?? notice.url} tidak memiliki jadwal dividen tunai yang lengkap.`);
      } catch (error) { warnings.push(`Pengumuman KSEI ${notice.sourceReference ?? notice.url} gagal dibaca: ${error instanceof Error ? error.message : "error tidak dikenal"}.`); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
  return { events, warnings };
}

export function relevantMonths(now = new Date(), count = 12) {
  return Array.from({ length: count }, (_, index) => { const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1)); return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }; });
}
