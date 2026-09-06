import { NextResponse } from "next/server";
import { getKseiDividendEvents, relevantMonths } from "@/lib/dividend-source";
import { isDividendStorageConfigured, recordDividendSyncFailure, upsertDividendEvents } from "@/lib/dividend-storage";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDividendStorageConfigured()) return NextResponse.json({ error: "Supabase server credential belum dikonfigurasi." }, { status: 503 });
  try {
    const bootstrap = new URL(request.url).searchParams.get("bootstrap") === "1";
    const months = relevantMonths(new Date(), bootstrap ? 12 : 3);
    const result = await getKseiDividendEvents(months);
    const coverageStart = `${months.at(-1)!.year}-${String(months.at(-1)!.month).padStart(2, "0")}-01`;
    await upsertDividendEvents(result.events, { coverageStart, warnings: result.warnings });
    return NextResponse.json({ success: true, events: result.events.length, warnings: result.warnings, coverageStart });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sinkronisasi dividen gagal.";
    await recordDividendSyncFailure(message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
