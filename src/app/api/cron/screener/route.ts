import { NextResponse } from "next/server";
import { getScreenerBatch, SCAN_BATCH_SIZE } from "@/lib/screener";
import { isStorageConfigured, saveScreenerRun } from "@/lib/screener-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

type BatchRequest = { offset?: unknown; universeId?: unknown };

function authorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  return Boolean(cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`);
}

function parseBatch(input: BatchRequest) {
  const offset = input.offset === undefined ? 0 : Number(input.offset);
  const universeId = input.universeId;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % SCAN_BATCH_SIZE !== 0) throw new Error(`offset harus kelipatan ${SCAN_BATCH_SIZE} yang tidak negatif.`);
  if (universeId !== undefined && (typeof universeId !== "string" || universeId.length < 16 || universeId.length > 128)) throw new Error("universeId tidak valid.");
  if (offset > 0 && !universeId) throw new Error("universeId wajib dikirim setelah batch pertama.");
  return { offset, universeId };
}

async function run(request: Request, input: BatchRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStorageConfigured()) return NextResponse.json({ error: "Supabase server credential belum dikonfigurasi." }, { status: 503 });
  try {
    const { offset, universeId } = parseBatch(input);
    const snapshot = await getScreenerBatch(offset, universeId, offset === 0);
    const published = await saveScreenerRun(snapshot);
    return NextResponse.json({ success: true, published, batch: { offset, size: snapshot.data.length + snapshot.meta.failures.length, nextOffset: snapshot.meta.nextOffset ?? null, universeId: snapshot.meta.universeId, universeSize: snapshot.meta.universeSize }, stocks: snapshot.data.length, failures: snapshot.meta.failures.length });
  } catch (error) {
    console.error("Screener batch failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scheduler gagal menjalankan screening." }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return run(request, { offset: params.get("offset") ?? undefined, universeId: params.get("universeId") ?? undefined });
}

export async function POST(request: Request) {
  let body: BatchRequest;
  try { body = await request.json() as BatchRequest; }
  catch { return NextResponse.json({ error: "Body JSON wajib berisi offset dan, setelah batch pertama, universeId." }, { status: 400 }); }
  return run(request, body);
}
