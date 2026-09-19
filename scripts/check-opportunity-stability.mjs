#!/usr/bin/env node
/* =====================================================================
   فحص ثبات الفرص — CONFIRMED مقابل LIVE، وإثباتُ صفر مساهمة للفريمات
   الممنوعة. بلا شبكة.

   السياق: فرصةٌ كانت تظهر «صعود 90%» ثم تنقلب «هبوط 90%» خلال دقائق
   بلا إغلاق شمعة. السبب المقيس: `side()` وبوابات `kind:"price"` في
   `stocks/strategies.js` تُعاد حسابها كل دقيقتين بالسعر اللحظي مقابل
   مستوىً من شمعةٍ مغلقة، بلا أيّ هيستريسس على الاتجاه نفسه — فحركةٌ
   صغيرة عند حافّة المستوى تقلب `dir`.

   الحلّ المفحوص هنا: `confirmCtx`/`evalAllConfirmed` تُقيّمان الاستراتيجية
   بسعر إغلاق آخر شمعةٍ **مغلقة** لفريمها، لا السعر اللحظي — فهذا الملفّ
   يثبت أن ذلك يعمل فعلاً: لا يتغيّر CONFIRMED إلا حين تتغيّر الشمعة
   المغلقة نفسها، بصرف النظر عن أي سعرٍ لحظي.

   وهذا الفحص لا يعيد اختبار «لا فريم دون ١٥د» — ذاك مفحوصٌ فعلاً في
   `check-strategies.mjs` و`market-direction.mjs --check`. هنا إثباتٌ
   إضافي مبنيٌّ على البيانات الفعلية لا على قائمةٍ مكتوبة (`forbiddenTfUsage`).
   ===================================================================== */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, "stocks/strategies.js"));
const P = require(path.join(ROOT, "stocks/plan.js"));
const IND = require(path.join(ROOT, "stocks/indicators.js"));
const SC = require(path.join(ROOT, "stocks/score.js"));
const { sessionOf, currentWindow } = await import(
  new URL("./lib/session.mjs", import.meta.url).href);

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name} — ${e.message}`); fail++; }
};
const eq = (a, b, m) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m}: ${x} ≠ ${y}`);
};
const ok = (c, m) => { if (!c) throw new Error(m); };

/* =====================================================================
   سياقٌ مُصطنع: ٣٠ شمعةً مسطَّحة قرب ‎100‎ على ‎15د‎ — نطاق دونشيان
   المشتق منها (باستثناء آخر شمعتين، كما يفعل `donch`) ضيّقٌ ومعروف.
   ===================================================================== */
/* المرساة ربعُ الساعة **الجاري** لا ختمٌ ثابت في 2023: «الشمعة
   الجارية» صفةٌ زمنية لا موضعٌ في مصفوفة (انظر `closedBars`)، وسلسلةٌ
   كلُّها في الماضي آخرُها **مغلقة** — فاختبارٌ يفترض أن الأخيرة تُحذف
   دائماً يقيس افتراضه لا الشيفرة. */
function flatCandles(n = 30, base = 100, noise = 0.05,
                     t0 = Math.floor(Date.now() / 900000) * 900000 - 29 * 900000,
                     step = 900000) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = base + (i % 2 === 0 ? noise : -noise);
    out.push({ t: t0 + i * step, o: c, h: c + noise, l: c - noise, c, v: 100000 });
  }
  return out;
}

function ctxFor(k15, livePx, extraTf = {}) {
  const rec = { s: "TEST", mkt: "us", an: { "15m": { atr: 0.2, score: 0 } },
                tf: { "15m": { c: k15 }, ...extraTf } };
  const row = { s: "TEST", p: livePx };
  return S.buildCtx({ rec, row, now: Date.now(), px: livePx, sess: "REGULAR" });
}

console.log("\n▶ فحص ثبات الفرص — CONFIRMED مقابل LIVE (بلا شبكة)\n");

/* =====================================================================
   ١) CONFIRMED لا يتغيّر بتذبذب السعر اللحظي — والLIVE يتغيّر
   ===================================================================== */
t("CONFIRMED ثابتٌ أمام تذبذب السعر اللحظي، وLIVE يتبعه", () => {
  const brk = S.STRAT_BY_ID.brk;
  ok(brk, "استراتيجية brk موجودة");
  const k = flatCandles();               // نطاقٌ ضيّق حول 100

  // سعرٌ لحظي فوق النطاق بكثير — LIVE يجب أن يكسر صعوداً
  const cHigh = ctxFor(k, 200);
  const rLiveHigh = S.evalStrategy(brk, cHigh, {});
  eq(rLiveHigh.dir, 1, "LIVE يرى اختراقاً صعودياً بسعرٍ 200");

  // نفس السياق تماماً — لكن CONFIRMED يستبدل السعر بإغلاق آخر شمعةٍ
  // مغلقة (قرب 100، داخل النطاق) فلا يرى اختراقاً
  const rConfHigh = S.evalStrategy(brk, S.confirmCtx(brk, cHigh), {});
  ok(rConfHigh.dir !== 1, "CONFIRMED لا يتأثّر بسعرٍ لحظيٍّ خارج الشمعة المغلقة");

  // وسعرٌ لحظي آخر تماماً (تحت النطاق) — LIVE ينقلب، وCONFIRMED كما هو
  const cLow = ctxFor(k, 10);
  const rLiveLow = S.evalStrategy(brk, cLow, {});
  eq(rLiveLow.dir, -1, "LIVE يرى اختراقاً هبوطياً بسعرٍ 10");
  const rConfLow = S.evalStrategy(brk, S.confirmCtx(brk, cLow), {});
  eq(rConfLow.dir, rConfHigh.dir, "CONFIRMED نفسه بصرف النظر عن أيّ سعرٍ لحظي مختلف");
});

/* =====================================================================
   ٢) CONFIRMED يتغيّر فعلاً حين تُغلَق شمعةٌ جديدة — لا يبقى مجمَّداً
   ===================================================================== */
t("CONFIRMED يتحرّك حين تتغيّر الشمعة المغلقة فعلاً", () => {
  const brk = S.STRAT_BY_ID.brk;
  const kFlat = flatCandles();
  const c1 = S.confirmCtx(brk, ctxFor(kFlat, 100));
  const r1 = S.evalStrategy(brk, c1, {});
  ok(r1.dir !== 1, "قبل: لا اختراق — الشمعة المغلقة داخل النطاق");

  /* آخر عنصرٍ في المصفوفة قد يكون جارياً لا مغلقاً (اصطلاح `k[length-2]`
     المستعمل في `donch`/`volRatio`/`follow`)، فشمعة
     الاختراق يجب أن تصير **ما قبل الأخيرة** لا الأخيرة — تُضاف شمعتان:
     الاختراقُ ثم أخرى بعده كي يستقرّ الاختراق «مغلقاً». */
  const t0 = kFlat[kFlat.length - 1].t;
  const kBreak = kFlat.concat([
    { t: t0 + 900000, o: 200, h: 201, l: 199, c: 200, v: 100000 },
    { t: t0 + 1800000, o: 200, h: 201, l: 199, c: 200, v: 100000 }
  ]);
  const c2 = S.confirmCtx(brk, ctxFor(kBreak, 100));   // السعر اللحظي لم يتغيّر هذه المرّة
  const r2 = S.evalStrategy(brk, c2, {});
  eq(r2.dir, 1, "بعد إغلاق شمعة اختراقٍ فعلية: CONFIRMED يتحوّل صعوداً");
});

/* =====================================================================
   ٢ب) `confirmCtx` بلا سعر إغلاقٍ موثوق يُعلَن `off` — لا رجوعٌ صامتٌ
   للسعر اللحظي (الخلل المُصلَح: كان يُعيد السياق كما هو فتُقيَّم
   البوابات على `c.px` اللحظي بعنوان CONFIRMED).
   ===================================================================== */
t("confirmCtx: سلسلةٌ موجودةٌ بلا إغلاقٍ موثوق تُعلَن `off` لا تتراجع صامتاً", () => {
  /* الخلل المُصلَح: كان يُعاد السياق كما هو فتُقيَّم البوابات على
     `c.px` اللحظي بعنوان CONFIRMED. وسلسلةٌ بإغلاقٍ غير رقميّ هي
     الحالة التي تُسقط الإغلاق المؤكَّد إلى `null`. */
  const brk = S.STRAT_BY_ID.brk;
  const k = flatCandles();
  k[k.length - 2].c = null;                 // آخر شمعةٍ مغلقة بلا إغلاق
  const cc = S.confirmCtx(brk, ctxFor(k, 150));
  ok(cc._unconfirmed, "confirmCtx تُعلن تعذّر التأكيد بدل التراجع الصامت");
  const r = S.evalStrategy(brk, cc, {});
  eq(r.dir, 0, "لا اتجاهٌ من تقييمٍ غير موثوق");
  eq(r.off, S.UNCONFIRMED, "سبب الإيقاف هو تعذّر التأكيد بالذات، لا سببٌ آخر");
});

/* =====================================================================
   ٢ج) **فريمٌ غائبٌ ليس تأكيداً متعذّراً.**

   رمزُ الطبقة الواسعة بلا سلسلةٍ ساعيّة، فـ«متعذّر التأكيد» عنه عذرٌ
   مخترَع عن حالةٍ معروفة — و`ready` تقولها بدقّة. وهذا فرقُ «لم نستطع
   التأكيد» عن «لا فريم أصلاً»، وخلطُهما يجعل الرمز السليم يبدو معطلاً.
   ===================================================================== */
t("فريمٌ غائبٌ يقول سببه الحقيقي لا «تعذّر التأكيد»", () => {
  const momo = S.STRAT_BY_ID.momo;           // فريمُها الساعة، وctxFor تملأ ١٥د
  const cc = S.confirmCtx(momo, ctxFor(flatCandles(), 150));
  ok(!cc._unconfirmed, "غيابُ الفريم ليس تعذّرَ تأكيد");
  const r = S.evalStrategy(momo, cc, {});
  eq(r.dir, 0, "ولا اتجاه منها على كل حال");
  ok(r.off !== S.UNCONFIRMED, `السبب المعلَن هو الحقيقي: ${r.off || "(بلا)"}`);
});

/* =====================================================================
   ٣) الحتمية — نفس المدخلات تعطي نفس المخرجات دائماً
   ===================================================================== */
t("نفس المدخلات تعطي نفس المخرجات — عشر مرّات متتالية", () => {
  const k = flatCandles();
  const c = ctxFor(k, 150);
  const first = JSON.stringify(S.evalAllConfirmed(c));
  for (let i = 0; i < 10; i++) eq(S.evalAllConfirmed(c), JSON.parse(first), `تكرار ${i + 1}`);
});

/* =====================================================================
   ٤) إثباتٌ من البيانات لا من نصّ: صفر مساهمة للفريمات الممنوعة
   ===================================================================== */
t("forbiddenTfUsage يعيد صفراً على سياقٍ سليم (١٥د فقط)", () => {
  const c = ctxFor(flatCandles(), 100);
  eq(S.forbiddenTfUsage(c), {}, "لا فريم ممنوع في سياقٍ ببيانات ١٥د وحدها");
});

t("forbiddenTfUsage يكتشف فعلاً فريماً ممنوعاً لو تسرّب — لا فحصٌ زائف", () => {
  // إثباتٌ أن الكاشف ليس دائم النجاح: حَقنُ فريمٍ ممنوع في البيانات
  // نفسها يجب أن يُقرأ فوراً، وإلا كان الفحص يمرّ مهما كانت المدخلات
  const c = ctxFor(flatCandles(), 100, { "5m": { c: flatCandles(10) } });
  const forb = S.forbiddenTfUsage(c);
  ok(forb["5m"] > 0, "٥د المحقونة اصطناعياً تظهر في الإثبات");
});

t("الفريمات المسموحة أربعة بالضبط في `confirmCtx`/`evalAllConfirmed`", () => {
  eq(S.ALLOWED_TFS.slice().sort(), ["15m", "1h", "1d", "4h"].sort(), "١٥د · ١س · ٤س · يوميّ فقط");
});

/* =====================================================================
   ٥) الاستراتيجيات العشر جميعها CONFIRMED محسوبةٌ بلا استثناء يُسقِط أخرى
   ===================================================================== */
t("evalAllConfirmed يعيد العشرة دائماً — لا استثناءٌ يُسقط الباقي", () => {
  const c = ctxFor(flatCandles(), 100);
  const res = S.evalAllConfirmed(c);
  eq(res.length, S.STRATEGIES.length, "عشر استراتيجيات في المخرَج");
  ok(res.every(r => r && typeof r === "object"), "كلٌّ كائنٌ صالح ولو `off`");
});

/* =====================================================================
   ٦) **قاعدة الربع ساعة — اختبار القبول.**

   بلّغ مستخدم عن `VLO` و`TMO`: «متعارضة» ثم «توافق ٣» بعد ستّ دقائق،
   ولم يقع في الفارق إغلاقُ شمعة ١٥د ولا ما فوقها. وهذا يعني — إن صحّ —
   أن الحساب يجري على شيءٍ أسرع من الفريمات المعلنة.

   والقياس أعطى السبب: CONFIRMED كانت تستبدل **السعر وحده**، والسياق
   يحمل طبقةً مشتقّةً كاملة تتحرّك أسرع من الشمعة — `lv.L` تُقسَّم
   بالسعر اللحظي، و`an` تُحسب خادمياً على السلسلة **بما فيها الشمعة
   الجارية** فتتغيّر كل دورة سوق وسط ربع الساعة.

   فهذا الاختبار يصوغ القاعدة المطلوبة صياغةً قابلةً للتنفيذ:

     **تقييمُ CONFIRMED دالّةٌ في الشمعات المغلقة وحدها.** تشويهُ الشمعة
     الجارية (فتحاً وأعلى وأدنى وإغلاقاً وحجماً) وتحريكُ السعر اللحظي
     وتحريكُ الساعة داخل نفس ربع الساعة — لا شيء منها يغيّر المخرَج
     بحرف. ولا يتغيّر إلا حين تُغلَق شمعةٌ جديدة فعلاً (مفحوصٌ في ٢).

   ويُحاكى مسار الخادم كاملاً: `fetch-market` يعيد حساب `an` من السلسلة
   في كل دورة، فتشويهُ الشمعات بلا إعادة حساب المؤشّرات يقيس نصف
   المشكلة — وهو ما كان يُخفي التسرّب الأكبر (٤٧٤ انقلاب اتجاه).
   ===================================================================== */
const DATA = path.join(ROOT, "data");
const rdj = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

/* مؤشّراتٌ معادةٌ من السلسلة — نفس ما يفعله `fetch-market` كل دورة،
   و**على الشمعات المغلقة وحدها** كما صار يفعل. و`legacy` يعيد سلوكه
   السابق (السلسلة كاملةً بشمعتها الجارية) كي يبقى للمقارنة معنى:
   نظامان متكاملان يُقارَنان، لا نصفُ نظامٍ بنصف آخر. */
function reAnalyze(box, now, legacy) {
  const o = {};
  for (const tf in (box || {})) {
    const k = P.unpackK(box[tf].c);
    const a = IND.analyze(legacy ? k : IND.closedBars(k, tf, now));
    if (!a) continue;
    delete a.series;
    o[tf] = a;
  }
  return o;
}

/* دورةُ خادمٍ أخرى بعد دقائق: الشمعة **الجارية** تحرّكت، والمؤشّرات
   أُعيدت.

   والتحريك يقع على الجارية وحدها لا على الأخيرة مطلقاً: شمعةٌ **مغلقة**
   لا يعيد المصدر كتابتها، وتشويهُها محاكاةُ فسادِ بياناتٍ لا محاكاةُ
   دورة. وهذا التمييز ماديٌّ لا يخصّ نظاماً دون آخر، فيُطبَّق على
   المسارين معاً — وإلا صار الاختبار يقارن مدخلَين مختلفَين ويسمّي
   الفرقَ أثراً للشيفرة. */
function nextCycle(rec, f, now) {
  const r = JSON.parse(JSON.stringify(rec));
  for (const box of [r.tf, r.tfx]) {
    for (const tf in (box || {})) {
      const c = box[tf] && box[tf].c;
      if (!c || c.length < 2) continue;
      const b = c[c.length - 1];
      if (!Array.isArray(b)) continue;
      if (!IND.isLiveBar(tf, IND.barTime(b), now)) continue;
      const base = b[4];
      b[1] = base * f; b[2] = base * f * 1.03; b[3] = base * f * 0.97; b[4] = base * f;
      b[5] = Math.round((b[5] || 1000) * (1 + Math.abs(f - 1) * 40));
    }
  }
  return r;
}

/* تقييمُ رمزٍ كاملاً — و`legacy` يعيد سلوك ما قبل الإصلاح (استبدالُ
   السعر وحده) كي يُثبَت أن الاختبار ليس دائم النجاح. */
function evalSym(rec, row, px, now, legacy) {
  const mkt = rec.mkt || row.mkt || null;
  rec.an = reAnalyze(rec.tf, now, legacy);
  if (rec.tfx) rec.anx = reAnalyze(rec.tfx, now, legacy);
  /* وصفُّ الملخّص يُعاد بناؤه كذلك — `buildCtx` يقرأ منه `tfScore`
     و`w52h/l`، وتثبيتُه يدوياً يخفي أيَّ تسرّبٍ يمرّ عبره. وهي نفس
     المصيدة الموثّقة: محاكاةٌ ناقصة لمسار الخادم تقيس نصف العلّة. */
  row = Object.assign({}, row, {
    score: SC.overallScore(rec.an),
    tfScore: Object.fromEntries(SC.TFS.filter(x => rec.an[x])
                                      .map(x => [x, +rec.an[x].score.toFixed(1)]))
  });
  const c = S.buildCtx({ rec, row, now, px, sess: sessionOf(now, mkt),
                         win: currentWindow(now, mkt), sessOf: (t) => sessionOf(t, mkt) });
  const list = legacy
    ? S.STRATEGIES.map((st) => {
        const tf = st.tfOf ? st.tfOf(c) : st.tf;
        const arr = (c.ik && c.ik[tf]) || c.k[tf];
        const b = (arr && arr.length > 1) ? arr[arr.length - 2] : null;
        const cc = (b && Number.isFinite(b.c)) ? Object.assign({}, c, { px: b.c })
                                               : Object.assign({}, c, { _unconfirmed: S.UNCONFIRMED });
        return S.evalStrategy(st, cc, {});
      })
    : S.evalAllConfirmed(c);
  const out = {};
  for (const r of list) out[r.id] = [r.dir || 0, r.sc ?? null, r.off || null, !!r.active];
  return out;
}

/* مسحُ الكون الحيّ ذهاباً وإياباً — يعيد عدد الاختلافات.

   **والساعة تُرسى على البيانات لا على ساعة الحائط.** الاختبار يدّعي
   «داخل نفس ربع الساعة»، فلا بدّ أن تقع خطواته كلُّها داخل ربعٍ واحد
   فعلاً: `Date.now()` عشوائيٌّ بالنسبة إلى الشبكة، فقفزةُ تسع دقائق
   منه تعبر حدَّ شمعةٍ في أغلب الأحيان — فيُقرأ **إغلاقُ شمعةٍ صحيح**
   خللاً في الثبات. والمرساة هي لحظةُ كتابة الملفّات: عندها كانت
   الشمعات الجارية جاريةً فعلاً، فالمحاكاة تصف دورةَ خادمٍ وقعت حقاً. */
function sweep(legacy) {
  const sum = rdj(path.join(DATA, "summary.json"));
  if (!sum || !Array.isArray(sum.rows)) return null;      // لا بيانات محليّة
  const anchor = Number.isFinite(sum.updated) ? sum.updated : Date.now();
  const q0 = Math.floor(anchor / 9e5) * 9e5;              // بداية ربع الساعة
  const now = q0 + 60e3;
  let syms = 0, diff = 0, dirs = 0, acts = 0;
  const ex = [];
  for (const row of sum.rows) {
    if (!(row.p > 0)) continue;
    const rec = rdj(path.join(DATA, "sym", row.s + ".json"));
    if (!rec || !rec.tf) continue;
    syms++;
    const a = evalSym(nextCycle(rec, 1, now), row, row.p, now, legacy);
    /* ثلاث دوراتٍ لاحقة داخل **نفس** ربع الساعة: السعر يتحرّك،
       والشمعة الجارية تتحرّك، والساعة تتقدّم دقيقتين ثم خمساً ثم ثلاث
       عشرة — وكلُّها دون ‎900‎ ثانية من مطلع الربع فلا تعبر حدَّه. */
    const steps = [[1.006, 180e3], [0.994, 420e3], [1.02, 840e3]];
    for (const [f, dt] of steps) {
      const b = evalSym(nextCycle(rec, f, q0 + dt), Object.assign({}, row, { p: row.p * f }),
                        row.p * f, q0 + dt, legacy);
      for (const id in a) {
        if (JSON.stringify(a[id]) === JSON.stringify(b[id])) continue;
        diff++;
        if (a[id][0] !== b[id][0]) dirs++;
        else if (a[id][3] !== b[id][3]) acts++;
        if (ex.length < 4) ex.push(`${row.s} ${id}: ${JSON.stringify(a[id])} ← ${JSON.stringify(b[id])}`);
      }
    }
  }
  return { syms, diff, dirs, acts, ex };
}

t("قاعدة الربع ساعة: CONFIRMED لا يتغيّر بحرفٍ داخل الشمعة — على الكون الحيّ", () => {
  const r = sweep(false);
  if (!r) { console.log("      (لا `data/summary.json` محلياً — تُخطّى)"); return; }
  ok(r.syms >= 50, `عيّنةٌ ذات معنى: ${r.syms} رمزاً`);
  ok(r.diff === 0,
     `${r.diff} اختلافاً داخل نفس ربع الساعة (اتجاه ${r.dirs} · تفعيل ${r.acts})` +
     (r.ex.length ? ` — مثال: ${r.ex[0]}` : ""));
  console.log(`      (${r.syms} رمزاً × ٣ دوراتٍ داخل الشمعة · صفر اختلاف)`);
});

t("والاختبار ليس دائم النجاح: سلوكُ ما قبل الإصلاح يُسقطه", () => {
  /* **فحصٌ يمرّ مهما كانت المدخلات ليس فحصاً.** فيُعاد هنا سلوكُ
     `confirmCtx` القديم حرفياً (استبدالُ `c.px` وحده) ويُشترط أن
     يُرصد الخلل — وإلا كان النجاح أعلاه بلا دلالة. */
  const r = sweep(true);
  if (!r) { console.log("      (لا بيانات محليّة — تُخطّى)"); return; }
  ok(r.diff > 0, "السلوك القديم يجب أن يُرصد مختلفاً");
  ok(r.dirs > 0, "ومنه انقلابُ اتجاهٍ فعليّ لا فرقُ نتيجةٍ فقط");
  console.log(`      (القديم: ${r.diff} اختلافاً · ${r.dirs} انقلاب اتجاه · ${r.acts} تبدّل تفعيل)`);
});

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
process.exit(fail ? 1 : 0);
