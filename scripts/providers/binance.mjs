/* =====================================================================
   Binance كمزوّد — غلافٌ حول `lib/binance.mjs` بلا تغييرٍ في منطقه.

   الكريبتو لا «جلسة ممتدة» له: السوق مفتوحٌ ‎24/7‎ فكلُّ شمعةٍ رسمية.
   ولذلك `extendedHours: false` و`extendedVolume: true` معاً — وهو ليس
   تناقضاً: لا توجد جلسةٌ ممتدة أصلاً، والحجم حقيقيٌّ في كل شمعة.
   ===================================================================== */
import { fetchCandles, fetchQuotes as bnQuotes, bnStats, toApp, toBinance } from "../lib/binance.mjs";

export const id = "binance";

export const caps = {
  id,
  markets: ["crypto"],
  extendedHours: false,
  extendedVolume: true,
  volumeScope: "exchange",
  websocket: true,
  batch: true,
  batchSize: 1000,
  timeframes: ["1m", "5m", "15m", "1h", "4h", "1d"],
  vwap: false,
  tradeCount: true,
  corporateActions: false,
  rateLimit: { perMinute: 6000 }     // وزناً لا طلبات؛ وزنُ الشمعات ‎2‎
};

export function available() { return true; }

export async function getCandles(symbol, tf, opt = {}) {
  const { candles } = await fetchCandles(symbol, { interval: tf, limit: opt.limit });
  return { candles, meta: { source: id } };
}
export const getHistoricalCandles = getCandles;

export async function getQuotes(symbols) {
  const raw = await bnQuotes(symbols);
  if (!raw) return null;
  const out = {};
  for (const [sym, q] of Object.entries(raw)) {
    const p = q.regularMarketPrice ?? null;
    out[sym] = {
      symbol: sym, price: p, sess: "OPEN24", at: Date.now(),
      regular: p, regularChangePct: q.regularMarketChangePercent ?? null,
      prevClose: null, extChangePct: null,
      dayVolume: q.regularMarketVolume ?? null, extVolume: null
    };
  }
  return out;
}
export async function getQuote(symbol) {
  const m = await getQuotes([symbol]);
  return m ? m[symbol] : null;
}

export async function getMarketStatus() {
  return { at: Date.now(), open: true, session: "OPEN24", source: id };
}

export { bnStats, toApp, toBinance };
