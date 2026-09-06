const test = require("node:test");
const assert = require("node:assert/strict");
const { kseiDate, parseKseiDividendText } = require("../.test-build/dividend-parser");
const { parseKseiCashDividendListing, relevantMonths } = require("../.test-build/dividend-source");

const source = { url: "https://web.ksei.co.id/Announcement/Files/TRIS_DIV_20260911_ID.pdf", announcementDate: "2026-09-02", sourceReference: "KSEI-22254/JKU/0926", sourceHash: "fixture" };
const tris = `Jadwal Pelaksanaan Pembagian Deviden Interim atas Efek TRISULA INTERNATIONAL Tbk (TRIS).
Tanggal Cum Dividen di Pasar Reguler & Pasar Negosiasi 9 September 2026
Tanggal Ex Dividen di Pasar Regular & Pasar Negosiasi 10 September 2026
Tanggal Cum Dividen di Pasar Tunai 11 September 2026
14 September 2026 Tanggal Pencatatan (Recording Date) 11 September 2026
23 September 2026 Tanggal Ex Dividen di Pasar Tunai Tanggal Pembayaran Dividen Interim
Setiap 1 (Satu) saham akan mendapatkan dividen interim sebesar Rp.2,27
Kode dan Nama Saham : TRIS, TRISULA INTERNATIONAL Tbk Kode ISIN Saham`;

test("parses KSEI regular-market dates, decimal dividend and payment date", () => {
  const event = parseKseiDividendText(tris, source);
  assert.deepEqual(event && { symbol: event.symbol, companyName: event.companyName, dividendPerShare: event.dividendPerShare, cumDateRegular: event.cumDateRegular, exDateRegular: event.exDateRegular, recordDate: event.recordDate, paymentDate: event.paymentDate, dividendKind: event.dividendKind }, { symbol: "TRIS", companyName: "TRISULA INTERNATIONAL Tbk", dividendPerShare: 2.27, cumDateRegular: "2026-09-09", exDateRegular: "2026-09-10", recordDate: "2026-09-11", paymentDate: "2026-09-23", dividendKind: "Interim" });
});

test("parses KSEI whole-rupiah amount and rejects incomplete schedules", () => {
  const event = parseKseiDividendText(tris.replaceAll("TRIS", "DKFT").replace("Rp.2,27", "Rp.30,-").replace("9 September", "11 September").replace("10 September", "14 September").replace("11 September 2026\n23", "15 September 2026\n21"), { ...source, sourceHash: "dkft" });
  assert.equal(event?.dividendPerShare, 30); assert.equal(event?.cumDateRegular, "2026-09-11");
  assert.equal(parseKseiDividendText("Kode dan Nama Saham : BAD, incomplete", source), null);
});

test("listing parser retains only official cash dividend PDF notices and deduplicates URLs", () => {
  const html = `<tr><td><a href="/Announcement/Files/TRIS_DIV.pdf">KSEI-1</a></td><td>Jadwal Pelaksanaan Pembagian Deviden Interim atas Efek TRIS</td><td>02 September 2026</td></tr><tr><td><a href="/Announcement/Files/TRIS_DIV.pdf">KSEI-1</a></td><td>Jadwal Pelaksanaan Pembagian Deviden Interim atas Efek TRIS</td><td>02 September 2026</td></tr><tr><td><a href="/x.pdf">KSEI-2</a></td><td>Distribusi HMETD</td><td>02 September 2026</td></tr>`;
  assert.deepEqual(parseKseiCashDividendListing(html), [{ url: "https://web.ksei.co.id/Announcement/Files/TRIS_DIV.pdf", sourceReference: "KSEI-1", announcementDate: "2026-09-02" }]);
});

test("uses Indonesian dates and a bounded monthly source window", () => {
  assert.equal(kseiDate("9 September 2026"), "2026-09-09"); assert.equal(kseiDate("not a date"), null);
  assert.deepEqual(relevantMonths(new Date("2026-09-07T00:00:00Z"), 3), [{ year: 2026, month: 9 }, { year: 2026, month: 8 }, { year: 2026, month: 7 }]);
});
