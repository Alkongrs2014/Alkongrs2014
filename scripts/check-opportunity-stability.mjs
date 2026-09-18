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
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, "stocks/strategies.js"));

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
function flatCandles(n = 30, base = 100, noise = 0.05, t0 = 1_700_000_000_000, step = 900000) {
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
     المستعمل في `lastClosedPx` نفسها وفي `donch`/`volRatio`)، فشمعة
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

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
process.exit(fail ? 1 : 0);
