#!/usr/bin/env node
/* =====================================================================
   اختبار القبول لقائمة الفرص — **ما يراه المستخدم بالضبط**، لا طبقةً
   تحته. بلا شبكة.

   السياق: بلّغ المستخدم بصورٍ متتابعة أن تبويب «الفرص» يتبدّل بين
   ‎07:46‎ و‎07:51‎ — ترتيبٌ يُقلب، ورموزٌ تدخل وتخرج، و«88 نقطة» تصير
   ‎85‎ — ولم تُغلق في الفارق شمعةُ ربع ساعة. وقال إن العلّة قائمة منذ
   بداية الموقع وإنّ كلَّ إصلاحٍ سابق لم يمسّها.

   وكان محقّاً: الإصلاح السابق ثبّت **محرّك الاستراتيجيات** (CONFIRMED)،
   وهو يعدّل درجة الفرصة ‎±15‎ نقطة فحسب. أمّا **عضوية القائمة وترتيبها**
   فمن `r.score` و`r.tfScore` و`r.p` و`r.vol` — وكلُّها كانت تُحسب على
   الشمعة الجارية وعلى السعر اللحظي، فتتحرّك كلّ دورة وسط ربع الساعة.

   القياس الذي أثبت ذلك (218 رمزاً من الكون الحيّ): **85.3%** تتغيّر
   نتيجتُه بحذف الشمعة الجارية وحدها، وسيط الفرق ‎5.88‎ نقطة، و**28**
   رمزاً تنقلب عضويتُه في شرطَي «توافق الفريمات»، وأوّل ثمانية في
   القائمة يختلفون بالكامل.

   ---------------------------------------------------------------------
   فهذا الملفّ يصوغ الشرط المطلوب صياغةً قابلةً للتنفيذ:

     **قائمة الفرص دالّةٌ في الشمعات المغلقة وحدها.** دورةُ خادمٍ أخرى
     داخل نفس الشمعة — سعرٌ لحظيّ تحرّك، وشمعةٌ جارية تحرّكت، وساعةٌ
     تقدّمت — لا تغيّر القائمة بحرف: لا عضويةً ولا ترتيباً ولا الرقمَ
     المعروض. ولا تتغيّر إلّا حين تُغلَق شمعةٌ جديدة فعلاً.

   ويُحاكى مسار الخادم كاملاً كما يفعله `fetch-market`: المؤشّرات
   تُعاد من السلسلة، وصفُّ الملخّص يُبنى منها. فمحاكاةٌ ناقصة تقيس نصف
   المشكلة وتُخفي نصفها — وهو ما وقع فعلاً في جولةٍ سابقة.
   ===================================================================== */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { SCANS, scanRow, forcedDir } = require(path.join(ROOT, "stocks/scans.js"));
const { resolveOpp } = require(path.join(ROOT, "stocks/direction.js"));
const IND = require(path.join(ROOT, "stocks/indicators.js"));
const SC = require(path.join(ROOT, "stocks/score.js"));
const P = require(path.join(ROOT, "stocks/plan.js"));

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name} — ${e.message}`); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

const DATA = path.join(ROOT, "data");
const rdj = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/* =====================================================================
   بناءُ صفّ الملخّص من سجلّ الرمز — **نظيرُ `buildRow` في
   `fetch-market`** في الحقول التي تقرأها الشروط وحدها.

   ولماذا يُعاد البناء بدل قراءة `summary.json`: المحفوظ لقطةُ دورةٍ
   واحدة، والسؤال المطروح «هل تتغيّر بين دورتين؟» — فلا بدّ من توليد
   الدورة الثانية. و`legacy` يعيد سلوك ما قبل الإصلاح (المؤشّرات على
   السلسلة كاملةً، والشروط على السعر اللحظي) كي يُثبَت أن الاختبار
   ليس دائم النجاح.
   ===================================================================== */
function rowFrom(rec, base, px, now, legacy) {
  const an = {};
  for (const tf of SC.TFS) {
    const raw = rec.tf && rec.tf[tf] && rec.tf[tf].c;
    if (!raw) continue;
    const k = P.unpackK(raw);
    const a = IND.analyze(legacy ? k : IND.closedBars(k, tf, now));
    if (a) an[tf] = a;
  }
  const d1 = (rec.tf && rec.tf["1d"] && P.unpackK(rec.tf["1d"].c)) || [];
  const d1c = legacy ? d1 : IND.closedBars(d1, "1d", now);
  let conf = null;
  for (const tf of ["15m", "1h", "4h", "1d"]) {
    const raw = rec.tf && rec.tf[tf] && rec.tf[tf].c;
    if (!raw || raw.length < 2) continue;
    const kk = IND.closedBars(P.unpackK(raw), tf, now);
    if (kk.length) { conf = kk[kk.length - 1]; break; }
  }
  const a1 = an["1d"] || {};
  return {
    ...base, p: px,
    ...(legacy || !conf ? {} : { pc: conf.c }),
    ...(legacy || !d1c.length ? {} : { volc: d1c[d1c.length - 1].v }),
    score: r2(SC.overallScore(an)),
    tfScore: Object.fromEntries(SC.TFS.filter(x => an[x]).map(x => [x, +an[x].score.toFixed(1)])),
    rsi: r2(a1.rsi ?? null), atr: a1.atr ?? null,
    e20: a1.e20 ?? null, e50: a1.e50 ?? null, e200: a1.e200 ?? null,
    adx: r2(a1.adx ?? null), squeeze: r2(a1.squeeze ?? null),
    ...(a1.div && a1.div.dir ? { div: a1.div.dir } : {}),
    /* حجم الجلسة يتراكم حيّاً مع تقدّم اليوم — يُحاكى تراكمه بنفس معامل
       حركة السعر، وإلّا لم يُختبر شرط «حجم غير معتاد» أصلاً. */
    vol: Number.isFinite(base.vol)
      ? Math.round(base.vol * (1 + Math.abs(px / base.p - 1) * 40)) : base.vol
  };
}

/* دورةُ خادمٍ أخرى: الشمعة **الجارية** وحدها تتحرّك. المغلقة لا يعيد
   المصدر كتابتها، وتشويهُها محاكاةُ فسادِ بياناتٍ لا محاكاةُ دورة. */
function bumpRec(rec, f, now) {
  const r = JSON.parse(JSON.stringify(rec));
  for (const tf in (r.tf || {})) {
    const c = r.tf[tf] && r.tf[tf].c;
    if (!c || c.length < 2) continue;
    const b = c[c.length - 1];
    if (!Array.isArray(b)) continue;
    if (!IND.isLiveBar(tf, IND.barTime(b), now)) continue;
    const v = b[4];
    b[1] = v * f; b[2] = v * f * 1.03; b[3] = v * f * 0.97; b[4] = v * f;
    b[5] = Math.round((b[5] || 1000) * (1 + Math.abs(f - 1) * 40));
  }
  return r;
}

/* وسائط القطاعات — كما تبنيها الواجهة والخادم. */
function sectorMedians(rows, F) {
  const by = {};
  for (const r of rows) {
    const f = F[r.s];
    if (!f || !Number.isFinite(f.pe) || f.pe <= 0) continue;
    (by[r.sec] = by[r.sec] || []).push(f.pe);
  }
  const out = {};
  for (const sec in by) {
    const a = by[sec].sort((x, y) => x - y), m = Math.floor(a.length / 2);
    out[sec] = { pe: a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 };
  }
  return out;
}

/* =====================================================================
   قائمةُ شرطٍ واحد — **نفس ترتيب `renderScreen` بالحرف**: ترشيحٌ بـ
   `test` ثمّ فرزٌ بـ`rank`، وكلاهما على الصفّ المؤكَّد عبر `scanRow`.

   ويُؤخذ معها الرقمُ المعروض (`val`) واتجاهُ الفرصة، فالمستخدم يرى
   الثلاثة — وقائمةٌ ثابتةُ الترتيب بأرقامٍ متبدّلة هي نفس الشكوى.
   ===================================================================== */
function listFor(scan, rows, F, ctx, legacy) {
  const hits = [];
  for (const r of rows) {
    const rc = legacy ? r : scanRow(r);
    let hit = false;
    try { hit = !!scan.test(rc, F[r.s], ctx); } catch (e) { hit = false; }
    if (!hit) continue;
    let k = Infinity;
    try { k = scan.rank ? scan.rank(rc, F[r.s], ctx) : -(r.score ?? -999); } catch (e) { /* حقل ناقص */ }
    let v = "";
    try { v = scan.val(rc, F[r.s], ctx) || ""; } catch (e) { /* حقل ناقص */ }
    const all = SCANS.filter(sc => { try { return !!sc.test(rc, F[r.s], ctx); } catch (e) { return false; } });
    const R = resolveOpp({ score: r.score, band: r.band, tfScore: r.tfScore,
      hits: all.map(sc => ({ id: sc.id, dir: sc.dir === -1 ? -1 : 1, forced: forcedDir(sc.id) })) });
    hits.push({ s: r.s, k: Number.isFinite(k) ? k : Infinity, v, dir: R.dir || 0 });
  }
  hits.sort((a, b) => a.k - b.k);
  return hits.map(h => `${h.s}|${h.v}|${h.dir}`);
}

console.log("\n▶ اختبار قبول قائمة الفرص — لا تتبدّل داخل الشمعة (بلا شبكة)\n");

/* ثلاث دوراتٍ داخل ربع ساعةٍ واحد، بمرساةٍ من البيانات لا من ساعة
   الحائط: قفزةٌ من `Date.now()` تعبر حدَّ شمعةٍ في أغلب الأحيان،
   فيُقرأ **إغلاقٌ صحيح** خللاً في الثبات. */
function sweepLists(legacy) {
  const sum = rdj(path.join(DATA, "summary.json"));
  if (!sum || !Array.isArray(sum.rows)) return null;
  const F = (rdj(path.join(DATA, "fundamentals.json")) || {}).f || {};
  const anchor = Number.isFinite(sum.updated) ? sum.updated : Date.now();
  const q0 = Math.floor(anchor / 9e5) * 9e5;

  const recs = new Map();
  for (const r of sum.rows) {
    if (!(r.p > 0)) continue;
    const rec = rdj(path.join(DATA, "sym", r.s + ".json"));
    if (rec && rec.tf) recs.set(r.s, rec);
  }
  const cycle = (f, dt) => {
    const now = q0 + dt;
    const rows = [];
    for (const base of sum.rows) {
      const rec = recs.get(base.s);
      if (!rec) continue;
      rows.push(rowFrom(bumpRec(rec, f, now), base, base.p * f, now, legacy));
    }
    const ctx = { secMed: sectorMedians(rows.filter(r => r.mkt !== "crypto"), F) };
    const out = {};
    for (const scan of SCANS) out[scan.id] = listFor(scan, rows, F, ctx, legacy);
    return out;
  };

  const a = cycle(1, 60e3);
  // كلُّها دون ‎900‎ ثانية من مطلع الربع فلا تعبر حدَّه
  const steps = [[1.006, 180e3], [0.994, 420e3], [1.02, 840e3]];
  let diff = 0; const moved = new Set(); const ex = [];
  for (const [f, dt] of steps) {
    const b = cycle(f, dt);
    for (const id in a) {
      if (a[id].join("\n") === b[id].join("\n")) continue;
      diff++; moved.add(id);
      if (ex.length < 3) {
        const i = a[id].findIndex((x, n) => x !== b[id][n]);
        const lbl = (SCANS.find(s => s.id === id) || {}).lbl;
        ex.push(`«${lbl}» عند المرتبة ${i + 1}: ${a[id][i] || "—"} ← ${b[id][i] || "—"}`);
      }
    }
  }
  return { syms: recs.size, diff, scans: [...moved], ex };
}

/* =====================================================================
   **الرجوع الصامت إلى السعر اللحظي** — الحارس الذي كشفته المقارنة
   الحيّة لا الفحص.

   `scanRow` تعيد الصفّ كما هو حين يغيب `pc`، فيُقاس الشرط على السعر
   اللحظي بلا أيّ أثر: لا خطأ ولا سطر، فقط صفٌّ يهتزّ بين دورتين وسط
   قائمةٍ ثابتة. وقع فعلاً على صفوف الطبقة الواسعة المكتوبة قبل هذا
   الحقل — `GMEB-USD` من «96% من النطاق» إلى «97%» بين دورتَي خادمٍ
   حقيقيّتين تفصلهما سبع دقائق **وشمعةُ تأكيدهما واحدة**.

   ---------------------------------------------------------------------
   والفحص يفرّق بين طبقتين لأن إيقاعهما مختلف بنيوياً:

   **المرصودة** تُجدَّد كلَّ عشر دقائق، فصفٌّ بلا `pc` فيها خللٌ في
   الكاتب — يُسقط الفحص فوراً.

   **الواسعة تراكمية** تُجدَّد بالتدوير على صلاحيةٍ يومية، فبعد أيّ
   تغييرٍ في التعريف تبقى صفوفٌ بالشكل القديم حتى يأتي دورها. وهذه
   حالةٌ عابرة معلومة لا خلل — وفحصٌ يصيح بها يوماً كاملاً يُدرَّب
   المستخدم على تجاهله، وهي نفس قاعدة «إنذارٌ كاذب يُدرَّب على تجاهله»
   في حارس الطزاجة.

   فالشرط المنضبط: **أيُّ صفٍّ جُلب بعد أوّل صفٍّ يحمل `pc` يجب أن
   يحمله.** يمرّ أثناء التدوير، ويسقط فورَ توقّف الكاتب عن كتابته —
   وهو الخلل الحقيقي. و`u` هو زمنُ جلب شمعات الصفّ، وهو الحقل نفسه
   الذي يقرّر استحقاق التجديد في `fetch-market`.
   ===================================================================== */
t("لا صفَّ يُقاس على السعر اللحظي — `pc` في كل ما جُلب بالتعريف الجديد", () => {
  const sum = rdj(path.join(DATA, "summary.json"));
  if (!sum || !Array.isArray(sum.rows)) { console.log("      (لا بيانات محليّة — تُخطّى)"); return; }
  const core = sum.rows.filter(r => !Number.isFinite(r.pc));
  ok(core.length === 0,
     `${core.length} من ${sum.rows.length} في المرصودة بلا pc — ${core.slice(0, 3).map(r => r.s).join(" ")}`);

  const wide = (rdj(path.join(DATA, "wide.json")) || {}).rows || [];
  const has = wide.filter(r => Number.isFinite(r.pc));
  const not = wide.filter(r => !Number.isFinite(r.pc));
  if (has.length && not.length) {
    const first = Math.min(...has.map(r => r.u || 0));
    const late = not.filter(r => (r.u || 0) > first);
    ok(late.length === 0,
       `${late.length} صفّاً واسعاً جُلب بعد بدء كتابة pc ولا يحمله — ${late.slice(0, 3).map(r => r.s).join(" ")}`);
  }
  console.log(`      (${sum.rows.length} مرصودة كلُّها مؤكَّدة · الواسعة ${has.length}/${wide.length}` +
              `${not.length ? ` — ${not.length} تنتظر دورتها اليومية` : ""})`);
});

t("قائمة الفرص لا تتبدّل داخل الشمعة — على الكون الحيّ", () => {
  const r = sweepLists(false);
  if (!r) { console.log("      (لا بيانات محليّة — تُخطّى)"); return; }
  ok(r.syms >= 50, `عيّنةٌ ذات معنى: ${r.syms} رمزاً`);
  ok(r.diff === 0, `${r.diff} قائمةً تبدّلت (${r.scans.join(" ")})` +
     (r.ex.length ? ` — ${r.ex[0]}` : ""));
  console.log(`      (${r.syms} رمزاً × ${SCANS.length} شرطاً × ٣ دورات · صفر تبدّل)`);
});

t("والاختبار ليس دائم النجاح: سلوكُ ما قبل الإصلاح يُسقطه", () => {
  /* **فحصٌ يمرّ مهما كانت المدخلات ليس فحصاً.** يُعاد هنا سلوكُ ما قبل
     الإصلاح حرفياً — مؤشّراتٌ على السلسلة كاملةً وشروطٌ على السعر
     اللحظي — ويُشترط أن يُرصد الخلل. */
  const r = sweepLists(true);
  if (!r) return;
  ok(r.diff > 0, "السلوك القديم يجب أن يُرصد مختلفاً");
  console.log(`      (القديم: ${r.diff} تبدّلاً في ${r.scans.length} شرطاً — ${r.ex[0] || ""})`);
});

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
process.exit(fail ? 1 : 0);
