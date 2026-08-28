/* =====================================================================
   عميل Finnhub — مصدر الأسعار الأساسي (بديل موثوق عن Yahoo المحظور
   أحياناً من عناوين GitHub Actions). الخطة المجانية تغطي الأسعار
   اللحظية فقط، لا الشموع التاريخية — تلك تبقى من Yahoo/Stooq كمحاولة
   أفضل جهد غير معطِّلة.
   ===================================================================== */

const BASE = "https://finnhub.io/api/v1";
const TOKEN = process.env.FINNHUB_API_KEY || "";

export const fhStats = { requests: 0, failures: 0 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fhReq(path, params, { timeout = 15000 } = {}) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("token", TOKEN);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    fhStats.requests++;
    const r = await fetch(u.toString(), { signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`Finnhub HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    fhStats.failures++;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- دفعة أسعار — Finnhub لا يدعم عدة رموز بطلب واحد، فنطلب
   تباعاً بوتيرة تحترم حد 60 طلباً/دقيقة على الخطة المجانية.
   الشكل المُعاد مطابق تماماً لما كان يعيده Yahoo v7/finance/quote
   حتى لا نحتاج لمس بقية fetch-market.mjs. ---------- */
export async function fetchQuotesFinnhub(symbols, { pace = 1050 } = {}) {
  if (!TOKEN) throw new Error("FINNHUB_API_KEY غير مضبوط");
  const out = {};
  for (const sym of symbols) {
    try {
      const q = await fhReq("/quote", { symbol: sym });
      if (q && Number.isFinite(q.c) && q.c > 0) {
        const chg = Number.isFinite(q.pc) && q.pc ? (q.c - q.pc) / q.pc * 100 : null;
        out[sym] = {
          symbol: sym,
          regularMarketPrice: q.c,
          regularMarketChangePercent: chg,
          regularMarketPreviousClose: Number.isFinite(q.pc) ? q.pc : null,
          marketCap: null,
          regularMarketVolume: null,
          fiftyTwoWeekHigh: null,
          fiftyTwoWeekLow: null,
          preMarketPrice: null, preMarketChangePercent: null,
          postMarketPrice: null, postMarketChangePercent: null
        };
      }
    } catch (e) { /* رمز واحد فشل — تجاهله واستمر بالباقي */ }
    await sleep(pace);
  }
  return Object.keys(out).length ? out : null;
}
