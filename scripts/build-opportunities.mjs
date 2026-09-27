/* =====================================================================
   بناءُ لقطة الفرص — تُكتب **حين يتقدّم مفتاح الشمعة، ولا تُكتب بينهما**.

   العلّة التي وُجد لأجلها (مقيسة على الإنتاج ‎2026-09-20‎):
   ثلاثة إيقاعات لا يقسم أحدها الآخر — الشمعة ‎15‎ دقيقة، ودورة السوق
   التي تكتب `summary.json` ‎10‎ دقائق، ودورة الأسعار التي تكتب
   `strategies.json` ‎دقيقتان‎. فالقائمة كانت تتبدّل في لحظاتٍ لا علاقة
   لها بإغلاق شمعة، ومن ملفّين يصفان شمعتين مختلفتين لخمس دقائق في
   كل ربع ساعة.

   البوّابات الثلاث — وكلُّها ترفض الكتابة لا تُصلحها:

   ١) **المصدران يصفان الشمعة نفسها**: `max(cbar)` في الطبقة الحيّة
      يجب أن يساوي `confBar` في لقطة الاستراتيجيات. واختلافُهما ليس
      خطأً بل **الحالة الطبيعية** لدقيقةٍ أو اثنتين بعد كل إغلاق —
      والصواب حينها الانتظار لا المزج.

   ٢) **مفتاح الشمعة تقدّم**: بصمةُ الصفوف لا يجوز أن تتغيّر داخل
      المفتاح الواحد. فإن تغيّرت بلا تقدّم — وهو ما يحدث حين تدوّر
      الطبقة الواسعة صفوفَها وسط الشمعة — **تُرفض الكتابة** وتبقى
      اللقطة السابقة حتى الإغلاق التالي.

   ٣) **نسخةُ المنطق**: تغيُّر شيفرة الشروط أو الإجماع يغيّر الصفوف
      بحقّ. فيُسمح بالكتابة داخل نفس المفتاح **إن تغيّرت النسخة وحدها**،
      ويُسجَّل ذلك صراحةً في سجلّ التدقيق. بلا هذا الاستثناء لا يصل
      أيُّ إصلاحٍ إلى المستخدم قبل ربع ساعة.

   المخرَج: `data/opportunities.json` و`data/opportunities-log.json`.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const STOCKS = path.join(ROOT, "stocks");

const { SCANS, scanRow, forcedDir } = require("../stocks/scans.js");
const { resolveOpp } = require("../stocks/direction.js");
const { consFromRows, scsFrom, oppQualityOf } = require("../stocks/confluence.js");
const { STRATEGIES, STRAT_BY_ID } = require("../stocks/strategies.js");
const { buildOpps, oppsCanon, snapCanon, candleKeyAt } = require("../stocks/opportunities.js");
const { closedBars } = require("../stocks/indicators.js");
const { unpackK } = require("../stocks/plan.js");
const { freshness, scanTF } = require("../stocks/evaluate.js");
import { buildSnap } from "./track-signals.mjs";
import { rp } from "./lib/round.mjs";

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
const OUT = process.env.OPP_OUT || path.join(ROOT, "data");
/* =====================================================================
   **دفتر الكريبتو** (`BOOK=crypto`) — نفس المحرّك بإعداداتٍ أخرى، لا نسخة:
     · المفتاح شمعةُ ‎5د‎ (`OPP_BAR_SEC=300`) والمشي على ‎5د‎ المغلقة.
     · **الإعدادات وحدها فرص** (`C_SETUPS`): «حجم غير معتاد» و«قرب قمة/قاع
       52» معلوماتٌ عن العملة لا صفقات، وتُعرض في شاشتها لا في القائمة.
     · **بوّابة جودة قبل العرض**: خطةٌ كاملة (دخول ووقف وهدف)، وإجماعٌ غير
       متعارض، ودرجةٌ ≥ ‎0.5‎ — ثم أعلى ‎20‎ لكل إعداد. مئاتُ العملات التي
       تحقّق شرطاً عامّاً لا تُسمّى فرصاً.
     · **البيتكوين مرجعاً**: معامِلٌ على الدرجة ‎1 ± 0.25‎ بحسب توافق جهة
       الفرصة مع اتجاه البيتكوين (1h/4h/1d المغلقة) وقوّته. المعاكسة لا
       تُمنع — تُخفَّض وتُوسَم.
     · **سجلٌّ للمنتهية** (`opp-history.json`) وأرشيفُ لقطةٍ لكل شمعة
       (`.monitor/snaps`) — منهما تقرير الأداء.
   والقيم كلُّها ثابتةٌ قبل الاختبار ولا تُضبط أثناءه.
   ===================================================================== */
const CRYPTO = process.env.BOOK === "crypto";
const BAR_SEC = Number(process.env.OPP_BAR_SEC || (CRYPTO ? 300 : 900));
const WALK_TF = CRYPTO ? "5m" : "15m";
const C_SETUPS = ["align", "alignDn", "divBull", "divBear", "pullback"];
/* الطزاجة على الساعة: جديدة ≤ ساعتين · قائمة ≤ ‎6‎ · متأخّرة ≤ ‎20‎ · بعدها
   «قديمة» تنتهي. كانت على ‎4س‎ (قديمةٌ بعد ‎80‎ ساعة) فبقيت إعداداتٌ حيّة
   بلا حسمٍ تحتلّ القائمة يوماً كاملاً. */
const C_FRESH_TF = "1h";
const C_TOP = 20, C_BEST = 15, C_QMIN = 0.5, BTC_W = 0.25;
/* =====================================================================
   **دورة حياة الكريبتو ٢** — ما كشفه اختبار السبت (2026-09-27):

   ‎303‎ من ‎317‎ فرصة منتهية خرجت بـ«زال السبب» لا بهدفٍ ولا وقف، و`PUMP`
   اختفت ‎11‎ مرّة في ‎14‎ ساعة — **عشرٌ منها لأن ‎5د‎ وحده نزل** تحت ‎15‎
   والفريمات الثلاثة الأعلى صاعدة بقوّة (‎15د 76 · ساعة 94 · 4س 94‎).
   `allTF` يشترط الأربعة في كل شمعة، و‎5د‎ يتذبذب بطبيعته.

   ١) **الدخول غير البقاء** (`C_CORE`): الإعداد يُدخَل بشرطه كاملاً (الأربعة
      — زخمٌ حاضر)، ويبقى صالحاً ما دامت الفريمات الأعلى على جهته. فتذبذبُ
      ‎5د‎ لا يمسح فرصةً قائمة على ‎15د/ساعة/4س‎.
   ٢) **بوّابة الجودة وسقف العدد للدخول وحده**: فرصةٌ عُرضت لا تسقط من القائمة
      لأن رتبتها صارت ‎21‎ أو درجتها المئوية نزلت — تخرج بدورة حياتها فقط.
   ٣) **زوالُ السبب مؤكَّد**: ‎3‎ شموع ‎5د‎ مغلقة متتالية لا يصمد فيها حتى
      قلبُ الإعداد (الفريمات الأعلى) — ربعُ ساعة، شمعةُ ‎15د‎ كاملة.
   ٤) **لا مطاردة**: الدرجة تُخفَّض بقدر تمدّد السعر عن متوسّط ‎20‎ على الساعة
      (بوحدات ATR الساعة) وبقدر ضيق المسافة الباقية إلى الهدف التالي مقابل
      الوقف. عملةٌ صعدت بقوّة قبل ظهورها لا تأخذ درجةً أعلى لأنها صعدت.
   ٥) **البيتكوين يرجّح ولا يخنق**: الموافِقة ‎+25%‎ كحدٍّ أقصى، والمعاكِسة
      ‎−12%‎ كحدٍّ أقصى (كانت ‎−25%‎) — إعدادٌ هابطٌ قويّ في سوقٍ صاعد يُوسَم
      ولا يُدفن تحت القائمة.
   ===================================================================== */
const C_MISS = 3, BTC_W_DN = 0.12, C_CAP = 40;
/* قلبُ الإعداد: الساعة و‎4س‎ على جهته، و‎15د‎ **لا يعاكسه بقوّة** (فوق ‎−45‎
   في جهته). أوّلُ صيغةٍ اشترطت ‎15د‎ ≥ ‎15‎ فصارت هي المتذبذبة: في إعادة
   تشغيل الأحد، ‎105‎ من ‎113‎ انتهاءً «زال السبب» كان ‎15د‎ وحده والساعة و‎4س‎
   قائمتان. فالوزن للأعلى كما طلب المالك: ‎5د‎ للدخول، و‎15د‎ حارسُ انعكاس،
   والساعة و‎4س‎ هما الإعداد. */
const coreHolds = (tf, d) => ["1h", "4h"].every(t => Number.isFinite(tf[t]) && tf[t] * d >= 15)
  && Number.isFinite(tf["15m"]) && tf["15m"] * d > -45;
/* قلبُ كل إعدادٍ — ما يجب أن يبقى صحيحاً كي تبقى الفرصة، لا شرطُ دخولها:
   · التوافق: الساعة و‎4س‎ على جهته و‎15د‎ لا يعاكس بقوّة (أعلاه).
   · الارتداد: **الاتجاه الأمّ** قائم (فوق م200 وم50 فوق م200). شرطُ الدخول
     «تحت م20» يسقط حين ينجح الارتداد نفسه — فكانت الصفقة الرابحة تنتهي
     «زال السبب» وهي في طريقها إلى هدفها (‎14‎ في إعادة تشغيل الأحد).
   · التباعد: الساعة لا تعاكسه بقوّة — إشارةُ انعطافٍ تُعطى وقتها. */
const C_CORE = {
  align:    [1,  (r) => coreHolds(r.tfScore || {}, 1)],
  alignDn:  [-1, (r) => coreHolds(r.tfScore || {}, -1)],
  pullback: [1,  (r) => Number.isFinite(r.e200) && r.p > r.e200 && r.e50 > r.e200],
  divBull:  [1,  (r) => Number.isFinite((r.tfScore || {})["1h"]) && r.tfScore["1h"] > -45],
  divBear:  [-1, (r) => Number.isFinite((r.tfScore || {})["1h"]) && r.tfScore["1h"] < 45]
};
const LIFE_V = "c6";              // لقطةٌ من قبل هذا الإعداد لا تُورَث حالتُها
export const btcAlign = (sd, regime) => {
  if (!(sd === 1 || sd === -1) || !regime || !Number.isFinite(regime.score)) return null;
  const a = Math.max(-1, Math.min(1, sd * regime.score / 100));
  return { a: Math.round(a * 100) / 100,
           k: a >= 0.45 ? "strong" : a >= 0.15 ? "mid" : a > -0.15 ? "flat" : "counter" };
};
export const btcMult = (a) => a >= 0 ? 1 + BTC_W * a : 1 + BTC_W_DN * a;
/* التمدّد: كم ATR (ساعة) يبعد الإغلاق عن متوسّط ‎20‎ الساعة في جهة الفرصة.
   حتى ‎1×‎ طبيعي، وبعده ينقص المعامِل ‎25%‎ لكل ATR إضافي (أدنى ‎0.4‎). */
/* قِيس على إعادة تشغيل الأحد («الأقوى الآن»، ‎1092‎ عيّنة، عائد ‎4س‎ في جهة
   الفرصة): تمدّد ≤1 ‎−0.11%‎ · 1–2 ‎−0.46%‎ · 2–3 ‎−0.56%‎ · >3 ‎−1.06%‎ —
   علاقةٌ رتيبة، فالعقوبة تبدأ من ‎0.5‎ ATR وتنقص ‎30%‎ لكل ATR (أدنى ‎0.3‎).
   معايرةٌ على العيّنة نفسها — والاختبار الحيّ بعدها هو الحكم. */
export const extFactor = (ext) => !Number.isFinite(ext) || ext <= 0.5 ? 1 : Math.max(0.3, 1 - 0.3 * (ext - 0.5));
/* المسافة الباقية: (الهدف التالي − الإغلاق) ÷ (الإغلاق − الوقف). ‎1.5‎ فأكثر
   كامل، ودونها يتناسب (أدنى ‎0.4‎)، وتحت الوقف أو بلا هدفٍ باقٍ ‎0.4‎. */
export const roomFactor = (rr) => !Number.isFinite(rr) || rr <= 0 ? 0.3 : Math.min(1, Math.max(0.3, rr / 2));
/* =====================================================================
   **الدرجة للكريبتو = جودةُ الدخول أولاً، وقوّةُ الإعداد ثانياً.**

   فُكّكت الدرجة على إعادة تشغيل الأحد (‎3570‎ صفّاً، عائد ‎4س‎ في جهة
   الفرصة): رتبةُ الإعداد (قوّة الاتجاه) **معكوسة الدلالة** — النصف الأدنى
   ‎+0.15%‎ والأعلى ‎−0.46%‎ — وكذلك عددُ الاستراتيجيات المتّفقة (‎4‎ فأكثر
   ‎−0.46%‎). أمّا التمدّد والمسافة الباقية والحداثة فتتنبّأ في الاتجاه
   الصحيح. وهو نفس درس أرشيف الأسهم (عشر سنوات): هذا الكون يدفع على الدخول
   المبكّر ويعاقب على مطاردة الزخم.
   فقوّة الإعداد تبقى **بوّابةً** للدخول ووزناً ثانوياً (‎40%‎)، والباقي
   لجودة الدخول: غير متمدّد · أمامه مسافة · حديث · والبيتكوين مرجِّحاً.
   ===================================================================== */
const setupWeight = (q0) => 0.6 + 0.4 * Math.max(0, Math.min(1, Number.isFinite(q0) ? q0 : 0));
const sha12 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
/* أدنى نسبةٍ من الصفوف الحيّة يجب أن تحمل الفريمات الأربعة. انظر
   «البوّابة ٠» أدناه. */
const DEPTH_MIN = 0.90;
/* مصدر المدخلات قابلٌ للحقن: إعادةُ التشغيل التاريخية تمرّ بالمحرّك نفسه
   حرفاً بحرف وبياناتُها في الذاكرة — لا نسخةٌ ثانية من المنطق. */
let IO = null;
const rd = (f) => { if (IO) return IO.rd(f); try { return JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")); } catch { return null; } };

/* نسخةُ المنطق = بصمةُ الملفّات التي تحدّد الصفوف. تغيُّرُ أيٍّ منها
   يغيّر القائمة بحقّ، فيُسمح بإعادة البناء داخل نفس الشمعة. ولا تشمل
   `index.html`: العرضُ لا يغيّر ما يُحسب. */
const LOGIC = ["scans.js", "confluence.js", "direction.js", "consensus.js",
               "strategies.js", "score.js", "opportunities.js"];
function logicVersion() {
  return sha12(LOGIC.map(f => f + ":" + sha12(fs.readFileSync(path.join(STOCKS, f), "utf8"))).join("|"));
}

/* وسائط القطاعات — يحتاجها شرط «أرخص من قطاعه».

   **الشكل جزءٌ من العقد**: `ctx.secMed[sec]` كائنٌ لا رقم، والشرط
   يقرأ `m.pe`. أوّل صيغةٍ هنا أعادت رقماً فخرج الشرط بـ`false` دائماً
   و«أرخص من قطاعه» بصفر صفّ وهو ‎53‎ في الواجهة — بلا خطأ ولا استثناء.
   نفس عائلة `{ secMed: {} }` الموثّقة: حارسٌ يقرأ حقلاً لا وجود له
   فيصمت. ولهذا يقابل الفحصُ اللقطةَ بحساب الواجهة رمزاً رمزاً.

   والحسابُ نظيرُ `fundScores` في `index.html`: على الطبقة الحيّة
   وحدها، ووسيطُ القيم المنتهية. و`SCANS` لا تقرأ منها إلا `pe`،
   والبقية محسوبةٌ كي لا يسقط مستهلكٌ يُضاف لاحقاً بصمت. */
const medianOf = (a) => {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
function sectorMedians(rows, F) {
  const bySec = {};
  for (const r of rows) { if (r.sec && F[r.s]) (bySec[r.sec] ||= []).push(F[r.s]); }
  const out = {};
  for (const [sec, f] of Object.entries(bySec)) {
    out[sec] = {
      n: f.length,
      pe:     medianOf(f.map(x => x.pe)),
      pb:     medianOf(f.map(x => x.pb)),
      roe:    medianOf(f.map(x => x.roe)),
      margin: medianOf(f.map(x => x.margin)),
      grow:   medianOf(f.map(x => x.revGrow)),
      ps:     medianOf(f.map(x => x.psales)),
      evEb:   medianOf(f.map(x => x.evEbitda)),
      de:     medianOf(f.map(x => x.de))
    };
  }
  return out;
}

/* =====================================================================
   دورة حياة الفرصة — **حتمية، على الشمعات المغلقة وحدها.**

   كانت «منذ 8 أيام» تُقرأ من `signals.json` الذي يُحدَّث بالسعر اللحظي،
   والفرصة لا تُغلق حين يزول سببها، والترتيب لا يعرف عمرها ولا ما تحقّق
   من حركتها — فتتصدّر قديمةٌ راكدة فوق فرصةٍ جديدة أقوى.

   الآن لكل `رمز|شرط|اتجاه` حالةٌ تُحفظ في اللقطة نفسها وتتقدّم مع
   المفتاح وحده: بدايةُ الاستمرار وإغلاقُها، والخطة المثبّتة لحظتها،
   وما بُلغ من أهدافها بالشمعات المغلقة بعدها (شمعةٌ تلمس الوقف والهدف
   معاً وقفٌ — قاعدة المحاكاة الثانية). وتنتهي الفرصة بالوقف أو بآخر
   هدف أو بغياب شرطها شمعتين أو بانقضاء صلاحيتها («قديمة» بمقياس فريم
   الشرط). والتحديث **متساوي القوّة**: إعادةُ البناء داخل الشمعة نفسها
   تعطي الحالة نفسها بالحرف.
   ===================================================================== */
const MISS_MAX = 2;                        // غيابُ الشرط شمعتين ⇒ انتهى سببُها
const F_FRESH = { fresh: 1, live: 0.85, late: 0.6 };   // «قديمة» تُنهى
const F_ROOM = [1, 0.7, 0.4, 0.4];         // بعد T1 / بعد T2: الحركة جرت
const lifeKey = (s, scan, d) => s + "|" + scan + "|" + d;

function symBars(sym, cache, nowMs) {
  if (sym in cache) return cache[sym];
  let rec = null;
  if (IO) rec = IO.sym(sym);
  else try { rec = JSON.parse(fs.readFileSync(path.join(OUT, "sym", sym + ".json"), "utf8")); } catch { /* بلا ملف */ }
  const k = {};
  for (const tf of [WALK_TF, "4h", "1d"]) {
    const cc = rec && rec.tf && rec.tf[tf] && rec.tf[tf].c;
    k[tf] = cc && cc.length ? closedBars(unpackK(cc), tf, nowMs).slice(-259) : [];   // AN_WIN
  }
  return (cache[sym] = { rec, k });
}

/* يمرّ على الشمعات بالترتيب ويحدّث الحالة: دخول ثم وقف ثم أهداف. */
function walk(L, bars) {
  for (const b of bars) {
    const ts = Math.round(b.t / 1000);
    if (ts <= L.upto) continue;
    L.upto = ts;
    if (L.end) continue;
    const d = L.d;
    const fav = d === 1 ? b.h : b.l, adv = d === 1 ? b.l : b.h;
    if (Number.isFinite(fav)) L.mfe = d === 1 ? Math.max(L.mfe ?? fav, fav) : Math.min(L.mfe ?? fav, fav);
    if (Number.isFinite(adv)) L.mae = d === 1 ? Math.min(L.mae ?? adv, adv) : Math.max(L.mae ?? adv, adv);
    if (!L.in && Number.isFinite(L.e) && (adv - L.e) * d <= 0) L.in = 1;
    if (L.in && Number.isFinite(L.st) && (adv - L.st) * d <= 0) {
      L.end = { k: "stop", at: ts }; continue;               // الوقف يغلب في الشمعة نفسها
    }
    const t = L.t || [];
    while (L.hit < t.length && (fav - t[L.hit]) * d >= 0) L.hit++;
    if (t.length && L.hit >= t.length) L.end = { k: "tgt", at: ts };
  }
}

function seedFromSignals(sigs) {
  const by = {};
  for (const r of sigs || []) {
    if (!r.open || r.conv || !r.snap || !(r.snap.dir === 1 || r.snap.dir === -1)) continue;
    const k = lifeKey(r.sym, r.scan, r.snap.dir);
    if (!by[k] || r.at > by[k].at) by[k] = r;
  }
  return by;
}

export function buildSnapshot(now = Date.now(), io = null) {
  IO = io;
  try { return buildSnapshotImpl(now); } finally { IO = null; }
}
function buildSnapshotImpl(now) {
  const summary = rd("summary.json");
  const strat = rd("strategies.json");
  if (!summary || !Array.isArray(summary.rows) || !summary.rows.length)
    return { ok: false, why: "summary.json غائب أو فارغ" };
  if (!strat || !Array.isArray(strat.rows))
    return { ok: false, why: "strategies.json غائب" };

  const wideFile = rd("wide.json");
  const wideRows = (wideFile && (wideFile.rows || wideFile)) || [];
  const fundFile = rd("fundamentals.json");
  const F = (fundFile && fundFile.f) || {};
  const edgeFile = rd("strategy-edge.json");
  const edge = {};
  for (const r of (edgeFile && edgeFile.rows) || []) edge[r.id] = r;

  /* ══════════════════════════════════════════════════════════════════
     البوّابة ٠: **عمق الفريمات** — وتسبق الباقية عن قصد.

     البوّابات الثلاث تسأل «هل البيانات متّسقة؟»، ولا واحدة منها تسأل
     «هل هي كاملة؟». وهذه هي الفجوة التي عاشت فيها أخطرُ علّةٍ مرّت
     باللقطة: كان `fetch-market` في وضع التأكيد السريع يمحو الفريم
     الساعيَّ واليوميَّ من ملفّات الرموز، فتخرج `tfScore` بمفتاحين —
     و`allTF` في `scans.js` تشترط أربعةً بالضبط.

     فكانت اللقطة تُكتب **متّسقةً تماماً وناقصةً تماماً**: «توافق
     الفريمات ▲» و«▼» بصفر صفّ (‎68‎ و‎24‎ في الحقيقة)، و`vol` تسعة من
     ‎113‎، و`pullback` و`divBull`/`divBear` منقوصة — ‎302‎ صفّاً بدل
     ‎532‎. والواجهة تقول «لا رمز ينطبق عليه هذا الشرط الآن — وهذا
     نتيجة صحيحة لا عطل»: نصٌّ يكذب بحسن نيّة.

     ولقطةٌ لا تستطيع **بنيوياً** أن تحوي شرطاً لا تُنشر كأنها القائمة:
     هو «اعرض ‎—‎ لا رقماً ملفّقاً» مطبَّقاً على قائمةٍ كاملة. والانتظار
     هو الصواب كما في البوّابة ١ — لقطةُ الشمعة السابقة أصدقُ من لقطةٍ
     منقوصة لهذه الشمعة.

     **والبوّابة نسبيّة لا بالتساوي التامّ**: رمزان في الكون الحيّ لهما
     فريمٌ واحد بحقّ (أوّل جلبٍ لهما)، وشرطٌ مطلق ينكسر عند أوّل توسّع.
     ══════════════════════════════════════════════════════════════════ */
  const four = summary.rows.filter(r => Object.keys(r.tfScore || {}).length === 4).length;
  const depth = { four, rows: summary.rows.length };
  if (four < summary.rows.length * DEPTH_MIN)
    return { ok: false, waiting: true, depth,
             why: `عمقُ الفريمات ناقص: ${four} من ${summary.rows.length} صفّاً بأربعة فريمات` +
                  ` (الحدّ ${Math.round(DEPTH_MIN * 100)}%) — «توافق الفريمات» يسقط بلا سبب` };

  /* ══ البوّابة ١: المصدران على شمعةٍ واحدة ══ */
  const confBar = Number(strat.confBar) || 0;
  let maxCbar = 0;
  for (const r of summary.rows) if (Number.isFinite(r.cbar)) maxCbar = Math.max(maxCbar, r.cbar);
  if (!confBar || !maxCbar) return { ok: false, why: "لا ختمَ شمعةٍ في أحد المصدرين" };
  if (confBar !== maxCbar) {
    return { ok: false, why: `المصدران على شمعتين: summary=${iso(maxCbar)} · strategies=${iso(confBar)}`,
             waiting: true };
  }
  const candleKey = confBar;

  const secMed = sectorMedians(summary.rows, F);
  const byS = {};
  for (const r of strat.rows) (byS[r.s] ||= []).push(r);

  /* الحالة السابقة: من اللقطة القائمة. وأوّل تشغيلٍ بلا حالة يبذر من
     سجلّ الإشارات المفتوح (عمرٌ صادق) — مرّةً واحدة، فلا يدخل ملفٌّ
     يتغيّر داخل الشمعة في حسابٍ متكرّر. */
  const prevDoc = rd("opportunities.json");
  const prevLife = (prevDoc && prevDoc.life && (!CRYPTO || prevDoc.lifeV === LIFE_V)) ? prevDoc.life : null;
  const regime = CRYPTO ? ((rd("market.json") || {}).regime || null) : null;
  const ended = [];                    // ما انتهى من الفرص المعروضة في هذه الشمعة
  const seeds = prevLife ? {} : seedFromSignals((rd("signals.json") || {}).records);
  const nowMs = (candleKey + BAR_SEC) * 1000 + 1;    // ساعة الشمعة لا الحائط
  const bars = {};
  const life = {};
  for (const [k, v] of Object.entries(prevLife || {}))
    life[k] = { ...v, t: (v.t || []).slice(), end: v.end ? { ...v.end } : null };
  const seen = new Set();
  const closedRe = [];
  const annotate = (row, scan, sd) => {
    if (!(sd === 1 || sd === -1)) return null;
    const key = lifeKey(row.s, scan.id, sd);
    seen.add(key);
    let L = life[key];
    const B = symBars(row.s, bars, nowMs);
    /* **إعدادٌ قائم بعد انتهاء صفقته يولد فرصةً جديدة** من الشمعة التالية
       لانتهائها. كان المنتهي بهدفٍ أو وقف يبقى محجوباً ما دام شرطُه يُطلق،
       فأخفت إعادةُ تشغيل الجلسات العشر حركاتِ استمرارٍ كاملة: AMD ‎+9.92%‎
       وMU ‎+4.91%‎ وPLTR ‎+3.67%‎ وFSLR ‎−10.36%‎ — كلُّها بشرطٍ يُطلق
       وخطةٍ سابقة «مكتملة». أمّا المنتهي بالقِدَم فلا يُعاد: إعدادٌ عمره
       عشرون شمعةً من فريمه ليس جديداً لأن الساعة تقدّمت. */
    /* و«خرجت لصالح أقوى» (`out`) تعود فرصةً جديدة بعد ساعة إن بقي إعدادُها —
       لا فوراً (وإلا صارت الإزاحة ارتعاشاً باسمٍ آخر) ولا أبداً. */
    if (L && L.end && (L.end.k === "tgt" || L.end.k === "stop" ||
        (CRYPTO && L.end.k === "out" && candleKey - L.end.at >= 3600)) && L.end.at < candleKey) {
      closedRe.push([key, L.end.k]);
      L = null; delete life[key];
    }
    if (!L) {
      const sg = seeds[key];
      const sgSince = sg ? Math.round(sg.at / 1000) : null;
      L = { d: sd, since: candleKey, px0: row.pc, e: null, st: null, t: [], hit: 0, in: 0,
            upto: candleKey, miss: 0, k: candleKey, end: null, mfe: null, mae: null };
      if (sg && sgSince < candleKey && Array.isArray(sg.snap.t)) {
        L.since = sgSince; L.px0 = sg.snap.px ?? sg.entry; L.upto = sgSince;
        L.e = sg.snap.e; L.st = sg.snap.s; L.t = sg.snap.t.slice(); L.seed = 1;
        // ما سبق نافذةَ ‎15د‎ يُقرأ من اليومي المغلق **بعد** يوم الإشارة
        const k15 = B.k["15m"]; const t15 = k15.length ? k15[0].t / 1000 : Infinity;
        walk(L, B.k["1d"].filter(b => b.t / 1000 > L.since && b.t / 1000 < t15));
      } else {
        const snap = B.rec ? buildSnap({ row: { ...row, p: row.pc, __dir: sd, __scan: scan.id },
          sym: row.s, an: B.rec.an, k4h: B.k["4h"], k1d: B.k["1d"],
          f: { w52h: row.w52h, w52l: row.w52l }, at: nowMs }) : null;
        if (snap) { L.e = snap.e; L.st = snap.s; L.t = snap.t.slice(); }
      }
      life[key] = L;
    }
    walk(L, B.k[WALK_TF]);
    if (L.k < candleKey) { L.miss = 0; L.k = candleKey; }
    L.miss = 0;
    const fr = freshness((candleKey - L.since) * 1000, CRYPTO ? C_FRESH_TF : scanTF(scan.id));
    if (!L.end && fr && fr.k === "stale") L.end = { k: "old", at: candleKey };
    if (L.end) {
      // فرصةٌ عُرضت ثم انتهت (هدفٌ أخير · وقف · قِدَم) — تُسجَّل مرّةً
      if (CRYPTO && L.shown && !L.logged) { L.logged = 1; ended.push({ key, ...L }); }
      return { drop: true };
    }
    const mv = Number.isFinite(row.pc) && L.px0 > 0 ? (row.pc / L.px0 - 1) * 100 * sd : null;
    const ba = CRYPTO ? btcAlign(sd, regime) : null;
    let cx = null;
    if (CRYPTO) {
      const a1 = B.rec && B.rec.an && B.rec.an["1h"];
      const ext = (a1 && a1.atr > 0 && Number.isFinite(a1.e20) && Number.isFinite(row.pc)) ? sd * (row.pc - a1.e20) / a1.atr : null;
      const nt = (L.t || [])[L.hit];
      const rr = (Number.isFinite(nt) && Number.isFinite(L.st) && Number.isFinite(row.pc) && (row.pc - L.st) * sd > 0)
        ? (nt - row.pc) * sd / ((row.pc - L.st) * sd) : null;
      cx = { ext: ext == null ? null : Math.round(ext * 100) / 100, rr: rr == null ? null : Math.round(rr * 100) / 100,
             m: extFactor(ext) * roomFactor(rr) * (ba ? btcMult(ba.a) : 1) };
    }
    return {
      mult: (F_FRESH[fr && fr.k] ?? 1) * F_ROOM[Math.min(L.hit, 3)] * (cx ? cx.m : 1),
      f: { since: L.since, px0: L.px0 == null ? null : rp(L.px0), e: L.e, st: L.st, t: L.t,
           hit: L.hit, in: L.in, fk: fr ? fr.k : null, mv: mv == null ? null : Math.round(mv * 100) / 100,
           ...(ba ? { ba: ba.a, bk: ba.k } : {}), ...(cx ? { ext: cx.ext, rr: cx.rr,
             cm: Math.round((F_FRESH[fr && fr.k] ?? 1) * F_ROOM[Math.min(L.hit, 3)] * cx.m * 1e4) / 1e4 } : {}) }
    };
  };

  /* البقاء: إعدادٌ عُرض في شمعةٍ سابقة ولم ينتهِ، وقلبُه (الفريمات الأعلى)
     ما زال على جهته — يُعدّ مُطلِقاً وإن نزل ‎5د‎. `prevLife` حالةُ اللقطة
     السابقة، فالقرار واحدٌ مهما أُعيد البناء داخل الشمعة. */
  const alive = (s, id, d) => { const L = prevLife && prevLife[lifeKey(s, id, d)]; return !!(L && L.shown && !L.end); };
  const SC = !CRYPTO ? SCANS : SCANS.filter(s => C_SETUPS.includes(s.id)).map(s => {
    const core = C_CORE[s.id];
    if (!core) return s;
    const [d, holds] = core;
    return { ...s, test: (r, f, ctx) => {
      if (s.test(r, f, ctx)) return true;
      return alive(r.s, s.id, d) && holds(r);
    } };
  });
  const scans = buildOpps(
    { SCANS: SC, scanRow, forcedDir, resolveOpp, consFromRows, scsFrom, oppQualityOf },
    { rows: summary.rows, wideRows, fund: F, secMed,
      stratByS: byS, stratMeta: STRAT_BY_ID, stratTotal: STRATEGIES.length, edge, annotate });

  /* ما غاب شرطُه في هذه الشمعة: يُعدّ غيابُه مرّةً لكل مفتاح، وبعد
     شمعتين يُنهى ويُحذف، فيعود شرطُه لاحقاً فرصةً جديدةً بعمرٍ جديد.
     والمنتهي (وقف/هدف/قِدَم) **الحاضر** يبقى محجوباً ما دام شرطُه يُطلق —
     وإلا عاد في الشمعة التالية «جديداً» وهو هو. */
  const closedNow = closedRe.slice();
  for (const [k, L] of Object.entries(life)) {
    if (seen.has(k)) continue;
    if (L.k < candleKey) { L.miss = (L.miss || 0) + 1; L.k = candleKey; }
    if (L.miss >= (CRYPTO ? C_MISS : MISS_MAX)) {
      closedNow.push([k, L.end ? L.end.k : "gone"]);
      if (CRYPTO && L.shown && !L.logged) ended.push({ key: k, ...L, end: L.end || { k: "gone", at: candleKey } });
      delete life[k];
    }
  }
  /* ══ الكريبتو: بوّابة الجودة ثم «الأقوى الآن» ══
     المحرّك رتّب كلَّ ما أطلق شرطاً؛ هنا يُبقى ما يستحقّ اسم «فرصة». */
  let best = null;
  if (CRYPTO) {
    /* الدرجة المعروضة تُعاد: وزنُ الإعداد × معامِل جودة الدخول (`cm` من
       دورة الحياة). ثم يُعاد الترتيب بها — والقديمة `q0` محفوظةٌ للتشخيص. */
    for (const id of Object.keys(scans)) {
      for (const r of scans[id]) if (Number.isFinite(r.cm)) r.q = Math.round(setupWeight(r.q0) * r.cm * 1e4) / 1e4;
      scans[id].sort((a, b) => b.q - a.q);
    }
    const pool = [];
    for (const id of Object.keys(scans)) {
      /* المعروضةُ سابقاً تبقى ما دامت حيّة؛ والجديدةُ تمرّ بالبوّابة ثم السقف
         على ما بقي من مقاعده. والترتيب بعدها بالدرجة كما هو. */
      const wasShown = (r) => { const L = life[lifeKey(r.s, id, r.sd)]; return !!(L && L.shown); };
      const planOk = (r) => Number.isFinite(r.e) && Number.isFinite(r.st) && Array.isArray(r.t) && r.t.length;
      /* **العضوية غير الترتيب.** الحيّةُ تبقى في قائمة إعدادها ما دامت حيّة —
         لا تُزاح بسقفٍ ولا برتبة (جُرّبت الإزاحة بأضعف القائمين فصارت ‎227‎
         من ‎263‎ نهايةً «أُزيحت»: الدرجة تتحرّك كل شمعة، فالإزاحةُ ارتعاشٌ
         باسمٍ آخر). والجديدةُ تدخل ببوّابة الجودة حتى سقف ‎40‎ للإعداد.
         والقائمة لا تتشبّع بالقديم لأن الطزاجة على الساعة (قديمةٌ بعد ‎20‎
         ساعة)، و«الأقوى الآن» هي الأعلى ‎15‎ بالدرجة الحالية. */
      const seats = scans[id].filter(r => planOk(r) && wasShown(r));
      const fresh = scans[id].filter(r => planOk(r) && !wasShown(r) && !r.mixed && (r.q0 ?? r.q) >= C_QMIN)
                             .slice(0, Math.max(0, C_CAP - seats.length));
      const pick = new Set([...seats, ...fresh]);
      const kept = scans[id].filter(r => pick.has(r));
      kept.forEach((r, i) => {
        const L = life[lifeKey(r.s, id, r.sd)];
        // أوّلُ ظهور: الرتبة والدرجة وتوافق البيتكوين لحظتَها — للتقرير لا للعرض
        if (L && !L.shown) { L.shown = candleKey; L.q0 = r.q; L.r0 = i + 1; L.ba0 = r.ba ?? null; }
        pool.push({ ...r, scan: id, _i: i });
      });
      scans[id] = kept;
    }
    const seenS = new Set();
    /* التعادل في الدرجة شائع (السقف ‎1‎ × معامِل البيتكوين نفسه)، فيُفصل
       برتبة الصفّ داخل إعداده — وهي رتبةُ القوّة بمقياس الإعداد (النتيجة
       في «توافق الفريمات») — لا بالاسم. */
    best = pool.sort((a, b) => (b.q - a.q) || (a._i - b._i) || (a.s < b.s ? -1 : 1))
               .filter(r => !seenS.has(r.s) && seenS.add(r.s)).slice(0, C_BEST)
               .map(({ _i, ...r }) => r);
    for (let i = 0; i < best.length; i++) {
      const L = life[lifeKey(best[i].s, best[i].scan, best[i].sd)];
      if (L && !L.b0) L.b0 = i + 1;              // أوّلُ رتبةٍ في «الأقوى الآن»
    }
    scans.best = best;
  }

  /* تحليل الخمسين كلّهم — لا من ظهر في قائمةٍ وحده. شاشةُ السهم تقرؤه
     فلا تحسب شيئاً بنفسها، فلا يختلف رقمُها عن رقم القائمة. */
  const bySym = {};
  const listed = CRYPTO ? new Set(["BTC-USD", ...Object.values(scans).flat().map(r => r.s)]) : null;
  for (const r of summary.rows) {
    if (listed && !listed.has(r.s)) continue;
    const c = consFromRows(byS[r.s] || [], STRAT_BY_ID, { total: STRATEGIES.length, edge });
    const sc = scsFrom(c.cons);
    let nAct = 0; for (const x of c.res) if (x.dir && x.active) nAct++;
    bySym[r.s] = {
      score: r.score, band: r.band ?? null, tf: r.tfScore || {}, pc: r.pc ?? null, cbar: r.cbar ?? null,
      n: nAct, scs: sc.scs == null ? null : Math.round(sc.scs * 1e4) / 1e4, cdir: sc.dir, mixed: sc.mixed ? 1 : 0,
      /* صفوف الاستراتيجيات المؤكَّدة بالحقول التي يقرؤها `consFromRows` وحدها —
         شاشة السهم تبني منها إجماعها فلا يختلف عن القائمة */
      rows: (byS[r.s] || []).map(x => ({ st: x.st, dir: x.dir || 0, sc: x.sc ?? null, act: x.act ?? null,
                                         band: x.band ?? null, at: x.at ?? null, px: x.px ?? null }))
    };
  }

  const rowsHash = sha12(snapCanon({ scans, bySym, life }));
  const strategyVersion = logicVersion();
  let count = 0;
  for (const id of Object.keys(scans)) count += scans[id].length;

  return { ok: true, candleKey, rowsHash, strategyVersion, scans, count, life, bySym, closedNow, regime, ended,
           generatedAt: now, confBar, maxCbar, depth,
           edgeReady: !!edgeFile, fundReady: !!Object.keys(F).length,
           wideRows: wideRows.length, liveRows: summary.rows.length };
}

const iso = (sec) => sec ? new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z" : "—";

/* ══ البوّابة ٢+٣: لا كتابة داخل نفس المفتاح إلا بتغيّر نسخة المنطق ══ */
export function decide(next, prev) {
  if (!prev) return { write: true, reason: "أوّل لقطة" };
  if (next.candleKey > prev.candleKey) return { write: true, reason: "تقدّمَ مفتاح الشمعة" };
  if (next.candleKey < prev.candleKey)
    return { write: false, reason: `المفتاح إلى الوراء (${iso(next.candleKey)} < ${iso(prev.candleKey)}) — بياناتٌ أقدم` };
  if (next.rowsHash === prev.rowsHash) return { write: false, reason: "لا تغيّر — نفس البصمة" };
  if (next.strategyVersion !== prev.strategyVersion)
    return { write: true, reason: "تغيّرت نسخة المنطق داخل نفس الشمعة — إعادة بناءٍ مقصودة" };
  /* ولقطةٌ قائمة بُنيت ببياناتٍ منقوصة تُستبدل داخل شمعتها.
     غيابُ `depth` يعني لقطةً من قبل البوّابة ٠، وهي بالتعريف غيرُ
     مُتحقَّقٍ من عمقها — فتُستبدل مرّةً واحدة ثم يحمل خليفتُها الحقل
     فلا يتكرّر. وبلا هذا الاستثناء لا يصل إصلاحُ العمق المستخدمَ قبل
     الشمعة التالية، لأن `strategyVersion` تبصم `stocks/*.js` وحدها
     ولا يغيّرها تعديلٌ في `scripts/`. */
  const pd = prev.sources && prev.sources.depth;
  if (!pd || !pd.rows || pd.four < pd.rows * DEPTH_MIN)
    return { write: true, reason: pd
      ? `اللقطة القائمة منقوصة العمق (${pd.four}/${pd.rows}) — تُستبدل`
      : "اللقطة القائمة بلا عمقٍ مُتحقَّق — تُستبدل مرّةً" };
  return { write: false, reason: `البصمة تغيّرت داخل نفس الشمعة (${prev.rowsHash} → ${next.rowsHash}) — مرفوضة` };
}

function appendLog(entry) {
  const p = path.join(OUT, "opportunities-log.json");
  let log = [];
  try { log = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* أوّل مرّة */ }
  if (!Array.isArray(log)) log = [];
  log.push(entry);
  /* آخر مئتين: تشخيصٌ لا أرشيف — نفس قاعدة `.run.skips.json`. */
  if (log.length > 200) log = log.slice(-200);
  fs.writeFileSync(p, JSON.stringify(log));
}

async function main() {
  const now = Date.now();
  const next = buildSnapshot(now);
  const prev = rd("opportunities.json");

  if (!next.ok) {
    console.log(`  لقطة الفرص: لم تُبنَ — ${next.why}`);
    appendLog({ t: now, action: "skip", why: next.why, wallKey: candleKeyAt(now) });
    /* الانتظار ليس فشلاً: اللقطة السابقة صالحة وتبقى معروضة. */
    return next.waiting ? 0 : (prev ? 0 : 1);
  }

  const d = decide(next, prev);
  appendLog({ t: now, action: d.write ? "write" : "hold", why: d.reason,
              candleKey: next.candleKey, rowsHash: next.rowsHash,
              strategyVersion: next.strategyVersion, count: next.count });

  if (!d.write) {
    /* الرفضُ يحمي المنشور ويُخفي المصدر — فيُحفظ الحسابُ المرفوض محلياً
       كي يُقارَن بالمنشور حقلاً حقلاً ويُسمّى ما تحرّك داخل الشمعة. */
    if (prev && next.candleKey === prev.candleKey && next.rowsHash !== prev.rowsHash) {
      try {
        const dd = path.join(OUT, ".monitor", "rejected");
        fs.mkdirSync(dd, { recursive: true });
        fs.writeFileSync(path.join(dd, `${next.candleKey}-${next.rowsHash}.json`),
          JSON.stringify({ candleKey: next.candleKey, scans: next.scans, bySym: next.bySym, life: next.life }));
        // ومعه صفوف الاستراتيجيات كاملةً ببواباتها — كي يُسمّى المدخل الذي تحرّك
        try { fs.copyFileSync(path.join(OUT, "strategies.json"), path.join(dd, `${next.candleKey}-${next.rowsHash}.strategies.json`)); } catch {}
      } catch { /* تشخيصٌ لا يُسقط التشغيل */ }
    }
    console.log(`  لقطة الفرص: ${d.reason} · شمعة ${iso(next.candleKey)} · ${next.count} صفّاً`);
    return 0;
  }

  const doc = {
    generatedAt: next.generatedAt,
    candleKey: next.candleKey,
    candleKeyIso: iso(next.candleKey),
    strategyVersion: next.strategyVersion,
    rowsHash: next.rowsHash,
    count: next.count,
    sources: { confBar: next.confBar, maxCbar: next.maxCbar,
               liveRows: next.liveRows, wideRows: next.wideRows,
               edge: next.edgeReady, fund: next.fundReady,
               /* العمق يُحفظ كي تعرف `decide` أن اللقطة القائمة بُنيت
                  ببياناتٍ كاملة — لا لتُعرض */
               depth: next.depth },
    scans: next.scans,
    bySym: next.bySym,
    life: next.life,
    closedNow: next.closedNow,
    ...(CRYPTO ? { book: "crypto", lifeV: LIFE_V, barSec: BAR_SEC, regime: next.regime,
                   setups: C_SETUPS, gate: { qmin: C_QMIN, top: C_TOP, best: C_BEST, btcW: BTC_W } } : {})
  };
  /* كتابةٌ ذرّية: ملفٌّ مؤقّت ثم إعادة تسمية. الكتابة المباشرة تترك
     نافذةً يقرأ فيها المتصفّح نصف ملفّ. */
  const tmp = path.join(OUT, ".opportunities.tmp.json");
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, path.join(OUT, "opportunities.json"));
  if (CRYPTO) cryptoArchive(next);
  console.log(`  لقطة الفرص: كُتبت — ${d.reason} · شمعة ${iso(next.candleKey)} · ${next.count} صفّاً · بصمة ${next.rowsHash}`);
  return 0;
}

/* سجلُّ المنتهية وأرشيفُ اللقطات — **بعد** الكتابة وحدها: لقطةٌ مرفوضة لم
   يرها أحد فلا تُسجَّل. والسجلّ مفتاحُه `رمز|إعداد|جهة|بدء` فإعادةُ
   البناء لا تكرّره. */
function cryptoArchive(next) {
  try {
    const hp = path.join(OUT, "opp-history.json");
    let H = [];
    try { H = JSON.parse(fs.readFileSync(hp, "utf8")).rows || []; } catch { /* أوّل مرّة */ }
    const have = new Set(H.map(h => h.id));
    for (const L of next.ended || []) {
      const [s, scan, d] = L.key.split("|");
      const id = `${L.key}|${L.since}`;
      if (have.has(id)) continue;
      H.push({ id, s, scan, d: +d, since: L.since, shown: L.shown, px0: L.px0, e: L.e, st: L.st, t: L.t,
               hit: L.hit, in: L.in, end: L.end, mfe: L.mfe, mae: L.mae,
               q0: L.q0 ?? null, r0: L.r0 ?? null, b0: L.b0 ?? null, ba0: L.ba0 ?? null });
    }
    H = H.slice(-3000);
    fs.writeFileSync(hp + ".tmp", JSON.stringify({ updated: next.generatedAt, rows: H }));
    fs.renameSync(hp + ".tmp", hp);
    const sd = path.join(OUT, ".monitor", "snaps");
    fs.mkdirSync(sd, { recursive: true });
    const slim = (r) => ({ s: r.s, scan: r.scan, sd: r.sd, q: r.q, pc: r.pc, e: r.e, st: r.st, t: r.t, hit: r.hit, ba: r.ba ?? null });
    const all = {};
    for (const [id, rows] of Object.entries(next.scans)) if (id !== "best") all[id] = rows.map(slim);
    fs.writeFileSync(path.join(sd, `${next.candleKey}.json`), JSON.stringify({
      k: next.candleKey, h: next.rowsHash, regime: next.regime,
      best: (next.scans.best || []).map(slim), scans: all }));
    const old = fs.readdirSync(sd).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 1500))) fs.unlinkSync(path.join(sd, f));
  } catch (e) { console.warn(`  ⚠ أرشيف الكريبتو: ${e.message}`); }
}

/* ══ الفحص الذاتي — بلا شبكة ══ */
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (m, d) => { pass++; console.log(`  ✓ ${m}${d ? " — " + d : ""}`); };
  const no = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? " — " + d : ""}`); };

  const K = 1789000000, H = "aaaaaaaaaaaa", V = "vvvvvvvvvvvv";
  /* المُثبِّت يحمل عمقاً **سليماً** لأن اللقطة القائمة في الإنتاج
     تحمله: بلا ذلك تمرّ كلُّ حالةٍ عبر استثناء «منقوصة تُستبدل»
     فيبدو أن البوّابة ٢ لا تعمل. */
  const deep = { sources: { depth: { four: 100, rows: 100 } } };
  const base = { candleKey: K, rowsHash: H, strategyVersion: V, ...deep };

  decide({ ...base }, null).write ? ok("أوّل لقطة تُكتب") : no("أوّل لقطة تُكتب");

  decide({ ...base }, { ...base }).write
    ? no("لا كتابة بلا تغيّر") : ok("لا كتابة بلا تغيّر");

  const changed = { ...base, rowsHash: "bbbbbbbbbbbb" };
  !decide(changed, { ...base }).write
    ? ok("البصمة تتغيّر داخل نفس الشمعة ⇒ **مرفوضة**", decide(changed, { ...base }).reason)
    : no("البصمة تتغيّر داخل نفس الشمعة ⇒ مرفوضة");

  decide({ ...changed, candleKey: K + 900 }, { ...base }).write
    ? ok("تقدّمُ المفتاح يسمح بالكتابة") : no("تقدّمُ المفتاح يسمح بالكتابة");

  decide({ ...changed, strategyVersion: "wwwwwwwwwwww" }, { ...base }).write
    ? ok("تغيّرُ نسخة المنطق يسمح داخل نفس الشمعة") : no("تغيّرُ نسخة المنطق يسمح داخل نفس الشمعة");

  !decide({ ...changed, candleKey: K - 900 }, { ...base }).write
    ? ok("مفتاحٌ إلى الوراء مرفوض — لا تُداس لقطةٌ أحدث") : no("مفتاحٌ إلى الوراء مرفوض");

  /* ══ البوّابة ٠: العمق ══ */
  {
    const changed = { ...base, rowsHash: "bbbbbbbbbbbb" };
    /* لقطةٌ قائمة منقوصة العمق تُستبدل داخل شمعتها — وإلا لم يصل
       إصلاحُ العمق المستخدمَ قبل الشمعة التالية */
    const shallow = { ...base, sources: { depth: { four: 10, rows: 100 } } };
    decide(changed, shallow).write
      ? ok("لقطةٌ منقوصة العمق تُستبدل داخل شمعتها", decide(changed, shallow).reason)
      : no("لقطةٌ منقوصة العمق تُستبدل داخل شمعتها");

    /* وغيابُ الحقل لقطةٌ من قبل البوّابة — تُستبدل مرّةً لا دائماً:
       خليفتُها تحمله فتعود البوّابة ٢ إلى عملها */
    const old = { candleKey: K, rowsHash: H, strategyVersion: V };
    decide(changed, old).write && !decide(changed, { ...changed, ...deep }).write
      ? ok("غيابُ العمق يسمح باستبدالٍ واحد ثم يتوقّف")
      : no("غيابُ العمق يسمح باستبدالٍ واحد ثم يتوقّف");

    /* والعمق السليم لا يفتح الباب: البصمة المتغيّرة تبقى مرفوضة */
    !decide(changed, base).write
      ? ok("وعمقٌ سليم يُبقي البصمة المتغيّرة مرفوضة")
      : no("وعمقٌ سليم يُبقي البصمة المتغيّرة مرفوضة");

    /* والحدّ نسبيّ: صفٌّ أو صفّان بفريمٍ واحد لا يُسقطان اللقطة */
    const okDepth = { four: 98, rows: 100 }, badDepth = { four: 60, rows: 100 };
    okDepth.four >= 100 * DEPTH_MIN && badDepth.four < 100 * DEPTH_MIN
      ? ok(`الحدّ نسبيّ لا مطلق — ${Math.round(DEPTH_MIN * 100)}%`)
      : no("الحدّ نسبيّ لا مطلق");
  }

  /* مفتاح الشمعة يتقدّم عند الأرباع وحدها */
  const t0 = Date.UTC(2026, 8, 20, 23, 45, 0);
  const keys = [0, 1, 5, 13, 14.9, 15, 16, 29, 30].map(m => candleKeyAt(t0 + m * 60000));
  const uniq = [...new Set(keys)];
  uniq.length === 3 && keys[0] === keys[4] && keys[5] !== keys[4]
    ? ok("مفتاح الشمعة يتقدّم عند الأرباع وحدها", uniq.map(iso).join(" · "))
    : no("مفتاح الشمعة يتقدّم عند الأرباع وحدها", keys.join(","));

  /* البصمة لا تتأثّر بالسعر ولا بنسبة التغيّر */
  const mk = (p, c) => ({ a: [{ s: "X", q: 1, adj: 0, scs: null, cdir: 0, mixed: 0, n: 0, sd: null, v: "v", cbar: 1, ctf: "15m", p, chg: c }] });
  oppsCanon(mk(10, 1)) === oppsCanon(mk(99, -7))
    ? ok("البصمة لا تشمل السعر ولا نسبة التغيّر")
    : no("البصمة لا تشمل السعر ولا نسبة التغيّر");

  /* ...لكنها تشمل الترتيب */
  const two = (a, b) => ({ a: [a, b].map((s, i) => ({ s, q: 1 - i * .1, adj: 0, scs: null, cdir: 0, mixed: 0, n: 0, sd: null, v: "", cbar: 1, ctf: "15m" })) });
  oppsCanon(two("A", "B")) !== oppsCanon(two("B", "A"))
    ? ok("البصمة تشمل الترتيب — لا فحصٌ زائف") : no("البصمة تشمل الترتيب");

  /* وتشمل العضوية */
  const one = { a: [{ s: "A", q: 1, adj: 0, scs: null, cdir: 0, mixed: 0, n: 0, sd: null, v: "", cbar: 1, ctf: "15m" }] };
  oppsCanon(one) !== oppsCanon(two("A", "B"))
    ? ok("البصمة تشمل العضوية") : no("البصمة تشمل العضوية");

  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
  return fail ? 1 : 0;
}

if (IS_MAIN) {
  if (process.argv.includes("--check")) {
    console.log("\n▶ فحص بوّابة لقطة الفرص (بلا شبكة)\n");
    process.exit(selfTest());
  } else {
    process.exit(await main());
  }
}
