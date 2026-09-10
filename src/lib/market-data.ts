export type MarketCandle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Number of shares, normalized at the provider boundary. */
  volume: number;
};

export function jakartaClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (key: string) => parts.find((part) => part.type === key)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Conservative publication buffer after the regular market's post-close. */
export function completedDailyCandles(candles: MarketCandle[], now = new Date()) {
  const clock = jakartaClock(now);
  return candles.filter((candle) => candle.date < clock.date || (candle.date === clock.date && clock.minutes >= 16 * 60 + 30));
}

export function isFreshSnapshot(generatedAt: string, now = new Date()) {
  const generatedDate = new Date(generatedAt);
  const age = now.getTime() - generatedDate.getTime();
  if (!Number.isFinite(age) || age < 0 || age >= 15 * 60 * 1000) return false;
  const current = jakartaClock(now); const generated = jakartaClock(generatedDate);
  return current.date === generated.date && !(current.minutes >= 990 && generated.minutes < 990);
}

/** A daily screener run stays valid until the next completed weekday session.
 * This intentionally outlives the short-lived in-process Yahoo cache. */
export function isCurrentDailyScreenerRun(generatedAt: string, now = new Date()) {
  const generated = new Date(generatedAt);
  if (!Number.isFinite(generated.getTime()) || generated > now) return false;
  const current = jakartaClock(now);
  const cutoffMinutes = 16 * 60 + 30;
  const expected = new Date(`${current.date}T00:00:00Z`);
  if (current.minutes < cutoffMinutes || expected.getUTCDay() === 0 || expected.getUTCDay() === 6) {
    do expected.setUTCDate(expected.getUTCDate() - 1); while (expected.getUTCDay() === 0 || expected.getUTCDay() === 6);
  }
  const expectedDate = expected.toISOString().slice(0, 10);
  const generatedClock = jakartaClock(generated);
  const isWeekend = expected.getUTCDay() === 0 || expected.getUTCDay() === 6;
  if (isWeekend) return generatedClock.date === expectedDate;
  // During a weekday session, a scan made today still represents the latest
  // completed candle (yesterday's), so do not start a new scan per visit.
  if (current.minutes < cutoffMinutes) return generatedClock.date === current.date || generatedClock.date === expectedDate;
  // A scan made earlier today deliberately omits today's unfinished candle.
  // Once the publication buffer has passed, make it stale so the next page
  // visit produces a run that includes the completed daily session.
  return generatedClock.date === expectedDate && generatedClock.minutes >= cutoffMinutes;
}

/** Weekdays only: exchange holidays are deliberately not guessed. */
export function weekdayAge(date: string, now = new Date()) {
  const end = jakartaClock(now).date;
  const cursor = new Date(`${date}T00:00:00Z`);
  let age = 0;
  while (cursor.toISOString().slice(0, 10) < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) age++;
  }
  return age;
}

/** Reject corrupt series instead of silently turning missing prices into signals. */
export function normalizeDailyCandles(rows: unknown, volumeMultiplier = 1): MarketCandle[] {
  if (!Array.isArray(rows)) throw new Error("Format candle provider tidak valid.");
  const byDate = new Map<string, MarketCandle>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") throw new Error("Candle provider tidak valid.");
    const row = raw as Record<string, unknown>;
    const date = typeof row.date === "string" ? row.date.slice(0, 10) : "";
    const time = Date.parse(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error("Tanggal candle tidak valid.");
    const num = (key: string) => {
      const value = row[key];
      if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" || !Number.isFinite(Number(value))) throw new Error(`Nilai ${key} candle ${date} tidak valid.`);
      return Number(value);
    };
    const candle: MarketCandle = { date, open: num("open"), high: num("high"), low: num("low"), close: num("close"), volume: num("volume") * volumeMultiplier };
    if (Math.min(candle.open, candle.high, candle.low, candle.close) <= 0 || candle.volume < 0 || !Number.isFinite(candle.volume) || candle.high < Math.max(candle.open, candle.close, candle.low) || candle.low > Math.min(candle.open, candle.close)) throw new Error(`OHLCV candle ${date} tidak konsisten.`);
    const previous = byDate.get(date);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candle)) throw new Error(`Candle duplikat berbeda pada ${date}.`);
    byDate.set(date, candle);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
