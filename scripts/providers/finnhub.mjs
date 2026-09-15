/* =====================================================================
   Finnhub كمزوّد — أسعارٌ سحابية واحتياطٌ لا غير.

   **وقدرتُه المعلَنة هنا تصحّح فهماً كان سائداً في المشروع**: كنّا
   نعدّه «أسعاراً لحظية»، وهو كذلك داخل الجلسة الرسمية وحدها. قياسٌ
   مباشر اليوم ‎2026-09-15‎ الساعة ‎07:30 ET‎ (داخل ما قبل الافتتاح
   بثلاث ساعات ونصف):

     /quote MSFT → {"c":505.41, "t":1789416000}
                    ↑ إغلاق أمس     ↑ ختم أمس ‎16:00‎

   أي أنه لا يتحرّك قبل ‎09:30‎ إطلاقاً — لا سعراً ولا ختماً زمنياً.
   فالاعتماد عليه في الجلسة الممتدة يعطي رقماً **يبدو حيّاً وهو من
   أمس**، وهي نفس المصيدة التي جمّدت التطبيق. ولذلك
   `extendedHours: false` صراحةً، فلا يُختار لمهمّةٍ ممتدة أبداً.
   ===================================================================== */
import { fetchQuotesFinnhub, fhStats } from "../lib/finnhub.mjs";

export const id = "finnhub";

export const caps = {
  id,
  markets: ["equity"],
  extendedHours: false,          // ← قياس، انظر الترويسة
  extendedVolume: false,
  volumeScope: "consolidated",
  websocket: false,              // متاحٌ عندهم، غير مفعَّل عندنا
  batch: false,                  // طلبٌ لكل رمز
  batchSize: 1,
  timeframes: ["1d"],            // الشمعات ‎403‎ على الخطة المجانية
  vwap: false,
  tradeCount: false,
  corporateActions: false,
  rateLimit: { perMinute: 60 }
};

export function available() { return !!process.env.FINNHUB_API_KEY; }

export async function getQuotes(symbols, opt = {}) {
  const raw = await fetchQuotesFinnhub(symbols, opt);
  if (!raw) return null;
  const out = {};
  for (const [sym, q] of Object.entries(raw)) {
    const p = Number.isFinite(q.regularMarketPrice) ? q.regularMarketPrice : null;
    out[sym] = {
      symbol: sym, price: p, sess: "REGULAR",
      at: Number.isFinite(q.regularMarketTime) ? q.regularMarketTime * 1000 : null,
      regular: p,
      regularChangePct: Number.isFinite(q.regularMarketChangePercent) ? q.regularMarketChangePercent : null,
      prevClose: Number.isFinite(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : null,
      extChangePct: null, dayVolume: null, extVolume: null
    };
  }
  return out;
}

export async function getQuote(symbol) {
  const m = await getQuotes([symbol]);
  return m ? m[symbol] : null;
}

export async function getMarketStatus() {
  return { at: Date.now(), open: null, session: null, source: id };
}

export { fhStats };
