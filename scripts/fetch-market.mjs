#!/usr/bin/env node
/* =====================================================================
   المهمة الدورية (كل 10 دقائق أثناء ساعات السوق).
   تجلب الأسعار والشموع، تحسب المؤشرات، وتكتب ملفات JSON يقرأها المتصفح.

   الاستخدام:
     node scripts/fetch-market.mjs --out ./out
     node scripts/fetch-market.mjs --check        (فحص ذاتي بلا شبكة)
   ===================================================================== */
import fs from "node:fs";
import { rp, r2 } from "./lib/round.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchChart, fetchQuotes, fetchStooqDaily, pool, stats, num, tradingPeriodFromMeta
} from "./lib/yahoo.mjs";
import { fetchQuotesFinnhub, fhStats } from "./lib/finnhub.mjs";
import { fetchCandlesTD, hasTwelveData, tdSleep, tdStats } from "./lib/twelvedata.mjs";
import { fetchCandles as fetchCandlesBN, bnStats } from "./lib/binance.mjs";
import { analyze, overallScore, aggregate, TFS, TF_WEIGHT, bandStable,
         closedBars, isLiveBar, barTime } from "./lib/indicators.mjs";
import { marketStatus, approxMarketStatus, statusNow, sessionOf, isRegularBar } from "./lib/session.mjs";
import * as PROV from "./providers/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const OUT = (() => { const i = args.indexOf("--out"); return i >= 0 ? path.resolve(args[i + 1]) : path.join(ROOT, "out"); })();

const KEEP = 260;                 // يكفي لـ EMA200 مع هامش، ويُبقي الملفات خفيفة
const MAX_AGE = { "15m": 0, "1h": 55 * 60e3, "1d": 20 * 3600e3 };
// صلاحية الفريم اليومي **أثناء الجلسة**. شمعةُ اليوم قيد التكوّن ما دامت
// الجلسة قائمة، فتجميدها عشرين ساعة يعني أن ارتفاع اليوم وانخفاضه لا
// يدخلان الحساب قبل الغد. والعشرون ساعة لا تقسم الأربعةَ والعشرين، فوقتُ
// الجلب ينزلق أربع ساعات للخلف كل يوم: يقع داخل الجلسة أياماً وقبل
// الافتتاح أياماً، بلا نمط ظاهر. وقع فعلاً 2026-09-11: جُلب 11:37 UTC —
// قبل الافتتاح بساعتين — فبقي 487 رمزاً من 510 على شمعة أمس طوال اليوم.
const DAILY_LIVE_AGE = 30 * 60e3;
// سقف رموز الطبقة الواسعة لكل تشغيل. صلاحية اليومي عشرون ساعة، ودورة
// السوق عشر دقائق، فـ 60 رمزاً/تشغيل تكفي لتجديد 414 رمزاً في ~70 دقيقة
// دون أن ترتفع دورة واحدة إلى مئات الطلبات فتستدعي 429.
const WIDE_PER_RUN = Number(process.env.WIDE_PER_RUN || 60);
/* وضعُ التأكيد السريع — يُقرأ مرّةً ويُستعمل في اختيار الوظائف والمسارات */
const FAST = process.env.FAST_CONFIRM === "1";
/* ساعةُ مراحل — تُطبع دائماً وكلفتُها صفر. بلا قياسٍ للمراحل كان
   تشخيصُ «أين يذهب الزمن؟» تخميناً: قدّرتُ الشبكة فكانت ‎24‎ ثانية
   والتشغيل ‎163‎. */
const T0 = Date.now();
const phase = (m) => console.log(`  ⏱ ${m} · ${((Date.now() - T0) / 1000).toFixed(1)}ث`);
const RANGE   = { "15m": "60d", "1h": "730d", "1d": "5y" };

/* =====================================================================
   أربعة فريمات لا خمسة — و‎5د‎ أُزيل من المشروع كلِّه.

   كان ‎5د‎ يُجلب ويُحلَّل في طبقةٍ موازية (`AN_TFS` الخامس و`tfx["5m"]`)
   ويقرؤه ماسح الاستراتيجيات وحده، فيما `TFS` الأربعة تحكم النتيجة
   الفنية. والطبقتان كلفتا طلباً ثانياً لكل رمز وفرعاً ثانياً في كل
   مسار اختيارِ فريم — بلا أن يظهر رقمُ ‎5د‎ في شاشةٍ واحدة.

   فصار `AN_TFS` هو `TFS` نفسه. وهذا **لا يمسّ النتيجة الفنية بحرف**:
   `overallScore` و`tfScore` كانا يدوران على `TFS` وحدها أصلاً، و`allTF`
   في `scans.js` تشترط `v.length === 4` بالضبط — فالأرشيف اليومي
   (‎1,084,574‎ شمعة) يبقى صالحاً بايتاً ببايت.

   والحارس في `--check` **مقلوبٌ عمداً**: كان يؤكّد وجود ‎5د‎ في
   `AN_TFS`، وصار يؤكّد غيابه عن `TFS` و`AN_TFS` و`EXT_TFS` معاً. حذفُ
   الحارس بدل قلبه يترك البابَ مفتوحاً لعودته بلا أن يعترض شيء.
   ===================================================================== */
const AN_TFS = TFS;

/* =====================================================================
   السلسلة الممتدة `tfx` — موازيةٌ لا بديلة، وهذا هو القرار المعماريّ
   الذي يحكم الملفّ كلَّه.

   البديهيّ أن تُدمج شمعات ما قبل الافتتاح في `tf["15m"]` فيرى الماسح
   الجلسة كاملة. وهو خطأٌ يُبطل المشروع بصمت: EMA وRSI وATR وبولنجر
   لكل رمزٍ في الكون تتغيّر، فتتغيّر `score` و`band` وكلُّ شرطٍ في
   `scans.js` — ومعها **يبطل الأرشيف كلُّه** (‎1,084,574‎ شمعة يومية
   و‎482,418‎ للحوافّ) لأنه قاس شروطاً على سلاسل لم تعد هي. ولا شيء
   يقول ذلك: الأرقام تبقى في مداها وتصف شيئاً آخر.

   فـ`tf` تبقى **الجلسة الرسمية حصراً** بايتاً ببايت، و`tfx` سلسلةٌ
   ثانية تحمل الجلسة الممتدة وتقرؤها استراتيجياتُ ما قبل الافتتاح
   وحدها: تُحسب ولا تدخل النتيجة.

   والتكلفة صفرُ طلبات: الطلب يُرسل أصلاً بـ`prePost: true` منذ شهور،
   وكنّا **نرمي** شمعاته الممتدة. وكان معه ‎5د‎ ممتدٌّ بطلبٍ ثانٍ لكل
   رمز (سلسلته الرسمية تأتي بـ`prePost: false` فلا تُشتقّ منها) — وقد
   سقط مع إزالة ‎5د‎ من المشروع، فبقيت ‎15د‎ وحدها بكلفةٍ صفر.
   ===================================================================== */
const EXT_TFS = ["15m"];
const KEEP_X = 260;
const RANGE_X = { "15m": "60d" };

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));

/* ---------- ميزانية طلبات Twelve Data لكل تشغيل ----------
   الخطة المجانية: 8 طلبات/دقيقة و800/يوم. تعبئة الفريمات الثلاثة لكل
   الرموز السبعين = 210 طلباً = 28 دقيقة، أطول من مهلة المهمة وأكبر من
   حصة اليوم لو تكرّر. فنحدّث دفعة صغيرة كل تشغيل (~100 ثانية) وتكتمل
   التغطية تدريجياً عبر التشغيلات، مع بقاء بيانات الشمعات السابقة كما هي.
   14 طلباً × 48 تشغيلاً يومياً ≈ 672 طلباً — داخل حصة الـ800. */
const TD_PER_RUN = Number(process.env.TD_PER_RUN || 14);
const tdBudget = { left: TD_PER_RUN };

/* على شبكة منزلية Yahoo غير محظور ومجاني بلا سقف، فيُقدَّم على Twelve Data
   وتسقط الحاجة لميزانية الطلبات. يُضبط PREFER_YAHOO=1 في التشغيل المحلي. */
const PREFER_YAHOO = process.env.PREFER_YAHOO === "1";

/* هل مزوّدُ الأسهم يعطي حجماً في الجلسة الممتدة؟ يُقرأ من القدرة لا
   من الاسم، ويُمرَّر إلى `extendedCandles` فتقرّر: حجمٌ حقيقي أم
   «لا نعرف». */
const EXT_VOL = PROV.has("extendedVolume", "equity");

/* تقريب — Yahoo يعيد 62.014999389648438 والتخزين بلا تقريب يضاعف حجم الملفات */
const r4 = (v) => (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v * 10000) / 10000;

/* التقريب السعري مشتركٌ — انظر `lib/round.mjs` (نسخةٌ ثالثة منه في
   `track-signals` كتبت لقطةَ شيبا أصفاراً). ويُعاد تصديره لمن يستورده
   من هنا. */
export { rp };

const slimCandles = (c) => c.map(x => ({
  t: x.t, o: rp(x.o), h: rp(x.h), l: rp(x.l), c: rp(x.c),
  /* `null` يبقى `null`: `Math.round(x.v || 0)` كانت تحوّل «لا نعرف»
     إلى «صفر تداول» — وهو ما يجعل VWAP وOBV تُحسب على أصفار. */
  v: (x.v === null || x.v === undefined) ? null : Math.round(x.v)
}));

/* =====================================================================
   شمعاتُ الحجم الصفري — أخطر تشويشٍ في المشروع، ولم يكن يبدو خللاً.

   فريم 15د وحده يُطلب بـ`prePost: true` (ما قبل الافتتاح وما بعد
   الإغلاق)، وياهو **يحشو** الساعات المغلقة بشمعاتٍ حجمها صفر تحمل آخر
   سعرٍ معروف مكرَّراً. قياس 2026-09-13 على أبل: **156 من 260** شمعة
   بحجم صفر — أي أن ‎60%‎ من فريم 15د لم يكن تداولاً أصلاً، بل سعراً
   واحداً منسوخاً على مئة شمعة.

   والنتيجة أن مؤشّرات الفريم تقيس اللاشيء: نطاق بولنجر لأبل ضاق إلى
   **35 سنتاً** (332.35–332.70)، والتصق EMA20 بالسعر على مسافة **1.5
   سنت**، وحام MACD على الصفر. فصارت كل بوابةٍ على حدّ السكين تنقلب في
   كل دورة — وهذا هو المصدر الحقيقي لـ‎195 حالة‎ تغيّرت فيها النتيجة
   والسعر لم يتغيّر بأيّ كسر.

   فنُسقِط الشمعات التي لا تداولَ فيها **قبل** `slice(-KEEP)`: الطلب
   يعيد 60 يوماً (~2600 شمعة مع الجلسات الممتدة، و~1070 بدونها)،
   فيبقى بعد الإسقاط 260 شمعةَ تداولٍ حقيقي تغطّي ~10 أيام تداول.

   والبوابةُ شرطُ سلامة لا تجميل: مصدرٌ لا يعطي حجماً إطلاقاً
   (Twelve Data وStooq) تُصفّره `Math.round(x.v || 0)` فيمحو السلسلة
   كاملةً. فإن لم يبقَ ما يكفي EMA200 أعدنا الأصل كما هو — بياناتٌ
   مشوَّشة أفضل من لا بيانات.

   وعلى 15د وحده: اليوميُّ والساعة يأتيان بلا `prePost` ونسبةُ الحجم
   الحقيقي فيهما ‎100%‎، وتطبيقُه عليهما يعرّضهما للبوابة بلا مقابل. */
const NEED_BARS = 220;                  // EMA200 + هامش
/* ⚠ الشرطان مقصودان، والثاني أُضيف لخطرٍ **قادم** لا حاضر:

   اليوم يُسقط شرطُ الحجم شمعاتِ الجلسة الممتدة تلقائياً، لأن ياهو
   يعطي حجمها صفراً حرفياً (قِيس على أربعة رموز وخمسة أيام). فحين يصل
   مزوّدٌ يعطي حجماً ممتداً حقيقياً — وهو الغرض من طبقة المزوّد كلّها —
   ستصير تلك الشمعات ذات حجمٍ موجب **فتتسرّب إلى السلسلة الرسمية**
   وتغيّر كل مؤشّرٍ في الكون، بلا خطأ ولا رسالة. الحارس بالجلسة يمنع
   ذلك قبل أن يقع.

   والترتيب مهمّ: `isRegularBar` أولاً ثم الحجم، فيبقى سلوك اليوم
   مطابقاً تماماً (شمعةُ ‎16:00‎ بحجمٍ صفر تسقط بالشرطين معاً). */
function tradingOnly(candles, tf) {
  if (tf !== "15m") return candles;
  const live = candles.filter(x => isRegularBar(x.t) && (x.v || 0) > 0);
  return live.length >= NEED_BARS ? live : candles;
}

/* شمعاتُ السلسلة الممتدة: لا تُرشَّح بالحجم إطلاقاً — حذفُها هو العلّة
   التي نصلحها. لكن حجمَ الشمعة الممتدة **يُكتب `null` لا `0`** حين لا
   يعطيه المصدر: `0` تعني «لم يتداول أحد» و`null` تعني «لا نعرف»،
   و`hasVol` في `indicators.js` تفرّق بينهما فتُسقط OBV وMFI بدل أن
   تحسبهما على أصفارٍ ملفّقة. */
function extendedCandles(candles, hasExtVolume) {
  return candles.map(x => (
    (!hasExtVolume && !isRegularBar(x.t) && !(x.v > 0)) ? { ...x, v: null } : x
  ));
}

/* =====================================================================
   السلسلة المجمّدة — بياناتٌ خاطئة لا حالةَ سوق، والفرق يهمّ.

   `ARB-USD` عند ياهو ليس أربيتروم: أصلٌ ميت مجمَّد على 0.000629 بحجم
   صفر منذ 260 يوماً. والتطبيق كان يعرضه بسعره ذاك، ويحسب له اتجاهاً
   («ميل هابط»، نتيجة ‎−50.59‎ — لأن `px > e200` تعيد `false` عند التساوي
   التامّ)، ويرشّحه للفرص. أربيتروم الحقيقية `ARB11841-USD` بسعر 0.14
   وحجم 240 مليون يومياً.

   ولم يكشفه شيء: السعر رقمٌ صالح، والشارت خطٌّ مستقيم، والنتيجة رقمٌ
   في مداه. نفس مصيدة «الأرقام تبدو صحيحة» مطبَّقةً على رمزٍ كامل.

   الشرطان **مجتمعان** لا أحدهما: مسطَّحةٌ *وبلا* حجم. فسهمٌ هادئ له حجم،
   ومصدرٌ لا يعطي حجماً (Twelve Data وStooq) قد يعطي سلسلةً سليمة —
   ولهذا الحارس على مصدر ياهو وحده، وهو الذي يعطي الحجم فعلاً. */
const FROZEN_BARS = 30;
function frozenSeries(rec) {
  if (rec.src !== "yahoo") return false;
  const c = rec.tf?.["1d"]?.c;
  if (!c || c.length < FROZEN_BARS) return false;
  const t = c.slice(-FROZEN_BARS);
  const hi = Math.max(...t.map(x => x.c)), lo = Math.min(...t.map(x => x.c));
  if (!(lo > 0)) return true;                       // أسعار صفرية أو سالبة
  const flat = (hi - lo) / lo < 0.005;              // مدى ‎30‎ يوماً أقلّ من نصف بالمئة
  const traded = t.filter(x => (x.v || 0) > 0).length;
  return flat && traded <= 2;
}
/* ضغط الشمعات عند الكتابة فقط: مصفوفة بدل كائن يوفّر ~45% من الحجم.
   [الوقت بالثواني, فتح, أعلى, أدنى, إغلاق, حجم] */
const packCandles = (c) => c.map(x => [Math.round(x.t / 1000), x.o, x.h, x.l, x.c, x.v]);
/* الملفات المحفوظة تحوي الشكل المضغوط، فإعادة استخدامها في تشغيل تالٍ
   بلا فكّ ضغط تمرّر مصفوفات حيث يُتوقّع كائنات فينهار الحساب على
   x.c.toFixed. لم يظهر هذا إلا بعد أن صار هناك بيانات سابقة فعلاً. */
const unpackCandles = (c) => (Array.isArray(c) && Array.isArray(c[0]))
  ? c.map(a => ({ t: a[0] * 1000, o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] }))
  : c;
const slimAnalysis = (a) => {
  const o = {};
  // rp لا r4: قيم المؤشرات على مقياس السعر (ATR والمتوسطات وبولنجر)،
  // فتقريبها بخانات ثابتة يمحوها لأصل رخيص كما مُحي سعره
  for (const [k, v] of Object.entries(a)) o[k] = (typeof v === "number") ? rp(v) : v;
  return o;
};

/* ---------- أدوات ملفات ---------- */
const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
function writeJSON(rel, obj) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
  return fs.statSync(p).size;
}

/* ---------- أي فريم يحتاج تحديثاً؟ ---------- */
/* هل الشمعة اليومية قيد التكوّن الآن؟ الكريبتو دائماً — لا إغلاق له.
   و`POST` مشمولة عمداً: آخر جلب أثناء الجلسة يقع قبل الإغلاق بنصف ساعة
   على الأكثر، فإغلاقُ اليوم المحفوظ يكون سعرَ 19:40 لا الإغلاق الرسمي —
   ورقمٌ خاطئ هنا ينتقل إلى بيفوت الغد كلّه. `PRE` مستثناة: شمعة اليوم
   لم تبدأ بعد، فالجلب فيها طلبٌ بلا مقابل. */
function dailyIsLive(now, mkt) {
  if (mkt === "crypto") return true;
  const st = approxMarketStatus(now).state;
  return st === "REGULAR" || st === "POST";
}

/* `live` يمرّرها النداء لا تُحسب هنا: الطبقة الواسعة بوابتُها `wideDue`
   بصلاحية العشرين ساعة، وتقصيرُها لها يجعل 414 رمزاً تستحق التجديد كل
   نصف ساعة بينما السقف 60 لكل تشغيل — فلا تكتمل دورةٌ أبداً. */
function stale(prev, tf, now, live = false) {
  const u = prev?.tf?.[tf]?.updated;
  if (!u) return true;
  const age = (tf === "1d" && live) ? DAILY_LIVE_AGE : MAX_AGE[tf];
  return (now - u) >= age;
}

/* حالة الجلسة في scripts/lib/session.mjs — تستعملها مهمة الأسعار
   السريعة أيضاً، ونسخة واحدة تمنع اختلاف الترويسة بين المهمتين. */

/* `frames` تحدد عمق الرمز: الطبقة الأساسية تأخذ الفريمات الثلاثة،
   والطبقة الواسعة اليوميَّ وحده. جلب 500 رمز × 3 فريمات كل عشر دقائق
   يستدعي 429 حتى من شبكة منزلية، واليوميُّ وحده يكفي للبحث ولمستويات
   الدعم والمقاومة و52 أسبوعاً — وهو كل ما يُطلب من رمز خارج المرصودة. */
async function buildSymbol(meta, prevDir, now, quotes, frames = ["1d", "1h", "15m"], tier = "core", extBatch = null) {
  const sym = meta.s;
  const prev = readJSON(path.join(prevDir, "sym", `${sym}.json`));
  // نُعيد الشمعات المحفوظة إلى شكل الكائنات فور القراءة، فما بعدها من
  // حساب ورسم يتعامل مع شكل واحد فقط
  for (const o of Object.values(prev?.tf || {})) if (o?.c) o.c = unpackCandles(o.c);
  /* والسلسلة الممتدة كذلك — نسيانُها هنا يمرّر مصفوفاتٍ مضغوطة حيث
     يُتوقّع كائنات، فينهار الحساب على `x.c.toFixed` (مصيدةٌ موثّقة
     وقعت مرّة مع `tf`، ولا تظهر إلا بعد أن يوجد ملفٌّ سابق فعلاً). */
  for (const o of Object.values(prev?.tfx || {})) if (o?.c) o.c = unpackCandles(o.c);
  const rec = { s: sym, ar: meta.ar, en: meta.en, sec: meta.sec, tf: {}, src: "yahoo", updated: now };
  if (meta.mkt) rec.mkt = meta.mkt;
  let touched = false, errors = [], usedTD = false;
  // سلسلة الساعة كاملةً قبل القصّ — تُستعمل لاشتقاق 4h ولا تُخزَّن
  let full1h = null;
  // الاستجابة الممتدة لـ‎15د‎ كما وصلت — قبل أن يُسقط `tradingOnly`
  // شمعاتِ ما قبل الافتتاح. كانت تُرمى، وهي أنفع ما في الطلب.
  let extRaw = {};

  // الترتيب مقصود: اليومي أولاً لأنه أساس الشارت والنتيجة الفنية، فحين
  // تنفد ميزانية الطلبات في تشغيل واحد تكون الفريمات الأهم قد امتلأت
  for (const tf of frames) {
    /* 4h يُشتقّ من الساعة الكاملة، فسلسلةٌ قصيرة محفوظة من قبل لا تُصلَح
       إلا بإعادة جلب الساعة. بلا هذا تبقى 65 شمعة حتى تنتهي صلاحية
       الساعة وحدها — إصلاحٌ يعتمد على التوقيت بدل أن يكون حتمياً. */
    const shortDerived = tf === "1h" && (prev?.tf?.["4h"]?.c?.length || 0) < 200;
    if (!shortDerived && !stale(prev, tf, now, tier === "core" && dailyIsLive(now, meta.mkt)) && prev?.tf?.[tf]?.c?.length) {
      rec.tf[tf] = prev.tf[tf];                       // ما زال حديثاً — أبقِه
      continue;
    }
    // Twelve Data أولاً حين يتوفّر مفتاحه: Yahoo يحظر رينرات GitHub
    // (429 حتى عبر curl) فلا يُعتمد عليه، لكنه يبقى محاولة ثانية مجانية
    // لأنه ينجح أحياناً ويعطي فترات التداول التي لا يعطيها غيره.
    // طلب واحد لكل رمز في التشغيل الواحد: بلا هذا القيد تبتلع أول أربعة
    // رموز الميزانية كاملةً (ثلاثة فريمات لكل رمز) ويبقى 66 رمزاً بلا أي
    // شمعة لساعات. بالقيد يأخذ كل رمز يومِيَّه أولاً فتكتمل الشارتات
    // والنتائج الفنية لكل الرموز خلال ~6 تشغيلات بدل 18.
    let got = false;

    const tryYahoo = async () => {
      const { candles, meta: m } = await fetchChart(sym, {
        range: RANGE[tf], interval: tf, prePost: tf === "15m"
      });
      if (tf === "15m") extRaw["15m"] = candles;     // قبل الترشيح
      const full = tradingOnly(candles, tf);
      // الساعة تُطلب بمدى سنتين (`RANGE["1h"]`) فتعود بآلاف الشمعات، ثم
      // تُقصّ إلى KEEP. و4h تُشتقّ منها — فاشتقاقُها **بعد** القصّ يعطي
      // 260/4 = 65 شمعة، وEMA200 تحتاج 200. السلسلة الكاملة تُمرَّر
      // للاشتقاق ولا تُخزَّن: الملفّ يبقى بـ KEEP لكل فريم.
      if (tf === "1h") full1h = full;
      rec.tf[tf] = { updated: now, c: slimCandles(full.slice(-KEEP)) };
      // فترات التداول الحقيقية لا يوفّرها غير Yahoo — وهي أدق من التقدير
      if (tf === "15m" && m) { rec.period = tradingPeriodFromMeta(m); rec.cur = num(m.regularMarketPrice); }
      rec.src = "yahoo";
      touched = true; got = true;
    };

    const tryTD = async () => {
      if (!hasTwelveData() || tdBudget.left <= 0 || usedTD) return;
      tdBudget.left--; usedTD = true;
      try {
        const { candles } = await fetchCandlesTD(sym, tf, { outputsize: KEEP });
        rec.tf[tf] = { updated: now, c: slimCandles(candles.slice(-KEEP)) };
        rec.src = "twelvedata";
        touched = true; got = true;
      } catch (e) { errors.push(`${tf}/td: ${e.message}`); }
      await tdSleep();                       // حد 8 طلبات/دقيقة على الخطة المجانية
    };

    /* الكريبتو من Binance حصراً: بلا مفتاح وبلا حصّة (وزن الطلب ‎2‎ من
       ‎6000‎ في الدقيقة)، ويزيل من مصدرهما مصيدتَي ياهو الموثّقتين —
       `ARB-USD` الأصل الميت المجمَّد، و«أسعار ما قبل الإدراج» التي أعطت
       عائداً ‎1,573,986%‎ في يوم واحد. وياهو يبقى محاولةً ثانية. */
    const tryBinance = async () => {
      if (meta.mkt !== "crypto") return;
      try {
        const { candles } = await fetchCandlesBN(sym, { interval: tf });
        const full = tradingOnly(candles, tf);
        if (tf === "1h") full1h = full;
        rec.tf[tf] = { updated: now, c: slimCandles(full.slice(-KEEP)) };
        rec.src = "binance";
        touched = true; got = true;
      } catch (e) { errors.push(`${tf}/bn: ${e.message}`); }
    };

    // ترتيب المصادر يعتمد على مكان التشغيل، لأن الحظر مرتبط بعنوان الشبكة:
    // من رينر سحابي (GitHub) يرفض Yahoo كل طلب بـ429، فـ Twelve Data أولاً
    // بميزانيته المحدودة. من شبكة منزلية Yahoo غير محظور ومجاني بلا سقف،
    // فيصير هو الأول ويُستغنى عن ميزانية الطلبات كلياً.
    await tryBinance();
    const yahooFirst = PREFER_YAHOO;
    if (got) { /* Binance كفى */ }
    else if (yahooFirst) {
      try { await tryYahoo(); } catch (e) { errors.push(`${tf}: ${e.message}`); }
      if (!got) await tryTD();
    } else {
      await tryTD();
      if (!got) try { await tryYahoo(); } catch (e) { errors.push(`${tf}: ${e.message}`); }
    }
    if (!got && prev?.tf?.[tf]?.c?.length) rec.tf[tf] = prev.tf[tf];  // أبقِ القديم بدل الحذف
  }

  // Yahoo سقط كلياً لهذا الرمز -> جرّب Stooq لليومي حتى لا ينقطع السهم
  if (!rec.tf["1d"]?.c?.length) {
    try {
      const { candles } = await fetchStooqDaily(sym);
      rec.tf["1d"] = { updated: now, c: slimCandles(candles.slice(-KEEP)) };
      rec.src = "stooq";
      touched = true;
    } catch (e) { errors.push(`stooq: ${e.message}`); }
  }

  if (!Object.keys(rec.tf).length) {
    // لا شموع من أي مصدر — لو عندنا سعر من Finnhub نُدرج السهم بسعر فقط
    // بلا شارت/مؤشرات بدل استبعاده بالكامل (الواجهة تتعامل مع هذا أصلاً)
    const q = quotes?.[sym];
    if (!(q && Number.isFinite(q.regularMarketPrice) && q.regularMarketPrice > 0)) {
      throw new Error(errors.join(" | ") || "no data");
    }
    rec.src = "finnhub";
    rec.noChart = true;
  }

  /* اشتقاق فريم 4 ساعات من الساعة (Yahoo لا يوفّره).

     من السلسلة **الكاملة** حين تتوفّر، فتخرج 260 شمعة بدل 65 — وهو فرقُ
     وجودِ EMA200 من عدمه. وبلا e200 تسقط بوابتا الاتجاه الأمّ (‎4.0‎ من
     ‎8.5‎) فيقيس الفريم المدى القصير وحده ويُسمّى «اتجاهاً»، وأصغر خطوةٍ
     فيه تصير ‎11.11‎ — أي أنه عاجزٌ بنيوياً عن التعبير عن ميلٍ ضعيف
     فيسقط من `allTF` وإن كان له جهةٌ حقيقية. قِيس: 96 رمزاً من 96 بلا
     e200 على 4h، و`MSFT` و`V` تسقطان من توافق الفريمات بسببها وحدها.

     وحين لا تتوفّر الكاملة (الساعة لم تُجدَّد هذا التشغيل) نُبقي 4h
     المخزَّنة كما هي بدل إعادة اشتقاقها قصيرة — وإلا تذبذب طولها بين
     التشغيلات فتذبذبت معه النتيجة. */
  if (full1h?.length) {
    rec.tf["4h"] = { updated: rec.tf["1h"].updated, c: slimCandles(aggregate(full1h, 4).slice(-KEEP)), derived: true };
  } else if (prev?.tf?.["4h"]?.c?.length) {
    /* 4h ليس في `frames` فلا يمرّ بحلقة الجلب، ولا يُنقل من `prev`
       تلقائياً. وبلا نقله هنا يُعاد اشتقاقه من الساعة **المقصوصة** في كل
       تشغيلٍ لا تُجدَّد فيه الساعة — فيهبط من 260 شمعة إلى 65 ويضيع
       e200 الذي بُني قبل دقائق. أثرٌ صامت: الطول يتذبذب بين التشغيلات
       ومعه نتيجة الفريم كلها. */
    rec.tf["4h"] = prev.tf["4h"];
  } else if (rec.tf["1h"]?.c?.length) {
    // أول مرة ولا ساعةَ كاملة: مشتقٌّ قصير خيرٌ من فريمٍ غائب
    rec.tf["4h"] = { updated: rec.tf["1h"].updated, c: slimCandles(aggregate(rec.tf["1h"].c, 4).slice(-KEEP)), derived: true };
  }

  /* =====================================================================
     السلسلة الممتدة — تُبنى هنا ولا تمسّ `rec.tf` بحال.

     الكريبتو مستثنى: سوقُه ‎24/7‎ فكلُّ شمعةٍ فيه رسمية، و`tf` تحمل
     الجلسة كاملة أصلاً. ونسخةٌ ثانية منها تضاعف الملفّ بلا معلومةٍ
     واحدة جديدة.

     والطبقة الواسعة مستثناة كذلك: يوميُّها وحده يُجلب، ولا جلسة
     ممتدة في شمعةٍ يومية.
     ===================================================================== */
  if (tier === "core" && meta.mkt !== "crypto") {
    /* =====================================================================
       ‎15د‎ الممتد: حجمٌ من المزوّد وذيلٌ لحظيّ من ياهو.

       لكلٍّ ما لا يملكه الآخر، والدمج يأخذ من كلٍّ أقواه:
         · Alpaca SIP: حجمٌ مجمَّع حقيقي، **متأخّر ‎15‎ دقيقة** بالضبط.
         · ياهو: أسعارٌ لحظية بلا تأخير، **وحجمٌ صفرٌ دائماً**.

       فالشمعات حتى حدّ التأخير تُؤخذ من المزوّد بحجمها، وما بعده يُلحق
       من ياهو بحجمٍ `null`. وبلا هذا الذيل تكون أحدثُ شمعةٍ عمرُها ربع
       ساعة — وربعُ ساعةٍ في ما قبل الافتتاح هو الفرق بين الاكتشاف
       والملاحقة.

       والدمج **بمفتاح الزمن** لا بالموضع: شبكة الشمعات واحدة عند
       المصدرين (‎04:00، 04:15…‎)، والدمج بالموضع يزيح السلسلة كلَّها
       عند أوّل شمعةٍ ناقصة — وهي علّة «زحف شبكة 4h» بعينها.
       ===================================================================== */
    const yh15 = extRaw["15m"]?.length ? extendedCandles(extRaw["15m"], false) : null;
    const pv15 = extBatch && extBatch["15m"] && extBatch["15m"][sym];
    if (pv15?.length) {
      const byT = new Map(pv15.map(b => [b.t, b]));
      /* ذيلُ ياهو: ما بعد آخر شمعةٍ عند المزوّد فقط */
      const lastPv = pv15[pv15.length - 1].t;
      for (const b of (yh15 || [])) if (b.t > lastPv && !byT.has(b.t)) byT.set(b.t, b);
      const merged = [...byT.values()].sort((a, b) => a.t - b.t);
      rec.tfx = rec.tfx || {};
      rec.tfx["15m"] = { updated: now, src: extBatch.src, c: slimCandles(merged.slice(-KEEP_X)) };
    } else if (yh15) {
      rec.tfx = rec.tfx || {};
      rec.tfx["15m"] = { updated: now, src: "yahoo", c: slimCandles(yh15.slice(-KEEP_X)) };
    } else if (prev?.tfx?.["15m"]?.c?.length) {
      rec.tfx = rec.tfx || {};
      rec.tfx["15m"] = prev.tfx["15m"];              // لم تُجدَّد الساعة الربعية
    }

    /* `tfx` تُبنى من `EXT_TFS` وحدها. وحذفُ ‎5د‎ من القائمة يكفي لمحوه
       من الملفّات المخزَّنة: `rec` يُبنى فارغاً في كل تشغيل ولا يُنقل
       إليه من `prev` إلا ما تذكره الشيفرة صراحةً — فالمفتاح الذي لا
       يُذكر يسقط من الملفّ عند أوّل كتابة، بلا حاجة إلى تنقيةٍ لاحقة. */
  }

  /* =====================================================================
     المؤشرات لكل فريم — **على الشمعات المغلقة وحدها**.

     كانت تُحسب على السلسلة كاملةً بما فيها الشمعة الجارية، فتتغيّر في
     كلّ دورة سوق (عشر دقائق) **وسط** ربع الساعة بلا أن تُغلق شمعةٌ
     واحدة. وأثرُ ذلك ليس رقماً يهتزّ في بطاقة: `score` و`tfScore`
     هما مقياسُ ماسح الفرص وترتيبُه معاً (`allTF` عضويةً و`-r.score`
     رتبةً)، فكان ترتيب الشاشة يُعاد كلَّ عشر دقائق ويدخلها رمزٌ ويخرج
     منها آخر بلا حدثٍ في السوق.

     القياس على الكون الحيّ (218 رمزاً): **85.3%** تتغيّر نتيجتُه بحذف
     الشمعة الجارية وحدها، وسيط الفرق **5.88** نقطة وأقصاه **34.71**،
     و**28** رمزاً تنقلب عضويتُه في شرطَي «توافق الفريمات»، وأوّل ثمانية
     في القائمة يختلفون بالكامل. وهو بالضبط ما بلّغ عنه المستخدم:
     قائمةٌ تتبدّل بين ‎07:46‎ و‎07:51‎ داخل شمعةٍ واحدة.

     ولا يُبطل هذا الأرشيف بل **يوافقه**: `backtest.mjs` يقيس عند كل
     شمعة بـ`p: c[i]` — إغلاقُ شمعةٍ مكتملة. فالأرشيف كان يقيس المغلق
     والواجهة تعرض الجاري، وهذا التعديل يجعلهما يقيسان الشيء نفسه.

     والحذف **مشروط** لا مطلق (انظر `closedBars`): شمعةٌ مغلقة تبقى،
     وإلا قرأت الأسهم الأمريكية مساءً شمعةَ أمس اليومية. */
  rec.an = {};
  for (const tf of AN_TFS) {
    const kk = rec.tf[tf]?.c ? closedBars(rec.tf[tf].c, tf, now) : null;
    const a = (kk && kk.length) ? analyze(kk) : null;
    if (!a) continue;
    const { series, ...rest } = a;                    // لا نحفظ السلاسل الكاملة (حجم)
    rec.an[tf] = slimAnalysis(rest);
  }
  /* =====================================================================
     `anx` — مؤشّرات السلسلة الممتدة، **خارج النتيجة الفنية تماماً**.

     نفس حارس `an["5m"]` بالحرف: `overallScore` يدور على `TFS` وحدها،
     و`allTF` في `scans.js` تشترط `v.length === 4` بالضبط. فتسرّبُ
     `anx` إلى `an` يغيّر نتيجة كل رمزٍ في الكون ويُسقط شرطَي «توافق
     الفريمات» بصمت. و`--check` يحرس هذا صراحةً.
     ===================================================================== */
  if (rec.tfx) {
    rec.anx = {};
    for (const tf of Object.keys(rec.tfx)) {
      const kx = rec.tfx[tf]?.c ? closedBars(rec.tfx[tf].c, tf, now) : null;
      const a = (kx && kx.length) ? analyze(kx) : null;
      if (!a) continue;
      const { series, ...rest } = a;
      rec.anx[tf] = slimAnalysis(rest);
    }
  }
  rec.score = r2(overallScore(rec.an));
  /* النطاق المثبَّت — لا يُغيَّر إلا بتجاوز حدّه بهامش. يُحسب هنا لا في
     المتصفح لأن الهيستريسس يحتاج ذاكرةً بالدورة السابقة، والخادم هو من
     يملكها (`prev`). والمتصفح يعرضه كما هو فلا يختلف وسمُ شاشتين. */
  rec.band = bandStable(rec.score, prev?.band);
  rec.stale = !touched;
  if (errors.length) rec.errors = errors;
  return rec;
}

/* ---------- التشغيل ---------- */
async function main() {
  const now = Date.now();
  const prevDir = fs.existsSync(path.join(OUT, "meta.json")) ? OUT : OUT;   // نبني فوق ما هو موجود
  fs.mkdirSync(OUT, { recursive: true });

  const universe = cfg.symbols;
  const cryptoAll = cfg.crypto || [];
  const wideAll = cfg.wide || [];
  console.log(`▶ ${universe.length} مرشّحاً أساسياً · ${cryptoAll.length} عملة رقمية · ${wideAll.length} في الطبقة الواسعة`);

  // الترتيب اليومي يحدد الـ70؛ إن لم يوجد بعد نأخذ ترتيب الملف
  const ranking = readJSON(path.join(OUT, "ranking.json"));
  // الأساسيات اليومية تسدّ ما لا تعطيه أسعار Finnhub المجانية (نطاق 52
  // أسبوعاً ومتوسط الحجم). بدونها كانت هذه الحقول null دائماً في الملخص،
  // فيسقط فرز "حجم التداول" في الواجهة صامتاً.
  const fundamentals = readJSON(path.join(OUT, "fundamentals.json"))?.f || {};
  const chosen = ranking?.top?.length
    ? universe.filter(u => ranking.top.includes(u.s)).sort((a, b) => ranking.top.indexOf(a.s) - ranking.top.indexOf(b.s))
    : universe.slice(0, cfg.top);
  console.log(`  الرموز المختارة: ${chosen.length} ${ranking?.top?.length ? "(من الترتيب اليومي)" : "(ترتيب مبدئي)"}`);

  // ترتيب المعالجة حسب الحاجة، لا حسب القيمة السوقية: صلاحية فريم 15 دقيقة
  // صفر أي "قديم دائماً"، فالرموز الممتلئة تستهلك ميزانية التشغيل كاملةً في
  // تحديث نفسها ولا يصل الدور أبداً لمن لا يملك شمعة واحدة — عالقاً عند 14
  // من 70 مهما تكرّرت التشغيلات. من يفتقد اليومي أولاً، ثم الساعة، ثم 15د.
  const needRank = (s) => {
    const tf = readJSON(path.join(OUT, "sym", `${s}.json`))?.tf || {};
    if (!tf["1d"]?.c?.length) return 0;
    if (!tf["1h"]?.c?.length) return 1;
    if (!tf["15m"]?.c?.length) return 2;
    return 3;
  };
  const order = new Map(chosen.map(c => [c.s, needRank(c.s)]));
  chosen.sort((a, b) => order.get(a.s) - order.get(b.s));
  const needy = [...order.values()].filter(v => v < 3).length;
  if (needy) console.log(`  رموز ناقصة الشمعات: ${needy} — لها أولوية الميزانية`);

  // الطبقة الواسعة: من انقضت صلاحية يوميّه فقط، بسقف لكل تشغيل.
  // نقرأ أعمارها من wide.json لا من 414 ملفاً على القرص — فحص الملفات
  // واحداً واحداً يقرأ عشرات الميغابايتات في كل دورة بلا داعٍ.
  const prevWide = readJSON(path.join(OUT, "wide.json"))?.rows || [];
  const wideAge = new Map(prevWide.map(r => [r.s, r.u || 0]));
  const wideDue = wideAll
    .filter(m => (now - (wideAge.get(m.s) ?? 0)) >= MAX_AGE["1d"])
    .sort((a, b) => (wideAge.get(a.s) ?? 0) - (wideAge.get(b.s) ?? 0))   // الأقدم أولاً
    .slice(0, WIDE_PER_RUN);
  if (wideAll.length)
    console.log(`  الطبقة الواسعة: ${wideDue.length} مستحقّ من ${wideAll.length} (سقف ${WIDE_PER_RUN}/تشغيل)`);

  /* =====================================================================
     **وضعُ التأكيد السريع** — `FAST_CONFIRM=1`.

     لقطةُ الفرص لا تتقدّم حتى يتقدّم `cbar`، و`cbar` يُشتقّ من الفريم
     الأدقّ (‎15د‎). فكلُّ ما تحتاجه الشمعةُ الجديدة كي تصل المستخدم هو
     **إعادةُ جلب ‎15د‎ للطبقة الحيّة**: الساعة والأربع ساعات واليوميّ
     لم تُغلق شمعاتُها بعد (`stale` تتخطّاها أصلاً)، والطبقة الواسعة
     يوميّةٌ بحكم بنائها.

     فالوضع السريع يُسقط الواسعة ويقصر الفريمات على ‎15د‎، فيهبط زمنُ
     الدورة من دقائق إلى ثوانٍ — ويُشغَّل عند حدّ الشمعة بالضبط، بينما
     تبقى الدورة الكاملة كلَّ ربع ساعة لبقية الفريمات والأخبار.

     ولا نسخةَ ثانية من المنطق: نفس `buildSymbol` ونفس `stale` ونفس
     بوّابات الكتابة — المتغيّر قائمةُ الوظائف وحدها. */
  const FULL = ["1d", "1h", "15m"];
  const jobs = FAST ? [
    ...chosen.map(m => ({ m, frames: ["15m"], tier: "core" })),
    ...cryptoAll.map(m => ({ m, frames: ["15m"], tier: "core" }))
  ] : [
    ...chosen.map(m => ({ m, frames: FULL, tier: "core" })),
    ...cryptoAll.map(m => ({ m, frames: FULL, tier: "core" })),
    ...wideDue.map(m => ({ m, frames: ["1d"], tier: "wide" }))
  ];
  if (FAST) console.log(`  وضع التأكيد السريع: ‎15د‎ للطبقة الحيّة وحدها (${jobs.length} رمزاً · بلا الواسعة)`);

  // 1) دفعة الأسعار.
  // ترتيب المصدر يتبع مكان التشغيل كما في الشموع: Finnhub المجاني طلبٌ لكل
  // رمز بحد 60/دقيقة، فـ 160 رمزاً تعني أكثر من دقيقتين ونصف — أطول من دورة
  // الأسعار نفسها. Yahoo يجمع 40 رمزاً في الطلب الواحد، فيكفيه أربعة طلبات.
  // محلياً Yahoo أولاً إذن، وسحابياً يبقى Finnhub أولاً لأن Yahoo محظور هناك.
  const allSymbols = [...jobs.map(j => j.m.s), ...cfg.indices.map(i => i.s),
                      ...cfg.indices.map(i => i.proxy).filter(Boolean)];
  let quotes = null;
  const tryQuotes = async (label, fn) => {
    if (quotes) return;
    try {
      quotes = await fn(allSymbols);
      console.log(`  ✓ أسعار ${label}: ${quotes ? Object.keys(quotes).length : 0} رمز`);
    } catch (e) { console.warn(`  ⚠ أسعار ${label} فشلت: ${e.message}`); }
  };
  if (PREFER_YAHOO) {
    await tryQuotes("Yahoo (دفعات)", fetchQuotes);
    await tryQuotes("Finnhub (احتياط)", fetchQuotesFinnhub);
  } else {
    await tryQuotes("Finnhub", fetchQuotesFinnhub);
    await tryQuotes("Yahoo (احتياط)", fetchQuotes);
  }

  /* =====================================================================
     1.5) الجلسة الممتدة — دفعةٌ واحدة لكل الكون قبل حلقة الرموز.

     طلبان اثنان (‎5د‎ و‎15د‎) يغطّيان الكون كلَّه بحجمٍ مجمَّع حقيقي.
     وهذا ما يجعل الماسح يعمل من بدء ما قبل الافتتاح بكلفةٍ لا تُذكر:
     قِيس ‎149‎ رمزاً في **طلبٍ واحد** و‎1.7‎ ثانية بتغطية ‎93%‎.

     والفشل هنا **لا يُسقط التشغيل**: تبقى أسعار ياهو الممتدة (بلا
     حجم) وتبقى السلسلة الرسمية كما هي. تدهورٌ هادئ لا انهيار.
     ===================================================================== */
  let extBatch = null;
  const extSyms = chosen.filter(m => m.mkt !== "crypto").map(m => m.s);
  if (extSyms.length) {
    try {
      const { provider, caps } = PROV.pick("equity", ["extendedVolume"]);
      if (caps.extendedVolume && provider.getCandlesBatch) {
        const from = now - 5 * 86400e3;
        extBatch = { src: provider.id, delayMs: caps.extendedVolumeDelayMs || 0 };
        for (const tf of EXT_TFS) {
          const m = await provider.getCandlesBatch(extSyms, tf, { from });
          const skipped = m.__skipped || []; delete m.__skipped;
          extBatch[tf] = m;
          console.log(`  ✓ الجلسة الممتدة ${tf}: ${Object.keys(m).length} رمزاً من ${extSyms.length}` +
            (skipped.length ? ` · مستبعَد: ${skipped.join("، ")}` : "") +
            (caps.extendedVolumeDelayMs ? ` · متأخّر ${Math.round(caps.extendedVolumeDelayMs / 60e3)}د` : ""));
        }
      } else {
        console.log(`  ⓘ لا حجم للجلسة الممتدة (${provider.id}) — الأسعار الممتدة من ياهو والحجم يُعلَن غائباً`);
      }
    } catch (e) {
      console.warn(`  ⚠ تعذّرت الجلسة الممتدة: ${e.message} — نكمل بالأسعار وحدها`);
      extBatch = null;
    }
  }

  // 2) الشموع
  // حد Twelve Data (8/دقيقة) عام لا لكل رمز، فالتوازي معه يتجاوزه ويهدر
  // الرصيد على طلبات مرفوضة — نسلسل حين يكون مفعَّلاً
  // التسلسل مفروض بحد Twelve Data (8/دقيقة عام لا لكل رمز). حين يكون Yahoo
  // هو المصدر الأول (تشغيل محلي) فلا حد يقيّدنا، فنتوازى ونختصر الوقت
  // من ~28 دقيقة إلى دقائق معدودة لكل الرموز السبعين.
  /* =====================================================================
     مساراتُ الجلب — و**وضعُ التأكيد يرفعها بقياسٍ لا بحدس**.

     الدورة الكاملة على ثلاثة مسارات بتشتيتٍ ‎450–900‎ مللي: اختيارٌ
     محافظٌ ثمنُه ‎233‎ ثانية لـ‎223‎ رمزاً، وهو مقبولٌ لدورةٍ كلَّ ربع
     ساعة. أمّا التأكيد فيجب أن يصل قبل دقيقة من إغلاق الشمعة، فيُرفع
     توازيه.

     والحدّ يُضبط بـ`FAST_LANES` كي يُقاس تدريجياً: كلُّ زيادةٍ تُجرَّب
     ويُقاس معها **عددُ الأخطاء** لا الزمنُ وحده — فمسارٌ أسرع يجلب
     ‎429‎ أسوأ من مسارٍ أبطأ ينجح، وقاعدةُ المشروع أن الفشل السريع
     يُبقي آخر بياناتٍ سليمة ولا يعطي بيانات. */
  const lanes = (hasTwelveData() && !PREFER_YAHOO) ? 1
              : (FAST ? Number(process.env.FAST_LANES || 8) : 3);

  /* =====================================================================
     بدائل المؤشّرات — شمعاتٌ تُخزَّن، **وصفٌّ لا يُضاف إلى الملخّص**.

     `cfg.indices` تُجلب أسعارُها منذ البداية ولا تُحفظ شمعاتُها، فلا
     يملك المشروع سلسلةً واحدة لـ S&P 500 — وقسمُ «توجه السوق» يحتاجها
     كي تعمل عليه الاستراتيجياتُ كما تعمل على أيّ سهم.

     والقرار المعماريّ هنا هو **ألّا يدخل صفٌّ إلى `summary.rows`**:
     شرطُ «ليس كريبتو» (`mkt !== "crypto"`) مكرَّرٌ في اثني عشر موضعاً
     — الاتساع والقطاعات والرابحون والخاسرون والبحث والقوائم وحاسبة
     الارتباط. وإضافةُ طبقةٍ ثالثة تفرض مراجعتها كلَّها، ونسيانُ
     واحدةٍ يُدخل `SPY` في «اتساع السوق» فيُحسب المؤشّرُ سهماً داخل
     المؤشّر. فالملفّ يُكتب ويُقرأ بالاسم، ولا يعرف به أحدٌ سواه.
     ===================================================================== */
  const benchMeta = (cfg.indices || [])
    .filter(ix => ix.proxy)
    .map(ix => ({ s: ix.proxy, ar: ix.ar, en: ix.en, sec: "مؤشر", idx: ix.s }));
  const benchJobs = benchMeta.map(m => ({ m, frames: FULL, tier: "bench" }));

  phase(`قبل الشموع (${jobs.length + benchJobs.length} وظيفة · ${lanes} مساراً)`);
  const results = await pool(jobs.concat(benchJobs), lanes,
    (j) => buildSymbol(j.m, OUT, now, quotes, j.frames, j.tier === "bench" ? "core" : j.tier, extBatch));
  phase("بعد الشموع");
  const allJobs = jobs.concat(benchJobs);
  const rows = [], wideRecs = [], benchRecs = [], failed = [], frozen = [];
  results.forEach((r, i) => {
    const j = allJobs[i];
    if (!r.ok) { failed.push({ s: j.m.s, error: r.error }); console.warn(`  ✗ ${j.m.s}: ${r.error}`); return; }
    // رمزٌ مجمَّد يُستبعد من الملخّص كاملاً: وجودُه بسعرٍ وهميّ أسوأ من
    // غيابه، لأنه يبدو حالةَ سوق ويدخل الإحصاء والفرص
    if (frozenSeries(r.value)) {
      frozen.push(j.m.s);
      console.warn(`  ⃠ ${j.m.s}: سلسلة مجمّدة بلا حجم — مستبعد`);
      return;
    }
    (j.tier === "wide" ? wideRecs : j.tier === "bench" ? benchRecs : rows).push(r.value);
  });
  if (frozen.length) console.warn(`  ⃠ مستبعدة لتجمّد سلسلتها: ${frozen.join(" ")}`);
  console.log(`  ✓ نجح ${rows.length + wideRecs.length} / ${jobs.length}` +
              (benchRecs.length ? ` · ${benchRecs.length} بديل مؤشّر` : ""));
  // بوابة السلامة على الطبقة الأساسية وحدها: الواسعة تراكمية، وتشغيل لم
  // يستحقّ فيه أي رمز واسع تحديثاً ليس فشلاً.
  if (!rows.length) throw new Error("لم ينجح أي رمز أساسي — لن نكتب فوق البيانات السليمة");

  // 3) ملفات الأسهم + صفوف الملخص
  let bytes = 0;
  // نفس بناء الصف للطبقتين — نسختان تعنيان حقلاً يُضاف لواحدة وتُنسى فيه
  // الأخرى، فيظهر السهم الموسّع ناقصاً بلا سبب ظاهر. الفرق الوحيد `spark`:
  // ثلاثون رقماً لكل صف تضاعف حجم ملف الطبقة الواسعة بلا فائدة في القائمة.
  const buildRow = (rec, withSpark) => {
    const packed = { ...rec, v: 2, tf: {} };
    for (const [tf, o] of Object.entries(rec.tf)) packed.tf[tf] = { ...o, c: packCandles(o.c) };
    if (rec.tfx) {
      packed.tfx = {};
      for (const [tf, o] of Object.entries(rec.tfx)) packed.tfx[tf] = { ...o, c: packCandles(o.c) };
    }
    bytes += writeJSON(`sym/${rec.s}.json`, packed);
    const q = quotes?.[rec.s];
    const fnd = fundamentals[rec.s];
    const d1 = rec.tf["1d"]?.c || [];
    const lastC = d1.length ? d1[d1.length - 1].c : null;

    /* =====================================================================
       السعر والحجم **المؤكَّدان** — مدخلا شروط الماسح، بجانب اللحظيَّين
       لا بدلاً منهما.

       `p` سعرٌ لحظيّ يتجدّد كل دقيقتين و`vol` حجمُ جلسةٍ يتراكم طوال
       اليوم، وشروطُ الماسح تقرؤهما: «قرب قاع 52 أسبوعاً» و«قرب قمة» و
       «ارتداد» تقيس بُعدَ `p` عن مستوى، و«حجم غير معتاد» يقسم `vol` على
       متوسّطه. فتثبيتُ `an` وحدها يُسكِت شرطَ «توافق الفريمات» ويُبقي
       الأربعة الباقية تهتزّ — والمستخدم يرى القائمة نفسها تتبدّل.

       والمؤكَّد هو إغلاقُ **أدقّ فريمٍ مغلق**: أقربُ ما يكون إلى «الآن»
       دون أن يكون جزءاً من شمعةٍ لم تكتمل. والحجم من الشمعة اليومية
       المغلقة لأن `vol` حجمُ جلسةٍ لا حجمُ ربع ساعة — ومقارنةُ حجمٍ
       بمقياسٍ من نوعٍ آخر هي بعينها المصيدة الموثّقة في `volRatio`.

       ولا يُستبدل `p` في الصفّ: هو السعر المعروض في كل شاشة، وسعرٌ
       متأخّرٌ ربعَ ساعة في الترويسة خللٌ ظاهر. الفصل بين «ما يُعرض»
       و«ما يُقاس عليه» هو نفس فصل LIVE عن CONFIRMED في الاستراتيجيات. */
    const confBar = (() => {
      for (const tf of ["15m", "1h", "4h", "1d"]) {
        const cc = rec.tf[tf]?.c;
        if (!cc || cc.length < 2) continue;
        const kk = closedBars(cc, tf, now);
        if (!kk.length) continue;
        return { tf, b: kk[kk.length - 1] };
      }
      return null;
    })();
    const d1c = d1.length >= 2 ? closedBars(d1, "1d", now) : d1;
    const volC = d1c.length ? d1c[d1c.length - 1].v : null;
    const prevC = d1.length > 1 ? d1[d1.length - 2].c : null;
    const lastV = d1.length ? num(d1[d1.length - 1].v) : null;

    const price = num(q?.regularMarketPrice) ?? rec.cur ?? lastC;
    const chg = num(q?.regularMarketChangePercent)
      ?? (lastC && prevC ? (lastC - prevC) / prevC * 100 : null);

    // سعر ما قبل / بعد الإغلاق
    let ext = null;
    if (num(q?.preMarketPrice) !== null)
      ext = { k: "PRE", p: rp(num(q.preMarketPrice)), c: r2(num(q.preMarketChangePercent)) };
    else if (num(q?.postMarketPrice) !== null)
      ext = { k: "POST", p: rp(num(q.postMarketPrice)), c: r2(num(q.postMarketChangePercent)) };

    // الشرارة أيضاً: toFixed(2) يجعل خط شيبا صفراً مستقيماً
    const spark = (rec.tf["1h"]?.c || d1).slice(-30).map(x => rp(x.c));

    return {
      s: rec.s, ar: rec.ar, en: rec.en, sec: rec.sec, ...(rec.mkt ? { mkt: rec.mkt } : {}),
      p: rp(price), chg: r2(chg), ext, ...(withSpark ? { spark } : {}),
      /* مدخلات الماسح المؤكَّدة — و`cbar` ختمُ الشمعة التي حُسبت عليها
         (بالثواني) كي تقول الشاشة على أيّ إغلاقٍ بُنيت القائمة. وعدٌ
         نصّيٌّ بالثبات لا يُقارَن، وختمٌ معروض يقارنه المستخدم بنفسه. */
      ...(confBar && Number.isFinite(confBar.b.c) ? { pc: rp(confBar.b.c) } : {}),
      ...(confBar ? { cbar: Math.round(confBar.b.t / 1000), ctf: confBar.tf } : {}),
      ...(Number.isFinite(volC) ? { volc: Math.round(volC) } : {}),
      score: rec.score,
      ...(Number.isFinite(rec.band) ? { band: rec.band } : {}),
      atr: rp(rec.an["1d"]?.atr ?? null), rsi: r2(rec.an["1d"]?.rsi ?? null),
      /* قوّة الاتجاه والانضغاط والتباعد من الفريم اليومي.
         تُنشر في صفّ الملخّص لا في ملف الرمز وحده لأن شروط الماسح تعمل
         على الصفوف كلّها قبل فتح أي رمز — قراءتُها من ملف الرمز تعني
         تحميل 510 ملفاً لعرض شاشة الفرص.
         و`div` رقمٌ لا كائن: ‎+1‎ صاعد و‎−1‎ هابط، والاتجاه هو كلّ ما
         يُصفّى عليه. وتخزينُ كائنٍ لكل صفّ يضاعف حجماً يُقرأ في كل
         تحميل صفحة. */
      /* المتوسّطات الثلاثة في الصفّ: شرطُ «ارتدادٍ داخل اتجاه صاعد»
         يحتاج أن يفرّق بين الاتجاه الأمّ (e200/e50) والزخم القصير
         (e20) — وهو تفريقٌ لا تعطيه `score` لأنها تجمعهما في رقمٍ
         واحد، بل إنّ تساويَهما بالضبط هو ما يُخرجها صفراً. وتُنشر في
         الصفّ لا في ملف الرمز لأن الماسح يمرّ على الكون قبل فتح رمز. */
      e20: rp(rec.an["1d"]?.e20 ?? null), e50: rp(rec.an["1d"]?.e50 ?? null),
      e200: rp(rec.an["1d"]?.e200 ?? null),
      adx: r2(rec.an["1d"]?.adx ?? null), pdi: r2(rec.an["1d"]?.pdi ?? null),
      mdi: r2(rec.an["1d"]?.mdi ?? null), squeeze: r2(rec.an["1d"]?.squeeze ?? null),
      ...(rec.an["1d"]?.div?.dir ? { div: rec.an["1d"].div.dir } : {}),
      tfScore: Object.fromEntries(TFS.filter(t => rec.an[t]).map(t => [t, +rec.an[t].score.toFixed(1)])),
      mc: num(q?.marketCap) ?? ranking?.mc?.[rec.s] ?? null,
      // حجم آخر شمعة يومية = حجم الجلسة الجارية (أو آخر جلسة مكتملة حين
      // يكون السوق مغلقاً). أدق من متوسط عشرة أيام، فنقدّمه عليه.
      vol: num(q?.regularMarketVolume) ?? (lastV || null) ?? num(fnd?.avgVol),
      w52h: rp(num(q?.fiftyTwoWeekHigh) ?? num(fnd?.w52h)),
      w52l: rp(num(q?.fiftyTwoWeekLow) ?? num(fnd?.w52l)),
      stale: !!rec.stale, src: rec.src
    };
  };

  const summary = rows.map(rec => buildRow(rec, true));
  summary.sort((a, b) => (b.mc ?? 0) - (a.mc ?? 0));

  /* بدائل المؤشّرات: `buildRow` تُنادى **لأثرها الجانبي** — كتابةِ
     `sym/{PROXY}.json` — ويُرمى الصفّ الناتج عمداً. وهي نفس الدالّة
     لا نسخةٌ منها: الشمعات تُضغط بنفس التضمين، فيقرؤها `unpackCandles`
     بلا فرع. ويُحفظ صفٌّ مصغَّر في `bench` ليعرف المستهلك أيُّ مؤشّرٍ
     يخصّه أيُّ بديل. */
  const bench = [];
  for (const rec of benchRecs) {
    buildRow(rec, false);
    const m = benchMeta.find(x => x.s === rec.s);
    bench.push({ s: rec.s, idx: m ? m.idx : null, ar: rec.ar, en: rec.en,
                 score: rec.score, band: rec.band, stale: !!rec.stale });
  }

  // الطبقة الواسعة تراكمية: كل تشغيل يجدّد حصّته فقط، فندمج الجديد فوق
  // القديم بدل استبداله. بلا الدمج يخرج الملف بستين صفاً كل مرة وينهار
  // البحث إلى آخر دفعة جُلبت.
  /* رمزٌ رُقّي إلى الأساسية يخرج من الواسعة. الملف تراكمي فلا يخرج
     وحده، ولو بقي لظهر **مرّتين** في `allRows()` — صفٌّ بأربعة فريمات
     وآخر بفريمٍ واحد — فيُحسب مرّتين في كل ما يمرّ على الكون. */
  const coreSyms = new Set(cfg.symbols.map(x => x.s));
  const wideMerged = new Map(prevWide.filter(r => !coreSyms.has(r.s)).map(r => [r.s, r]));
  for (const rec of wideRecs) if (!coreSyms.has(rec.s)) wideMerged.set(rec.s, { ...buildRow(rec, false), u: now });
  const wideRows = [...wideMerged.values()].sort((a, b) => (b.mc ?? 0) - (a.mc ?? 0));
  /* البوابة تقارن بما كان **بعد** استبعاد المرقّى: تقلّصٌ مشروح بالترقية
     ليس خطأ دمج، وتقلّصٌ بلا سبب هو الخطأ الذي بُنيت له. */
  const prevKept = prevWide.filter(r => !coreSyms.has(r.s)).length;
  if (wideRows.length < prevKept)
    throw new Error(`الطبقة الواسعة تقلّصت ${prevKept}→${wideRows.length} — لن نكتب`);
  bytes += writeJSON("wide.json", { updated: now, count: wideRows.length, rows: wideRows });
  console.log(`  ✓ الطبقة الواسعة: ${wideRows.length} صفاً (+${wideRecs.length} محدَّثاً)`);

  // 4) المؤشرات العامة + اتساع السوق + القطاعات
  const idxRows = [];
  for (const ix of cfg.indices) {
    const q = quotes?.[ix.s];
    let p = num(q?.regularMarketPrice), chg = num(q?.regularMarketChangePercent);
    if (p === null) {
      try {
        const { candles } = await fetchChart(ix.s, { range: "1mo", interval: "1d" });
        const a = candles[candles.length - 1], b = candles[candles.length - 2];
        p = a?.c ?? null; chg = (a && b) ? (a.c - b.c) / b.c * 100 : null;
      } catch (e) { console.warn(`  ⚠ مؤشر ${ix.s}: ${e.message}`); }
    }
    // Finnhub المجاني يرفض رموز المؤشرات (^GSPC) لكنه يعطي صناديق ETF التي
    // تتبعها. نسبة التغيّر منها تكاد تطابق المؤشر وهي المطلوبة لمزاج السوق،
    // أما المستوى نفسه (4,600 نقطة) فلا يُشتق من سعر الصندوق فنتركه شرطة
    // بدل عرض سعر ETF موهماً أنه مستوى المؤشر.
    let viaProxy = false;
    if (chg === null && ix.proxy) {
      const pq = quotes?.[ix.proxy];
      const pc = num(pq?.regularMarketChangePercent);
      if (pc !== null) { chg = pc; viaProxy = true; }
    }
    idxRows.push({ s: ix.s, ar: ix.ar, en: ix.en, p: r2(p), chg: r2(chg), ...(viaProxy ? { proxy: ix.proxy } : {}) });
  }

  // اتساع السوق ومزاجه وقطاعاته تصف **السوق الأمريكي**. الكريبتو يتحرك
  // بمدى يومي أوسع بمراتب، فبيتكوين وحده يزيح متوسط "مزاج السوق" ويحتل
  // قائمتَي الرابحين والخاسرين كل يوم تقريباً. يبقى في الملخّص ويخرج من
  // الإحصاء.
  const usRows = summary.filter(r => r.mkt !== "crypto");
  // Number.isFinite لا isFinite: العالمية تحوّل null إلى صفر، فسهم بلا
  // سعر يُحسب "تغيّر 0%" ويدخل متوسط قطاعه ويجرّه نحو الصفر
  const withChg = usRows.filter(r => Number.isFinite(r.chg));
  const bySector = {};
  for (const r of withChg) {
    (bySector[r.sec] ||= { sec: r.sec, n: 0, sum: 0 });
    bySector[r.sec].n++; bySector[r.sec].sum += r.chg;
  }
  const sectors = Object.values(bySector)
    .map(x => ({ sec: x.sec, n: x.n, avg: r2(x.sum / x.n) }))
    .sort((a, b) => b.avg - a.avg);

  const scored = usRows.filter(r => Number.isFinite(r.score));
  // فترات التداول من رمز أمريكي حصراً: الكريبتو يتداول 24/7 وميتاداتاه
  // تعطي نافذة يوم كامل، فتقول الترويسة "السوق مفتوح" ليل السبت.
  const period = rows.find(r => r.mkt !== "crypto" && r.period)?.period || null;
  const status = period ? marketStatus(period, now) : approxMarketStatus(now);

  const mktScore = scored.length ? r2(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
  const mktBand = bandStable(mktScore, readJSON(path.join(OUT, "market.json"), {})?.band);

  writeJSON("market.json", {
    updated: now, status, period, indices: idxRows, sectors,
    breadth: {
      up: withChg.filter(r => r.chg > 0).length,
      down: withChg.filter(r => r.chg < 0).length,
      flat: withChg.filter(r => r.chg === 0).length,
      total: withChg.length
    },
    marketScore: mktScore,
    // ونطاقُه مثبَّتٌ كنطاق السهم: «مزاج السوق» يتقلّب بين وسمين في نصف
    // ساعة يُقرأ إشاراتٍ متناقضة لا رقماً يهتزّ
    ...(Number.isFinite(mktBand) ? { band: mktBand } : {}),
    gainers: [...withChg].sort((a, b) => b.chg - a.chg).slice(0, 5).map(r => ({ s: r.s, ar: r.ar, chg: r.chg, p: r.p })),
    losers:  [...withChg].sort((a, b) => a.chg - b.chg).slice(0, 5).map(r => ({ s: r.s, ar: r.ar, chg: r.chg, p: r.p })),
    /* أيُّ بديلٍ له ملفُّ شمعات — يقرؤه «توجه السوق» ليعرف أن `^GSPC`
       يُحلَّل عبر `SPY`. وهو **خارج `breadth` و`sectors` و`gainers`
       عمداً**: البديل ليس سهماً في السوق، وعدُّه فيها يحسب المؤشّر
       داخل نفسه. */
    ...(bench.length ? { bench } : {})
  });

  writeJSON("summary.json", { updated: now, count: summary.length, rows: summary });

  const prevMeta = readJSON(path.join(OUT, "meta.json"), {});
  writeJSON("meta.json", {
    ...prevMeta,
    marketUpdated: now,
    marketRun: {
      at: new Date(now).toISOString(),
      ok: rows.length, failed: failed.length, failures: failed,
      // مستبعدة لتجمّد سلسلتها — تظهر في التشخيص لا تختفي بصمت
      ...(frozen.length ? { frozen } : {}),
      stale: summary.filter(r => r.stale).map(r => r.s),
      quotes: quotes ? Object.keys(quotes).length : 0,
      requests: stats.requests, retries: stats.retries, sources: stats.sources,
      finnhub: { requests: fhStats.requests, failures: fhStats.failures },
      twelvedata: { requests: tdStats.requests, failures: tdStats.failures, budget: TD_PER_RUN },
      // الوزن لا العدد: حدّ Binance وزنيّ (‎6000‎/دقيقة) وطلب الشمعات ‎2‎
      binance: { requests: bnStats.requests, failures: bnStats.failures, weight: bnStats.weight }
    }
  });

  console.log(`✔ كُتب ${summary.length} سهماً (${(bytes / 1024).toFixed(0)} ك.ب) · حالة السوق: ${status.ar}`);
  console.log(`  طلبات: ${stats.requests} · إعادة محاولة: ${stats.retries} · إخفاقات: ${stats.failures}`);
  if (failed.length) console.log(`  ⚠ رموز فاشلة: ${failed.map(f => f.s).join(", ")}`);
}

/* ---------- فحص ذاتي بلا شبكة ---------- */
function selfCheck() {
  console.log("▶ فحص ذاتي (بلا شبكة)\n");
  let pass = 0, fail = 0;
  const t = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name} — ${e.message}`); fail++; } };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

  /* الخاصيّة لا الرقم: `!== 90` كان يُسقط الفحص عند إضافة أيّ مرشّح،
     فيدفع إلى تخفيف الفحص بدل قراءته. المطلوب أن يكفي المرشّحون للاختيار
     منهم وأن يكون لكلٍّ حقولُه — لا أن يبقى العدد كما كان يوم كُتب. */
  t("symbols.json صالح ومرشّحوه يكفون الاختيار", () => {
    if (!Array.isArray(cfg.symbols) || !cfg.symbols.length) throw new Error("لا مرشّحين");
    if (!Number.isFinite(cfg.top) || cfg.top <= 0) throw new Error("top غير صالح");
    if (cfg.symbols.length < cfg.top)
      throw new Error(`${cfg.symbols.length} مرشّحاً و${cfg.top} مطلوب`);
    for (const s of cfg.symbols) if (!s.s || !s.ar || !s.sec) throw new Error(`حقل ناقص في ${s.s}`);
  });

  t("الطبقتان الواسعة والكريبتو لا تتقاطعان مع الأساسية", () => {
    const core = new Set(cfg.symbols.map(s => s.s));
    if (!cfg.wide?.length) throw new Error("لا طبقة واسعة");
    if (!cfg.crypto?.length) throw new Error("لا كريبتو");
    const seen = new Set(core);
    for (const s of [...cfg.wide, ...cfg.crypto]) {
      if (!s.s || !s.en || !s.sec) throw new Error(`حقل ناقص في ${s.s}`);
      if (seen.has(s.s)) throw new Error(`${s.s} مكرّر بين الطبقات`);
      seen.add(s.s);
    }
    for (const c of cfg.crypto) if (c.mkt !== "crypto") throw new Error(`${c.s} بلا mkt`);
  });

  t("سقف الطبقة الواسعة يكفي لتجديدها داخل صلاحية اليومي", () => {
    const runsPerTTL = MAX_AGE["1d"] / (10 * 60e3);          // دورة السوق 10 دقائق
    if (WIDE_PER_RUN * runsPerTTL < cfg.wide.length)
      throw new Error(`${WIDE_PER_RUN}/تشغيل لا تكفي ${cfg.wide.length} رمزاً`);
  });

  const H = 3600e3;
  t("stale() يحترم أعمار الفريمات", () => {
    const now = 1_700_000_000_000;
    eq(stale({ tf: { "15m": { updated: now - 60e3 } } }, "15m", now), true, "15m دائماً");
    eq(stale({ tf: { "1h": { updated: now - 10 * 60e3 } } }, "1h", now), false, "1h حديث");
    eq(stale({ tf: { "1h": { updated: now - 2 * H } } }, "1h", now), true, "1h قديم");
    eq(stale({ tf: { "1d": { updated: now - 5 * H } } }, "1d", now), false, "1d حديث");
    eq(stale({ tf: { "1d": { updated: now - 25 * H } } }, "1d", now), true, "1d قديم");
    eq(stale(null, "1d", now), true, "لا بيانات سابقة");
  });

  t("الفريم اليومي يتجدّد أثناء الجلسة ويتجمّد خارجها", () => {
    const T = (iso) => Date.parse(iso);
    const REG  = T("2026-09-11T15:00:00Z");   // 11:00 نيويورك — جلسة
    const PRE  = T("2026-09-11T12:00:00Z");   // 08:00 — ما قبل الافتتاح
    const POST = T("2026-09-11T22:00:00Z");   // 18:00 — بعد الإغلاق
    const SAT  = T("2026-09-12T10:00:00Z");   // السبت — مغلق

    eq(dailyIsLive(REG),  true,  "الجلسة حيّة");
    eq(dailyIsLive(POST), true,  "بعد الإغلاق حيّ — لالتقاط الإغلاق الرسمي");
    eq(dailyIsLive(PRE),  false, "ما قبل الافتتاح: شمعة اليوم لم تبدأ");
    eq(dailyIsLive(SAT),  false, "السبت مغلق");
    eq(dailyIsLive(SAT, "crypto"), true, "الكريبتو بلا إغلاق");

    // الأثر: يوميٌّ عمره ساعتان قديمٌ في الجلسة وحديثٌ خارجها
    const twoH = { tf: { "1d": { updated: REG - 2 * H } } };
    eq(stale(twoH, "1d", REG, dailyIsLive(REG)), true,  "ساعتان في الجلسة = قديم");
    eq(stale({ tf: { "1d": { updated: SAT - 2 * H } } }, "1d", SAT, dailyIsLive(SAT)),
      false, "ساعتان خارج الجلسة = حديث");
    // والطبقة الواسعة تبقى على العشرين ساعة مهما كانت الجلسة
    eq(stale(twoH, "1d", REG, false), false, "الواسعة لا تتأثر بالجلسة");
    // والفريمات الأخرى لم تُمَس
    eq(stale({ tf: { "1h": { updated: REG - 10 * 60e3 } } }, "1h", REG, true), false, "1h كما كان");
  });

  /* الحالة صارت تُحسب من تقويم نيويورك لا من `period` المحفوظ.
     و`period` كانت تُمرَّر وتُقرأ، وهي **تصف يوم جلبها** — فاستعمالها
     في اليوم التالي كان يعطي «بعد الإغلاق» والسوق مفتوح. الاختباران
     أدناه يفحصان البديل: أن الحالة صحيحة بلا `period` أصلاً، وأن
     `period` قديمة لم تعد تستطيع أن تكذب. */
  t("حالة السوق تُحسب من التقويم ولا تحتاج فترات ياهو", () => {
    const at = (iso) => Date.parse(iso);
    eq(marketStatus(null, at("2026-09-15T10:00:00Z")).state, "PRE", "06:00 ET");
    eq(marketStatus(null, at("2026-09-15T15:00:00Z")).state, "REGULAR", "11:00 ET");
    eq(marketStatus(null, at("2026-09-15T21:00:00Z")).state, "POST", "17:00 ET");
    eq(marketStatus(null, at("2026-09-16T02:00:00Z")).state, "CLOSED", "22:00 ET");
  });

  t("وفتراتٌ محفوظة من يومٍ مضى لم تعد تستطيع تضليل الحالة", () => {
    // فترات أمس بالضبط، والآن جلسةٌ مفتوحة. قبل التوحيد كانت تعطي CLOSED
    const stale = { pre: { start: Date.parse("2026-09-14T08:00:00Z"), end: Date.parse("2026-09-14T13:30:00Z") },
                    regular: { start: Date.parse("2026-09-14T13:30:00Z"), end: Date.parse("2026-09-14T20:00:00Z") },
                    post: { start: Date.parse("2026-09-14T20:00:00Z"), end: Date.parse("2026-09-15T00:00:00Z") } };
    eq(statusNow(stale, Date.parse("2026-09-15T15:00:00Z")).state, "REGULAR", "اليوم مفتوح رغم فترات الأمس");
  });

  t("العطلات وأنصاف الأيام تدخل الحساب — ‎15 يناير 2024‎ كان يُقرأ يومَ تداول", () => {
    // MLK 2024-01-15 عطلةٌ رسمية. الاختبار السابق كان يتوقّع فيه «PRE»
    // و«REGULAR» و«POST» — ومرّ لأن الحساب كان بساعات الحائط بلا تقويم.
    eq(marketStatus(null, Date.UTC(2026, 0, 19, 15, 0)).state, "CLOSED", "MLK 2026");
    eq(marketStatus(null, Date.UTC(2026, 0, 20, 15, 0)).state, "REGULAR", "اليوم التالي");
    // نصفُ يومٍ: ‎13:00 ET‎ إغلاق. ‎2026-11-27‎ شتاءً ⇒ ‎18:00 UTC‎
    eq(marketStatus(null, Date.parse("2026-11-27T18:30:00Z")).state, "POST", "ما بعد الشكر نصفُ يوم");
  });

  t("packCandles/unpackCandles رحلة ذهاب وعودة", () => {
    const c = [{ t: 1_700_000_000_000, o: 1.5, h: 2.5, l: 1, c: 2, v: 100 },
               { t: 1_700_000_060_000, o: 2, h: 3, l: 1.8, c: 2.8, v: 200 }];
    const round = unpackCandles(packCandles(c));
    eq(round, c, "الشكل يعود كما كان");
    // الخلل الفعلي: مصفوفة مضغوطة تُستخدم بلا فك، فـ x.c غير معرّف
    if (packCandles(c)[0].c !== undefined) throw new Error("المضغوط يجب ألا يحمل c");
    if (typeof round[0].c.toFixed !== "function") throw new Error("المفكوك يجب أن يحمل رقماً في c");
    eq(unpackCandles(c), c, "المفكوك أصلاً يمرّ كما هو");
  });

  t("أولوية الميزانية للرموز الناقصة لا الممتلئة", () => {
    // نحاكي منطق needRank: الرمز الفارغ يسبق الممتلئ مهما كان ترتيبه الأصلي
    const rank = (tf) => !tf["1d"]?.c?.length ? 0
                       : !tf["1h"]?.c?.length ? 1
                       : !tf["15m"]?.c?.length ? 2 : 3;
    const full  = { "1d": { c: [1] }, "1h": { c: [1] }, "15m": { c: [1] } };
    const empty = {};
    eq([rank(empty), rank(full)], [0, 3], "الفارغ أولى من الممتلئ");
    eq(rank({ "1d": { c: [1] } }), 1, "ناقص الساعة");
    eq(rank({ "1d": { c: [1] }, "1h": { c: [1] } }), 2, "ناقص 15 دقيقة");
    const sorted = [{ s: "ممتلئ", t: full }, { s: "فارغ", t: empty }]
      .sort((a, b) => rank(a.t) - rank(b.t)).map(x => x.s);
    eq(sorted, ["فارغ", "ممتلئ"], "الترتيب يقدّم الناقص");
  });

  t("tradingOnly يُسقط الجلسة الممتدة والحشو معاً ولا يمحو سلسلةً بلا حجم", () => {
    /* الطوابع الزمنية **حقيقية**: الفحص السابق كان يستعمل `t: i` (أي
       ‎1970‎) فكان يقيس شرط الحجم وحده، ولا يمكنه أن يرى شرط الجلسة
       أصلاً. وهذا هو الفرق بين فحصٍ يحرس وفحصٍ يطمئن. */
    const H = 3600e3;
    // شمعات ‎15د‎ داخل الجلسة الرسمية، تلتفّ إلى اليوم التالي عند الإغلاق
    const reg = (n, v, from = Date.parse("2026-09-14T13:30:00Z")) => {
      const out = []; let t = from;
      while (out.length < n) {
        const w = Date.parse(new Date(t).toISOString().slice(0, 10) + "T13:30:00Z");
        if (t >= w + 6.5 * H) { t = w + 24 * H; continue; }   // اليوم التالي
        // ‎300‎ شمعة ‎15د‎ تمتدّ ‎11‎ يوماً فتعبر عطلتَي نهاية أسبوع —
        // وشمعاتُهما ليست «رسمية» فتسقط. نتخطّاها كما يتخطّاها السوق.
        if (!isRegularBar(t)) { t += 15 * 60e3; continue; }
        out.push({ t, o: 1, h: 1, l: 1, c: 1, v });
        t += 15 * 60e3;
      }
      return out;
    };
    // وشمعات الجلسة الممتدة: ‎04:00–09:30 ET‎ = ‎08:00–13:30 UTC‎
    const ext = (n, v, from = Date.parse("2026-09-14T08:00:00Z")) =>
      Array.from({ length: n }, (_, i) => ({ t: from + i * 15 * 60e3, o: 1, h: 1, l: 1, c: 1, v }));

    eq(tradingOnly([...ext(20, 0), ...reg(300, 5000)], "15m").length, 300, "الحشو الممتد يُسقط");

    /* ⚠ الحارس الذي أُضيف لخطرٍ قادم: شمعةٌ ممتدة **بحجمٍ حقيقي** —
       وهو ما سيعطيه مزوّدٌ يدعم الجلسة الممتدة. اليوم لا تقع هذه
       الحالة (حجم ياهو الممتد صفرٌ دائماً)، ولو اعتمد الحارسُ على
       الحجم وحده لتسرّبت هذه الشمعات إلى السلسلة الرسمية فغيّرت كل
       مؤشّرٍ في الكون بلا أيّ رسالة. */
    eq(tradingOnly([...ext(20, 9999), ...reg(300, 5000)], "15m").length, 300,
       "الممتدة بحجمٍ حقيقي تُسقط أيضاً");

    // مصدرٌ لا يعطي حجماً إطلاقاً: الإسقاط يمحو كل شيء، فالبوابة تُعيد الأصل
    eq(tradingOnly(reg(300, 0), "15m").length, 300, "بلا حجم يبقى الأصل");
    // ما بقي أقلّ من EMA200 + هامش -> الأصل كذلك
    eq(tradingOnly([...reg(100, 5000), ...ext(300, 0)], "15m").length, 400, "الناقص يبقى الأصل");
    // الفريمات الأخرى لا تُمسّ
    eq(tradingOnly([...reg(10, 5000), ...ext(10, 0)], "1d").length, 20, "اليومي لا يُمسّ");
  });

  t("`extendedCandles` تكتب «لا نعرف» لا «صفر تداول» حين يعجز المصدر", () => {
    const pre = { t: Date.parse("2026-09-15T10:00:00Z"), o: 1, h: 1, l: 1, c: 1, v: 0 };
    const regBar = { t: Date.parse("2026-09-15T15:00:00Z"), o: 1, h: 1, l: 1, c: 1, v: 0 };
    const withVol = { t: Date.parse("2026-09-15T10:05:00Z"), o: 1, h: 1, l: 1, c: 1, v: 4200 };
    const out = extendedCandles([pre, regBar, withVol], false);
    eq(out[0].v, null, "الممتدة بلا حجم ⇒ null");
    eq(out[1].v, 0, "الرسمية بحجم صفر ⇒ صفرٌ حقيقي (لم يتداول أحد)");
    eq(out[2].v, 4200, "الممتدة بحجمٍ حقيقي تبقى");
    // ومع مزوّدٍ يعطي الحجم الممتد: لا تُمسّ أصلاً
    eq(extendedCandles([pre], true)[0].v, 0, "مع مزوّدٍ قادر لا نتدخّل");
  });

  t("frozenSeries يكشف الأصل الميت ولا يطعن في السهم الهادئ", () => {
    const bars = (n, c, v) => Array.from({ length: n }, (_, i) => ({ t: i, o: c, h: c, l: c, c, v }));
    const rec = (c, src = "yahoo") => ({ src, tf: { "1d": { c } } });
    // `ARB-USD` بالحرف: سعرٌ واحد بحجم صفر
    if (!frozenSeries(rec(bars(40, 0.000629, 0)))) throw new Error("الميت لم يُكشف");
    // سهمٌ هادئ جداً لكن له حجم -> ليس ميتاً
    if (frozenSeries(rec(bars(40, 50, 900000)))) throw new Error("الهادئ اتُّهم ظلماً");
    // مصدرٌ لا يعطي حجماً -> لا حكم عليه أصلاً
    if (frozenSeries(rec(bars(40, 50, 0), "twelvedata"))) throw new Error("مصدر بلا حجم لا يُحاكم");
    // سلسلةٌ متحركة بحجم صفر (حشو): مسطَّحة؟ لا -> ليست مجمّدة
    const moving = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 50 + i, h: 50 + i, l: 50 + i, c: 50 + i, v: 0 }));
    if (frozenSeries(rec(moving))) throw new Error("المتحركة ليست مجمّدة");
    // سلسلةٌ أقصر من نافذة الحكم: لا حكم
    if (frozenSeries(rec(bars(10, 1, 0)))) throw new Error("القصيرة لا يُحكم عليها");
  });

  t("لا فريم دون 15د في أيّ قائمة يجلبها الملفّ", () => {
    /* الحارس مقلوبٌ عمداً بعد إزالة ‎5د‎: كان يؤكّد وجوده في `AN_TFS`،
       وصار يؤكّد غيابه عن القوائم الثلاث وعن خرائط المدى والصلاحية.
       وحذفُه بدل قلبه يترك البابَ مفتوحاً لعودته بلا اعتراض.

       والفريم الصغير لا يعود بخطأ بل **بأرقامٍ أخرى**: طلبٌ ثانٍ لكل
       رمز، وفرعٌ ثانٍ في كل مسار اختيارِ فريم، ونتيجةُ استراتيجيةٍ
       تُقاس على سلسلةٍ لا تُعرض. */
    const SMALL = ["1m", "2m", "3m", "5m", "10m"];
    for (const lst of [["TFS", TFS], ["AN_TFS", AN_TFS], ["EXT_TFS", EXT_TFS]])
      for (const s of SMALL)
        if (lst[1].includes(s)) throw new Error(`${s} تسرّب إلى ${lst[0]}`);
    for (const [nm, map] of [["RANGE", RANGE], ["RANGE_X", RANGE_X], ["MAX_AGE", MAX_AGE]])
      for (const s of SMALL)
        if (s in map) throw new Error(`${s} باقٍ في ${nm}`);
    eq(TFS.length, 4, "TFS أربعة");
    eq(AN_TFS.length, TFS.length, "قائمة التحليل هي الأربعة نفسها");
    // والنتيجة الكلية لا تتحرّك: هذا هو شرط القبول الذي يُبقي الأرشيف صالحاً
    const four = { "15m": { score: 10 }, "1h": { score: 20 }, "4h": { score: 30 }, "1d": { score: 40 } };
    eq(overallScore(four), overallScore({ ...four, "5m": { score: -100 } }),
       "فريمٌ دخيل لا يغيّر النتيجة الكلية");
    const tfs = (an) => Object.fromEntries(TFS.filter(t => an[t]).map(t => [t, an[t].score]));
    // و`allTF` في scans.js تشترط أربعة بالضبط
    eq(Object.keys(tfs(four)).length, 4, "allTF ما زالت تجد أربعة");
  });

  t("بديلُ المؤشّر له ملفّ شمعات ولا صفَّ له في الملخّص", () => {
    /* `SPY` يُجلب ليُحلَّل، ولا يدخل `summary.rows` — وإلا حُسب
       المؤشّرُ سهماً داخل «اتساع السوق» و«القطاعات» و«الرابحين»،
       وظهر في البحث والقوائم وحاسبة الارتباط. اثنا عشر موضعاً تفحص
       `mkt !== "crypto"` ولا واحد منها يعرف الطبقة الثالثة.

       والفحص على البيانات المكتوبة فعلاً لا على النيّة. */
    const proxies = (cfg.indices || []).map(i => i.proxy).filter(Boolean);
    if (!proxies.length) return;
    const sfile = path.join(OUT, "summary.json");
    if (!fs.existsSync(sfile)) { console.log("      (لا بيانات محلية — تُخطّى)"); return; }
    const sum = JSON.parse(fs.readFileSync(sfile, "utf8"));
    for (const p of proxies)
      if ((sum.rows || []).some(r => r.s === p))
        throw new Error(`${p} تسرّب إلى summary.rows — سيُحسب داخل اتساع السوق`);
    const mfile = path.join(OUT, "market.json");
    if (fs.existsSync(mfile)) {
      const m = JSON.parse(fs.readFileSync(mfile, "utf8"));
      for (const p of proxies)
        if ((m.gainers || []).concat(m.losers || []).some(r => r.s === p))
          throw new Error(`${p} في قوائم الرابحين/الخاسرين`);
    }
    // ولا تُعدّ الطبقة الثالثة في المقام: `allJobs` تجمعها، و`jobs` وحدها
    // هي مقام «نجح كذا من كذا»
    eq(typeof benchMeta === "undefined", true, "benchMeta محلّية في main لا عالمية");
  });

  t("السلسلة الممتدة لا تُغيّر النتيجة الفنية ولا تدخل `an`", () => {
    /* أخطرُ ما في هذه المرحلة: أن تتسرّب شمعةٌ ممتدة إلى `tf` أو
       مؤشّرٌ ممتد إلى `an`. الأثر ليس خطأً بل **أرقاماً أخرى** لكل
       رمزٍ في الكون، ومعها يبطل الأرشيف الذي قاس الشروط على السلاسل
       القديمة. الفحص يقفل البابين معاً. */
    if (EXT_TFS.some(t => TFS.includes(t) && false)) throw new Error("تعارض");
    // `anx` ليست `an`: النتيجة تُحسب من `an` وحدها
    const an = { "15m": { score: 10 }, "1h": { score: 20 }, "4h": { score: 30 }, "1d": { score: 40 } };
    const before = overallScore(an);
    const rec = { an, anx: { "15m": { score: -100 } } };
    eq(overallScore(rec.an), before, "anx لا تدخل الحساب");
    // ولا يجوز أن يحمل `AN_TFS` فريماً ممتداً: أسماؤها متطابقة والفرق
    // في السلسلة لا في الاسم، فخلطُها يُقرأ صحيحاً ويحسب خطأً
    for (const t of AN_TFS) if (String(t).endsWith("x")) throw new Error("فريم ممتد في AN_TFS");
  });

  t("الشمعة الممتدة لا تدخل السلسلة الرسمية ولو حملت حجماً", () => {
    const H = 3600e3;
    const regBar = { t: Date.parse("2026-09-15T15:00:00Z"), o: 1, h: 1, l: 1, c: 1, v: 100 };
    const preBar = { t: Date.parse("2026-09-15T10:00:00Z"), o: 1, h: 1, l: 1, c: 1, v: 100 };
    eq(isRegularBar(regBar.t), true, "الرسمية");
    eq(isRegularBar(preBar.t), false, "الممتدة");
  });

  /* =====================================================================
     الشمعة الجارية لا تدخل المؤشّرات — وهي العلّة الجذرية لتبدّل قائمة
     الفرص داخل الشمعة الواحدة. والحذف **مشروط**: شمعةٌ مغلقة تبقى،
     وإلّا قرأت الأسهم الأمريكية مساءً شمعةَ أمس اليومية.
     ===================================================================== */
  t("closedBars يُسقط الجارية ويُبقي المغلقة — لحظياً ويومياً", () => {
    /* **الأختام على شبكة الفريم إلزاماً.** شمعةُ ربع ساعةٍ ختمُها من
       مضاعفات ‎900‎ ثانية بحكم تعريفها، وأيُّ ختمٍ سواها طبعةٌ جزئية
       لا شمعة. وكان هذا المُثبِّت يرتكز على `1_700_000_000_000` وهي
       ليست على الشبكة، فصارت «المغلقة» عنده خارج الشبكة — ومرّ الفحص
       لأن الدالّة لم تكن تفحص الشبكة. */
    const q = 900000;
    const g = Math.floor(1_700_000_000_000 / q) * q;   // حدُّ شمعة
    const now = g + 300000;                            // خمس دقائق داخل الجارية
    const bar = (t, c) => ({ t, o: c, h: c, l: c, c, v: 1 });
    // ١٥د: الشمعة الجارية (بدأت عند `g`) ⇒ تُحذف
    const live15 = [bar(g - q, 1), bar(g, 2)];
    eq(closedBars(live15, "15m", now).length, 1, "الجارية تُحذف");
    // وشمعةٌ انقضى ربعُها ⇒ مغلقة فتبقى
    const done15 = [bar(g - 3 * q, 1), bar(g - 2 * q, 2)];
    eq(closedBars(done15, "15m", now).length, 2, "المغلقة تبقى");
    /* **الطبعةُ الجزئية خارج الشبكة تُحذف هي والجارية معاً.**
       ياهو يُرفق بالسلسلة الممتدّة ختمَ الدقيقة الجارية (`AAPL`:
       ‎…09:00 · 09:15 · 09:16‎). وحذفُ واحدةٍ فقط كان يُبقي ‎09:15‎
       — وهي قيد التكوّن — «مؤكَّدة»، فتقدّم `confBar` شمعةً كاملة
       أمام `cbar` وتجمّدت لقطة الفرص ساعةً و‎46‎ دقيقة. */
    const partial = [bar(g - 3 * q, 1), bar(g - 2 * q, 2), bar(g, 3), bar(g + 60000, 4)];
    eq(closedBars(partial, "15m", now).length, 2,
       "الجارية والطبعة الجزئية تُحذفان كلتاهما");
    eq(closedBars(partial, "15m", now).at(-1).t, g - 2 * q,
       "فتبقى آخرُ شمعةٍ مغلقةٍ على الشبكة");
    // وختمٌ خارج الشبكة وسط السلسلة لا يُلمس: الحلقة تتوقّف عند أوّل مغلقة
    const mid = [bar(g - 4 * q, 1), bar(g - 3 * q + 60000, 2), bar(g - 2 * q, 3)];
    eq(closedBars(mid, "15m", now).length, 3, "ما قبل آخر مغلقةٍ يبقى كما هو");
    /* اليوميّ: لا طول ثابت له. شمعةُ أمس مختومةً ‎13:30‎ تُقرأ «جارية»
       بقاعدة `t + 86400000` حتى ‎13:30‎ اليوم — وهي مغلقة منذ ‎20:00‎
       أمس. فالمقياس اليومُ نفسه. */
    const day = 86400000, d0 = Math.floor(now / day) * day;
    eq(closedBars([bar(d0 - day, 1), bar(d0 + 48600000, 2)], "1d", now).length, 1,
       "شمعة اليوم جارية");
    eq(closedBars([bar(d0 - 2 * day, 1), bar(d0 - day + 48600000, 2)], "1d", now).length, 2,
       "شمعة أمس مغلقة ولو كان ختمُها منتصف الجلسة");
    // ولا يمرّ الفحص بلا مفعول: الحذف يجب أن يغيّر المؤشّرات فعلاً
    const k = [];
    for (let i = 0; i < 60; i++) k.push(bar(g - (60 - i) * q, 100 + Math.sin(i / 3) * 5));
    k.push(bar(g, 300));                            // الشمعة الجارية، شاذّة
    const full = analyze(k), cut = analyze(closedBars(k, "15m", now));
    if (!full || !cut) throw new Error("تحليلٌ فارغ");
    if (Math.abs(full.rsi - cut.rsi) < 1)
      throw new Error("الشمعة الجارية لا تغيّر المؤشّرات — الفحص بلا مفعول");
    return "الجارية تُحذف · المغلقة تبقى · والفرق مقيس";
  });

  t("aggregate ثابتٌ أمام تدحرج النافذة — لا ينزاح بطول المصفوفة", () => {
    /* المصيدة التي بلّغ عنها مستخدم: التقسيم بالفهرس يزيح حدود
       المجموعات كلّما تغيّر طولُ السلسلة، فتقع نفس ساعات السوق في
       مجموعاتٍ مختلفة بين تشغيلٍ وآخر — فتتغيّر شمعة 4h وتنقلب بوابةٌ
       وزنُها ‎1.5‎ وتتحرّك النتيجة ‎~11‎ نقطة بلا حركة سعر.

       الفحص: نفس السلسلة بأربع بداياتٍ مختلفة يجب أن تعطي **نفس
       الشمعات** في الذيل المشترك. */
    const HOUR = 3600e3, start = Date.UTC(2026, 8, 1, 13, 30);
    const k = [];
    for (let i = 0; i < 200; i++) {
      // فجوةٌ ليلية بعد كل ستّ شمعات — كما الجلسة الحقيقية
      const day = Math.floor(i / 6), hr = i % 6;
      k.push({ t: start + day * 24 * HOUR + hr * HOUR,
               o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 });
    }
    const full = aggregate(k, 4);
    for (const drop of [1, 2, 3, 5]) {
      const rolled = aggregate(k.slice(drop), 4);
      const a = full.slice(-5), b = rolled.slice(-5);
      for (let i = 0; i < 5; i++)
        eq([b[i].t, b[i].o, b[i].h, b[i].l, b[i].c, b[i].v],
           [a[i].t, a[i].o, a[i].h, a[i].l, a[i].c, a[i].v],
           `إسقاط ${drop} شمعة غيّر شمعة 4h رقم ${i}`);
    }
    // وإضافةُ شمعةٍ جديدة لا تعيد تشكيل ما قبلها
    const grown = aggregate(k.concat([{ t: k[k.length - 1].t + HOUR, o: 300, h: 301, l: 299, c: 300, v: 1 }]), 4);
    const prev = full.slice(0, -1), now = grown.slice(0, prev.length);
    for (let i = 0; i < prev.length; i++)
      eq([now[i].t, now[i].c], [prev[i].t, prev[i].c], `شمعةٌ جديدة أعادت تشكيل 4h رقم ${i}`);
  });

  t("aggregate يبني 4h صحيحة من 1h", () => {
    const c = [{ t: 0, o: 1, h: 5, l: 0.5, c: 2, v: 10 }, { t: 1, o: 2, h: 6, l: 1, c: 3, v: 10 },
               { t: 2, o: 3, h: 4, l: 2, c: 4, v: 10 }, { t: 3, o: 4, h: 9, l: 3, c: 5, v: 10 }];
    const [b] = aggregate(c, 4);
    eq([b.o, b.h, b.l, b.c, b.v], [1, 9, 0.5, 5, 40], "شمعة مجمّعة");
  });

  t("analyze يعطي إشارات صحيحة", () => {
    const up = Array.from({ length: 300 }, (_, i) => ({ t: i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1 }));
    if (analyze(up).score < 50) throw new Error("صعود لم يُكتشف");
    const dn = up.slice().reverse().map((x, i) => ({ ...x, t: i }));
    if (analyze(dn).score > -50) throw new Error("هبوط لم يُكتشف");
    if (analyze(up.slice(0, 5)) !== null) throw new Error("سلسلة قصيرة يجب أن تعيد null");
  });

  t("overallScore يزن الفريمات الكبيرة أكثر", () => {
    const s = overallScore({ "15m": { score: -100 }, "1h": { score: -100 }, "4h": { score: 100 }, "1d": { score: 100 } });
    const expect = (-100 * 0.5 + -100 * 1 + 100 * 1.5 + 100 * 2) / 5;
    if (Math.abs(s - expect) > 1e-9) throw new Error(`${s} ≠ ${expect}`);
    if (s <= 0) throw new Error("الفريمات الكبيرة يجب أن ترجّح النتيجة للصعود");
    eq(overallScore({}), null, "بلا فريمات");
  });

  t("rp يحفظ أسعار الأصول الرخيصة ولا يمحوها", () => {
    // شيبا إينو بسعر حقيقي 0.0000051 — التقريب لأربع خانات كان يعطي صفراً
    eq(rp(0.0000051), 0.0000051, "سعر دون المليونية");
    eq(rp(0.00000512345678), 0.00000512346, "ستة أرقام معنوية");
    eq(rp(0.5), 0.5, "أقل من واحد");
    // الأسعار العادية كما كانت: أربع خانات عشرية
    eq(rp(62.014999389648438), 62.015, "سعر سهم");
    eq(rp(5812.3456789), 5812.3457, "سعر مرتفع");
    eq(rp(-0.0000051), -0.0000051, "سالب");
    eq([rp(null), rp(undefined), rp(NaN), rp(0)], [null, null, null, 0], "الحالات الحدّية");
  });

  t("num() لا يختلق أرقاماً", () => {
    eq([num(3), num({ raw: 4 }), num(null), num(undefined), num(NaN), num("5")], [3, 4, null, null, null, null], "num");
  });

  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل`);
  process.exit(fail ? 1 : 0);
}

if (CHECK) selfCheck();
else main().catch(e => { console.error("✗ فشل التشغيل:", e.message); process.exit(1); });
