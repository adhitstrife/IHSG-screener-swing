import { runBacktest } from "./backtest";

/** Fixed-rule evaluation: no in-sample parameter search masquerading as validation. */
export async function runStrategyResearch(force = false) {
  const result = await runBacktest(force);
  return {
    ...result,
    verdict: "unvalidated" as const,
    note: "Evaluasi historis aturan swing tetap. Parameter belum divalidasi out-of-sample; return historis positif saja tidak membuktikan edge.",
  };
}
