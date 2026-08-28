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
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`Finnhub HTTP ${r.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
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
  let firstErr = null, errCount = 0;
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
      } else if (!firstErr) {
        firstErr = `استجابة بلا سعر صالح: ${JSON.stringify(q).slice(0, 200)}`;
      }
    } catch (e) { errCount++; if (!firstErr) firstErr = e.message; }
    await sleep(pace);
  }
  if (firstErr) console.warn(`  ⚠ Finnhub: أول خطأ من ${errCount}: ${firstErr}`);
  return Object.keys(out).length ? out : null;
}

const n = (v) => Number.isFinite(v) ? v : null;

/* ---------- بيانات أساسية — profile2 (قيمة سوقية وقطاع) + metric (مضاعفات
   ونسب) لكل رمز، بديل عن quoteSummary من Yahoo عند تعطّله. الخطة المجانية
   لا تعيد موعد الأرباح أو توصية المحللين فتبقى null هنا (تُعرض شرطة). ---------- */
export async function fetchFundamentalsFinnhub(symbols, { pace = 1050 } = {}) {
  if (!TOKEN) throw new Error("FINNHUB_API_KEY غير مضبوط");
  const out = {};
  for (const sym of symbols) {
    try {
      const [profile, metricRes] = await Promise.all([
        fhReq("/stock/profile2", { symbol: sym }),
        fhReq("/stock/metric", { symbol: sym, metric: "all" })
      ]);
      const m = metricRes?.metric || {};
      const mc = n(profile?.marketCapitalization) ? profile.marketCapitalization * 1e6 : null;
      out[sym] = {
        mc, pe: n(m.peTTM), fpe: null, pb: n(m.pbAnnual),
        eps: n(m.epsInclExtraItemsTTM) ?? n(m.epsTTM),
        divY: n(m.currentDividendYieldTTM), divRate: n(m.dividendPerShareTTM),
        beta: n(m.beta), w52h: n(m["52WeekHigh"]), w52l: n(m["52WeekLow"]),
        avgVol: n(m["10DayAverageTradingVolume"]) ? m["10DayAverageTradingVolume"] * 1e6 : null,
        shares: n(profile?.shareOutstanding) ? profile.shareOutstanding * 1e6 : null,
        margin: n(m.netProfitMarginTTM) ? m.netProfitMarginTTM / 100 : null,
        revGrow: n(m.revenueGrowthTTMYoy) ? m.revenueGrowthTTMYoy / 100 : null,
        roe: n(m.roeTTM) ? m.roeTTM / 100 : null,
        target: null, rec: null, recN: null, earnings: null,
        sector: profile?.finnhubIndustry || null, industry: profile?.finnhubIndustry || null,
        staff: null, site: profile?.weburl || null, about: null
      };
    } catch (e) { /* رمز واحد فشل — تجاهله واستمر بالباقي */ }
    await sleep(pace);
  }
  return out;
}
