/* =====================================================================
   ياهو كمزوّد — غلافٌ حول `lib/yahoo.mjs` بلا تغييرٍ في منطقه.

   **قدرتُه المعلَنة هي كلُّ الفائدة هنا**: `extendedHours: true` لأنه
   يعطي أسعار ما قبل الافتتاح فعلاً، و`extendedVolume: false` لأنه
   يعطي حجمها صفراً — قياسٌ لا تقدير:

     MSFT/TSLA/AAPL/SPY · خمسة أيام · فريم ‎5د‎ بـ`includePrePost=true`
     PRE: ‎66‎ شمعة / حجم ‎0‎   ·  REG: ‎78‎ شمعة / ‎9–60‎ مليون
     POST: ‎48‎ شمعة / حجم ‎0‎

   فالبوابة التي تحتاج حجماً تقرأ `caps.extendedVolume` وتُعلن `off`
   بنصّها بدل أن تقسم على صفرٍ أو تعامله «لا تداول». وهذا هو الفرق
   الذي تقوم عليه قاعدة المشروع: «اعرض ‎—‎ لا رقماً ملفّقاً».

   ولذلك أيضاً `slimExtended` تكتب `v: null` للشمعة الممتدة لا `0`:
   `0` تعني «لم يتداول أحد» و`null` تعني «لا نعرف»، والمؤشّرات
   (`hasVol` في `indicators.js`) تفرّق بينهما أصلاً.
   ===================================================================== */
import {
  fetchChart, fetchQuotes as yQuotes, fetchStooqDaily, num, tradingPeriodFromMeta, stats
} from "../lib/yahoo.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, "stocks/session.js"));

export const id = "yahoo";

export const caps = {
  id,
  markets: ["equity", "index"],
  extendedHours: true,
  extendedVolume: false,          // ← قياسٌ لا افتراض، انظر الترويسة
  volumeScope: "consolidated",    // للشمعات الرسمية وحدها
  websocket: false,
  batch: true,
  batchSize: 40,                  // حدُّ رابط `v7/quote`
  timeframes: ["1m", "5m", "15m", "1h", "1d"],
  vwap: false,
  tradeCount: false,
  corporateActions: true,
  rateLimit: { perMinute: null }  // غير معلَن — والقاطع في lib/yahoo يتكفّل
};

export function available() { return true; }   // بلا مفتاح

const RANGE = { "1m": "7d", "5m": "60d", "15m": "60d", "1h": "730d", "1d": "5y" };

export async function getCandles(symbol, tf, opt = {}) {
  const extended = opt.session === "extended";
  const { candles, meta } = await fetchChart(symbol, {
    range: opt.range || RANGE[tf] || "60d",
    interval: tf,
    prePost: extended
  });
  const out = extended ? markUnknownVolume(candles, symbol) : candles;
  return {
    candles: opt.from ? out.filter(c => c.t >= opt.from) : out,
    meta: { source: id, period: tradingPeriodFromMeta(meta), price: num(meta?.regularMarketPrice) }
  };
}

/* الشمعة الممتدة من ياهو حجمُها مجهول لا صفر. والرسمية تبقى كما هي —
   صفرُها الحقيقي (شمعةٌ لم يُتداول فيها) معلومةٌ صحيحة. */
function markUnknownVolume(candles, symbol) {
  return candles.map(c => (
    S.isExtendedBar(c.t) && !(c.v > 0) ? { ...c, v: null } : c
  ));
}

export const getHistoricalCandles = getCandles;

/* =====================================================================
   الأسعار — وهنا **السطر الذي جمّد التطبيق كلَّه قبل الافتتاح**.

   `regularMarketPrice` لا يتحرّك قبل ‎09:30‎، و`preMarketPrice` حقلٌ
   منفصل. فالقراءةُ الأولى وحدها كانت تعطي إغلاق أمس طوال الجلسة
   الممتدة — وكلُّ ماسحٍ وخطةٍ واستراتيجية تقرأ ذلك الرقم.

   السعرُ هنا **سعرُ الجلسة الجارية**، ويُقال أيُّ جلسةٍ هو (`sess`)
   ويبقى `regular` بجانبه لمن يحتاج الإغلاق الرسمي (البيفوت، وحساب
   الفجوة، وخطّ أساس التغيّر).
   ===================================================================== */
export async function getQuotes(symbols) {
  const raw = await yQuotes(symbols);
  if (!raw) return null;
  const out = {};
  for (const [sym, q] of Object.entries(raw)) {
    const reg = num(q.regularMarketPrice);
    const pre = num(q.preMarketPrice);
    const post = num(q.postMarketPrice);
    /* `marketState` من ياهو نفسه حين يصل — وهو أدقُّ من حسابنا للحظةِ
       رمزٍ بعينه (رمزٌ موقوف عن التداول مثلاً). وحين يغيب نسقط إلى
       التقويم. */
    const state = q.marketState || S.sessionOf(Date.now());
    let price = reg, sess = "REGULAR", at = num(q.regularMarketTime);
    if ((state === "PRE" || state === "PREPRE") && pre !== null) {
      price = pre; sess = "PRE"; at = num(q.preMarketTime);
    } else if ((state === "POST" || state === "POSTPOST" || state === "CLOSED") && post !== null) {
      price = post; sess = "AFTER"; at = num(q.postMarketTime);
    }
    out[sym] = {
      symbol: sym,
      price, sess,
      at: at ? at * 1000 : null,
      regular: reg,
      regularChangePct: num(q.regularMarketChangePercent),
      prevClose: num(q.regularMarketPreviousClose),
      extChangePct: sess === "PRE" ? num(q.preMarketChangePercent)
                  : sess === "AFTER" ? num(q.postMarketChangePercent) : null,
      dayVolume: num(q.regularMarketVolume),
      avgVolume: num(q.averageDailyVolume10Day) ?? num(q.averageDailyVolume3Month),
      /* لا حجمَ للجلسة الممتدة عند ياهو — الحقل غير موجود أصلاً في
         الاستجابة، لا صفراً ولا `null`. نقولها صراحةً. */
      extVolume: null,
      w52h: num(q.fiftyTwoWeekHigh), w52l: num(q.fiftyTwoWeekLow),
      mc: num(q.marketCap)
    };
  }
  return out;
}

export async function getQuote(symbol) {
  const m = await getQuotes([symbol]);
  return m ? m[symbol] : null;
}

export async function getMarketStatus() {
  const st = S.statusAt(Date.now());
  return { at: Date.now(), open: st.state === "REGULAR", session: st.state, source: id };
}

/* البديل الأخير — يوميٌّ بلا مفتاح. يبقى هنا لأن انقطاع ياهو الكامل
   عن رمزٍ يحدث فعلاً، ويوميٌّ من Stooq خيرٌ من رمزٍ يختفي. */
export async function getDailyFallback(symbol) {
  const { candles } = await fetchStooqDaily(symbol);
  return { candles, meta: { source: "stooq" } };
}

export { stats as yahooStats };
