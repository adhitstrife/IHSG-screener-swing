import { createClient } from "@supabase/supabase-js";
import type { DividendEvent } from "./dividend-parser";
import { jakartaClock } from "./market-data";

export type DividendPage = { events: DividendEvent[]; total: number; syncedAt: string | null; coverageStart: string | null; warnings: string[] };
function admin() { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : undefined; }
export const isDividendStorageConfigured = () => Boolean(admin());

export async function upsertDividendEvents(events: DividendEvent[], options: { syncedAt?: string; coverageStart?: string; warnings?: string[] } = {}) {
  const client = admin(); if (!client) throw new Error("Supabase server credential belum dikonfigurasi.");
  const syncedAt = options.syncedAt ?? new Date().toISOString();
  if (events.length) {
    const { error } = await client.from("idx_cash_dividends").upsert(events.map((event) => ({ symbol: event.symbol, company_name: event.companyName, dividend_per_share: event.dividendPerShare, currency: event.currency, dividend_kind: event.dividendKind, cum_date_regular: event.cumDateRegular, ex_date_regular: event.exDateRegular, record_date: event.recordDate, payment_date: event.paymentDate, announcement_date: event.announcementDate, source_url: event.sourceUrl, source_reference: event.sourceReference, source_hash: event.sourceHash, synced_at: syncedAt })), { onConflict: "symbol,cum_date_regular,dividend_kind" });
    if (error) throw new Error("Dividen KSEI belum tersimpan. Terapkan migrasi database dividend calendar.");
  }
  const { error } = await client.from("dividend_sync_runs").insert({ synced_at: syncedAt, status: "completed", events_found: events.length, coverage_start: options.coverageStart ?? null, warnings: options.warnings ?? [] });
  if (error) {
    console.error("Dividend sync run storage failed", error);
    throw new Error("Status sinkronisasi dividen belum tersimpan.");
  }
}

export async function recordDividendSyncFailure(message: string) {
  const client = admin(); if (!client) return;
  await client.from("dividend_sync_runs").insert({ synced_at: new Date().toISOString(), status: "failed", events_found: 0, warnings: [message] });
}

export async function getDividendPage(view: "eligible" | "pending", search: string, page: number, pageSize = 10): Promise<DividendPage> {
  const client = admin(); if (!client) throw new Error("Kalender dividen memerlukan konfigurasi Supabase server.");
  const today = jakartaClock().date;
  let query = client.from("idx_cash_dividends").select("*", { count: "exact" });
  query = view === "eligible" ? query.gte("cum_date_regular", today) : query.lt("cum_date_regular", today).gte("payment_date", today);
  if (search) query = query.or(`symbol.ilike.%${search}%,company_name.ilike.%${search}%`);
  const { data, count, error } = await query.order(view === "eligible" ? "cum_date_regular" : "payment_date", { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error("Cache kalender dividen belum tersedia. Jalankan sinkronisasi KSEI.");
  const { data: latest } = await client.from("dividend_sync_runs").select("synced_at, coverage_start, warnings").eq("status", "completed").order("synced_at", { ascending: false }).limit(1).maybeSingle();
  return { events: (data ?? []).map((row) => ({ symbol: row.symbol, companyName: row.company_name, dividendPerShare: Number(row.dividend_per_share), currency: row.currency, dividendKind: row.dividend_kind, cumDateRegular: row.cum_date_regular, exDateRegular: row.ex_date_regular, recordDate: row.record_date, paymentDate: row.payment_date, announcementDate: row.announcement_date, sourceUrl: row.source_url, sourceReference: row.source_reference, sourceHash: row.source_hash })), total: count ?? 0, syncedAt: latest?.synced_at ?? null, coverageStart: latest?.coverage_start ?? null, warnings: latest?.warnings ?? [] };
}
