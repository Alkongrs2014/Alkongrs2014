/* =====================================================================
   فحص وحدة الاتجاه — اختبار القبول.

   يمرّ على الكون الحيّ ويُثبت أن الفرصة والخطة والمستويات والأهداف
   والقراءة الفنية تُبنى كلُّها من **قرارٍ واحد**، وأنه لا يمكن أن تظهر
   فرصة صاعدة بأهدافٍ هابطة ولا العكس.

   ولماذا فحصٌ على البيانات لا اختبارُ وحدة: العلّة التي بلّغ عنها
   المستخدم (AVGO «صعود» فوق أربعة فريماتٍ هابطة ونتيجة ‎−68.8‎) كانت
   تمرّ من كلّ اختبارات الوحدة — لأن كلّ دالّة على حدة صحيحة، والخلل
   في **تركيبها**: `oppDirOf` تأخذ أوّل اتجاهٍ مفروض بلا أن تسأل هل
   يعارضه اتجاهٌ راسخ.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SCANS, forcedDir } = require("../stocks/scans.js");
const { resolveOpp, baseDirOf, conflictOf } = require("../stocks/direction.js");
const { levelsFrom, planFrom, validatePlan } = require("../stocks/plan.js");
const { TFS, TF_WEIGHT } = require("../stocks/score.js");

const OUT = process.env.OUT_DIR || "data";
const rd = (p, d = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(OUT, p), "utf8")); } catch { return d; }
};

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { const m = fn(); console.log(`  ✓ ${name}${m ? " — " + m : ""}`); pass++; }
  catch (e) { console.log(`  ✗ ${name} — ${e.message}`); fail++; }
};
const must = (c, m) => { if (!c) throw new Error(m); };

console.log("▶ فحص وحدة الاتجاه\n");

const sum = rd("summary.json");
const F = (rd("fundamentals.json", {}) || {}).f || {};
const rows = (sum && sum.rows) || [];
if (!rows.length) console.log("  ⚠ لا summary.json — الفحص البنيوي وحده\n");

/* وسائط القطاعات — `cheap` وحده يقرؤها، وتمريرُها فارغةً يجعله لا
   يُطلق أبداً بلا خطأ ولا استثناء: مصيدة `{ secMed: {} }` الموثّقة. */
const bySec = {};
for (const r of rows) {
  const g = F[r.s];
  if (!g || !r.sec) continue;
  (bySec[r.sec] ||= []).push(g.pe);
}
const secMed = {};
for (const [k, v] of Object.entries(bySec)) {
  const a = v.filter(Number.isFinite).sort((x, y) => x - y);
  if (a.length) secMed[k] = a[a.length >> 1];
}
const ctx = { secMed };

/* نفس مسار `oppDirOf` في الواجهة و`main` في `track-signals` بالحرف —
   فحصٌ يبني قراره بطريقةٍ أخرى يشهد لشيءٍ لا يعمل. */
const resolveFor = (r) => {
  const f = F[r.s] || null;
  const hs = SCANS.filter(sc => { try { return !!sc.test(r, f, ctx); } catch { return false; } });
  if (!hs.length) return null;
  const R = resolveOpp({
    score: r.score, band: r.band,
    hits: hs.map(sc => ({ id: sc.id, dir: sc.dir === -1 ? -1 : 1, forced: forcedDir(sc.id) }))
  });
  return { hs, R };
};

/* ---------- ١) الفريمات المعتمدة ---------- */

t("الفريمات المعتمدة أربعة بالضبط ولا فريم دون ١٥ دقيقة", () => {
  must(TFS.length === 4, `TFS طولها ${TFS.length}`);
  must(TFS.join(",") === "15m,1h,4h,1d", "TFS = " + TFS.join(","));
  const fast = TFS.filter(x => /^(1m|2m|3m|5m)$/.test(x));
  must(!fast.length, "فريمٌ سريع داخل TFS: " + fast.join(","));
  return TFS.join(" · ");
});

t("وزن الفريم يزيد بكبره، ولا يقلب الأصغرُ النتيجةَ منفرداً", () => {
  const w = TFS.map(k => TF_WEIGHT[k]);
  for (let i = 1; i < w.length; i++)
    must(w[i] > w[i - 1], `وزن ${TFS[i]} (${w[i]}) ليس أكبر من ${TFS[i - 1]} (${w[i - 1]})`);
  const tot = w.reduce((a, b) => a + b, 0);
  must(w[0] / tot < 0.5, `وزن ${TFS[0]} = ${(w[0] / tot * 100).toFixed(0)}% من المجموع`);
  return TFS.map((k, i) => `${k}=${w[i]}`).join(" · ");
});

t("رموز الكون الحيّ لا تحمل تحليل فريمٍ سريع", () => {
  const dir = path.join(OUT, "sym");
  if (!fs.existsSync(dir)) return "لا مجلّد رموز";
  const live = new Set(rows.map(r => r.s));
  if (!live.size) return "لا كون حيّ";
  let n = 0;
  const bad = [];
  /* المقام هو الكون الحيّ لا المجلّد: فيه ملفّاتٌ يتيمة لرموزٍ خرجت من
     `symbols.json` لا تُعاد كتابتها ولا يقرؤها التطبيق. وفحصٌ يختار
     عيّنته بالأبجدية ليس فحصاً — يُمسح الكون كلُّه. */
  for (const f of fs.readdirSync(dir)) {
    const s = f.replace(/\.json$/, "");
    if (!live.has(s)) continue;
    n++;
    const txt = fs.readFileSync(path.join(dir, f), "utf8");
    if (/"(1m|2m|3m|5m)"\s*:/.test(txt)) bad.push(s);
  }
  must(!bad.length, `فريمٌ سريع في ${bad.length} ملفاً: ${bad.slice(0, 5).join(", ")}`);
  return `${n} ملفاً من الكون الحيّ`;
});

/* ---------- ٢) وحدة القرار ---------- */

t("الاتجاه الأساس من النطاق المثبَّت لا من النتيجة الخام", () => {
  /* النطاق يحمل هيستريسس `bandStable` (‎3‎ نقاط)، والنتيجة الخام لا.
     فقراءةُ الخام تجعل حركةً لا تُذكر حول الحدّ ‎−15‎ تقلب الفرصة من
     Call إلى Put كلّ دورة — وهو ما بلّغ عنه المستخدم. */
  must(baseDirOf(-14.9, 1) === -1, "النطاق 1 يجب أن يعطي هبوطاً مهما كانت النتيجة");
  must(baseDirOf(-15.1, 2) === 1, "النطاق 2 يجب أن يعطي صعوداً مهما كانت النتيجة");
  must(baseDirOf(-20, null) === -1, "بلا نطاق يسقط إلى النتيجة");
  must(baseDirOf(null, null) === null, "بلا نتيجة ولا نطاق: لا اتجاه — لا صعود");
  return "النطاق يغلب، والنتيجة بديلٌ معلَن";
});

t("لا فرضَ ضدّ قراءةٍ قاطعة، ويبقى مسموحاً على الميل العادي", () => {
  must(conflictOf(1, 0) === true, "فرضٌ صاعد فوق «هابط قوي» يجب أن يتعارض");
  must(conflictOf(-1, 4) === true, "فرضٌ هابط فوق «صاعد قوي» يجب أن يتعارض");
  /* الميل العادي مفاضلةٌ قاسها الأرشيف وأيّدها (`vol` ‎−0.72 → −0.34‎)،
     وإلغاء الفرض كلَّه يهدم حافّةً مقيسة لعلاج حالةٍ متطرّفة. */
  must(conflictOf(1, 1) === false, "الميل الهابط ليس تعارضاً");
  must(conflictOf(1, 2) === false, "العرضي ليس تعارضاً");
  must(conflictOf(null, 0) === false, "بلا فرض لا تعارض");
  return "المتطرّف وحده (نطاق 0 و4)";
});

t("الفحص يُسقط نفسه لو عاد الاتجاه يُشتقّ بأوّل فرضٍ بلا سؤال", () => {
  // المحاكاة: المنطق القديم كان `forced ?? base` بلا فحص تعارض
  const hits = [{ id: "alignDn", dir: -1, forced: null }, { id: "divBull", dir: 1, forced: 1 }];
  const oldDir = hits.map(h => h.forced).find(d => d === 1 || d === -1) ?? baseDirOf(-68.8, 0);
  const now = resolveOpp({ score: -68.8, band: 0, hits });
  must(oldDir === 1, "المحاكاة لا تعيد إنتاج السلوك القديم");
  must(now.dir === -1, `المنطق الجديد يجب أن يعيد هبوطاً لا ${now.dir}`);
  must(now.dropped.some(h => h.id === "divBull"), "الشرط المفروض يجب أن يسقط");
  return "قديم ▲ · جديد ▼";
});

/* ---------- ٣) اختبار القبول على الكون الحيّ ---------- */

t("لا رمز يحمل فرصتين متعاكستين", () => {
  let n = 0;
  for (const r of rows) {
    const x = resolveFor(r);
    if (!x || !x.R.dir) continue;
    n++;
    for (const h of x.R.kept) {
      const fd = forcedDir(h.id);
      const own = (fd === 1 || fd === -1) ? fd
        : (h.dir === 1 || h.dir === -1) ? h.dir : x.R.dir;
      must(own === x.R.dir,
        `${r.s}: الشرط ${h.id} اتجاهه ${own} واتجاه الرمز ${x.R.dir}`);
    }
  }
  return `${n} رمزاً بفرصة`;
});

t("Call ⇒ أهدافٌ ومستويات صاعدة فقط · Put ⇒ هابطة فقط", () => {
  let n = 0, noLv = 0;
  for (const r of rows) {
    const x = resolveFor(r);
    if (!x || !x.R.dir) continue;
    const sf = rd(path.join("sym", `${r.s}.json`));
    if (!sf) { noLv++; continue; }
    const f = F[r.s] || null;
    const L = levelsFrom({
      k4h: sf.tf && sf.tf["4h"] && sf.tf["4h"].c,
      k1d: sf.tf && sf.tf["1d"] && sf.tf["1d"].c,
      px: r.p,
      a: (sf.an && (sf.an["4h"] || sf.an["1d"])) || null,
      w52h: f && Number.isFinite(f.w52h) ? f.w52h : null,
      w52l: f && Number.isFinite(f.w52l) ? f.w52l : null,
      now: Date.now()
    });
    if (!L) { noLv++; continue; }
    const atr = (Number.isFinite(r.atr) && r.atr > 0) ? r.atr : L.atr;
    const p = planFrom({ px: L.px, atr, resAll: L.resAll, supAll: L.supAll }, x.R.dir);
    if (!p) { noLv++; continue; }
    n++;
    const d = x.R.dir;
    must(p.dir === d, `${r.s}: اتجاه الخطة ${p.dir} واتجاه الفرصة ${d}`);
    const bad = validatePlan(p);
    must(!bad.length, `${r.s}: ${bad[0]}`);
    (p.targets || []).forEach((tg, i) => must(
      (tg.p - p.entry) * d > 0,
      `${r.s}: الفرصة ${d > 0 ? "صعود" : "هبوط"} والهدف ${i + 1} (${tg.p}) في الجهة المعاكسة للدخول (${p.entry})`));
    must((p.stop - p.entry) * d < 0, `${r.s}: الوقف في جهة الهدف لا خلف الدخول`);
  }
  return `${n} خطة مفحوصة${noLv ? ` · ${noLv} بلا مستويات` : ""}`;
});

t("لا فرصة تُعرض مع تعارضٍ جوهري مع القراءة الفنية", () => {
  let shown = 0, blocked = 0;
  for (const r of rows) {
    const x = resolveFor(r);
    if (!x) continue;
    if (!x.R.dir) { blocked++; continue; }
    shown++;
    if (r.band === 0) must(x.R.dir === -1, `${r.s}: فرصة صاعدة ونطاقها «هابط قوي» (${r.score})`);
    if (r.band === 4) must(x.R.dir === 1, `${r.s}: فرصة هابطة ونطاقها «صاعد قوي» (${r.score})`);
  }
  return `${shown} معروضة · ${blocked} محجوبة`;
});

t("اتجاه الفرصة لا يخالف إجماع الفريمات الأربعة", () => {
  let n = 0;
  const viol = [];
  for (const r of rows) {
    const x = resolveFor(r);
    if (!x || !x.R.dir) continue;
    const v = Object.values(r.tfScore || {});
    if (v.length !== 4) continue;
    n++;
    // «إجماع» بنفس عتبة `allTF` الموثّقة (‎±15‎) لا عتبةٍ جديدة
    if (v.every(z => z < -15) && x.R.dir === 1) viol.push(`${r.s}(الأربعة هابطة وفرصتُه صاعدة)`);
    if (v.every(z => z > 15) && x.R.dir === -1) viol.push(`${r.s}(الأربعة صاعدة وفرصتُه هابطة)`);
  }
  must(!viol.length, `${viol.length} مخالفاً: ${viol.slice(0, 5).join(" · ")}`);
  return `${n} رمزاً بأربعة فريمات`;
});

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
