import { NextResponse } from "next/server";
import { getScreenerSnapshot } from "@/lib/screener";
import { isStorageConfigured, saveScreenerRun } from "@/lib/screener-storage";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStorageConfigured()) return NextResponse.json({ error: "Supabase server credential belum dikonfigurasi." }, { status: 503 });
  try {
    const snapshot = await getScreenerSnapshot(true);
    const persisted = await saveScreenerRun(snapshot);
    if (!persisted) throw new Error("Snapshot harian tidak tersimpan.");
    return NextResponse.json({ success: true, stocks: snapshot.data.length, failures: snapshot.meta.failures.length, meta: snapshot.meta });
  } catch {
    return NextResponse.json({ error: "Scheduler gagal menjalankan screening." }, { status: 502 });
  }
}
