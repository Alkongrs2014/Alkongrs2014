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
const { buildOpps, oppsCanon, candleKeyAt } = require("../stocks/opportunities.js");

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
const OUT = process.env.OPP_OUT || path.join(ROOT, "data");
const sha12 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
/* أدنى نسبةٍ من الصفوف الحيّة يجب أن تحمل الفريمات الأربعة. انظر
   «البوّابة ٠» أدناه. */
const DEPTH_MIN = 0.90;
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")); } catch { return null; } };

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

export function buildSnapshot(now = Date.now()) {
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

  const scans = buildOpps(
    { SCANS, scanRow, forcedDir, resolveOpp, consFromRows, scsFrom, oppQualityOf },
    { rows: summary.rows, wideRows, fund: F, secMed,
      stratByS: byS, stratMeta: STRAT_BY_ID, stratTotal: STRATEGIES.length, edge });

  const rowsHash = sha12(oppsCanon(scans));
  const strategyVersion = logicVersion();
  let count = 0;
  for (const id of Object.keys(scans)) count += scans[id].length;

  return { ok: true, candleKey, rowsHash, strategyVersion, scans, count,
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
    scans: next.scans
  };
  /* كتابةٌ ذرّية: ملفٌّ مؤقّت ثم إعادة تسمية. الكتابة المباشرة تترك
     نافذةً يقرأ فيها المتصفّح نصف ملفّ. */
  const tmp = path.join(OUT, ".opportunities.tmp.json");
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, path.join(OUT, "opportunities.json"));
  console.log(`  لقطة الفرص: كُتبت — ${d.reason} · شمعة ${iso(next.candleKey)} · ${next.count} صفّاً · بصمة ${next.rowsHash}`);
  return 0;
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
