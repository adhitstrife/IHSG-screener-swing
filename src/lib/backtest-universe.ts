import { toYahooSymbol } from "./yahoo-data";
const defaultUniverse = [
  { symbol: "BBRI", name: "Bank Rakyat Indonesia" }, { symbol: "BBCA", name: "Bank Central Asia" },
  { symbol: "TLKM", name: "Telkom Indonesia" }, { symbol: "ANTM", name: "Aneka Tambang" },
  { symbol: "ASII", name: "Astra International" }, { symbol: "BMRI", name: "Bank Mandiri" },
  { symbol: "INDF", name: "Indofood Sukses Makmur" }, { symbol: "ICBP", name: "Indofood CBP Sukses Makmur" },
  { symbol: "UNTR", name: "United Tractors" }, { symbol: "KLBF", name: "Kalbe Farma" },
];

function configuredUniverse() {
  const configured = process.env.BACKTEST_SYMBOLS;
  if (!configured) return defaultUniverse;
  const symbols = [...new Set(configured.split(",").map((symbol) => symbol.trim()).filter(Boolean).map((symbol) => toYahooSymbol(symbol).slice(0, -3)))];
  if (!symbols.length) throw new Error("BACKTEST_SYMBOLS tidak boleh kosong.");
  return symbols.map((symbol) => defaultUniverse.find((stock) => stock.symbol === symbol) ?? { symbol, name: symbol });
}
export const backtestUniverse = configuredUniverse();

