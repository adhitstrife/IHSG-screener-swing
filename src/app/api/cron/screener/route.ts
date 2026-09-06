import { NextResponse } from "next/server";
import { getScreenerPage } from "@/lib/screener";
import { isStorageConfigured, saveScreenerPage } from "@/lib/screener-storage";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStorageConfigured()) return NextResponse.json({ error: "Supabase server credential belum dikonfigurasi." }, { status: 503 });
  try {
    const snapshot = await getScreenerPage(1, undefined, true);
    await saveScreenerPage(snapshot);
    return NextResponse.json({ success: true, stocks: snapshot.data.length, meta: snapshot.meta });
  } catch {
    return NextResponse.json({ error: "Scheduler gagal menjalankan screening." }, { status: 502 });
  }
}
