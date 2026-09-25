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
  try { rec = JSON.parse(fs.readFileSync(path.join(OUT, "sym", sym + ".json"), "utf8")); } catch { /* بلا ملف */ }
  const k = {};
  for (const tf of ["15m", "4h", "1d"]) {
    const cc = rec && rec.tf && rec.tf[tf] && rec.tf[tf].c;
    k[tf] = cc && cc.length ? closedBars(unpackK(cc), tf, nowMs) : [];
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

  /* الحالة السابقة: من اللقطة القائمة. وأوّل تشغيلٍ بلا حالة يبذر من
     سجلّ الإشارات المفتوح (عمرٌ صادق) — مرّةً واحدة، فلا يدخل ملفٌّ
     يتغيّر داخل الشمعة في حسابٍ متكرّر. */
  const prevDoc = rd("opportunities.json");
  const prevLife = (prevDoc && prevDoc.life) || null;
  const seeds = prevLife ? {} : seedFromSignals((rd("signals.json") || {}).records);
  const nowMs = (candleKey + 900) * 1000 + 1;        // ساعة الشمعة لا الحائط
  const bars = {};
  const life = {};
  for (const [k, v] of Object.entries(prevLife || {}))
    life[k] = { ...v, t: (v.t || []).slice(), end: v.end ? { ...v.end } : null };
  const seen = new Set();
  const annotate = (row, scan, sd) => {
    if (!(sd === 1 || sd === -1)) return null;
    const key = lifeKey(row.s, scan.id, sd);
    seen.add(key);
    let L = life[key];
    const B = symBars(row.s, bars, nowMs);
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
    walk(L, B.k["15m"]);
    if (L.k < candleKey) { L.miss = 0; L.k = candleKey; }
    L.miss = 0;
    const fr = freshness((candleKey - L.since) * 1000, scanTF(scan.id));
    if (!L.end && fr && fr.k === "stale") L.end = { k: "old", at: candleKey };
    if (L.end) return { drop: true };
    const mv = Number.isFinite(row.pc) && L.px0 > 0 ? (row.pc / L.px0 - 1) * 100 * sd : null;
    return {
      mult: (F_FRESH[fr && fr.k] ?? 1) * F_ROOM[Math.min(L.hit, 3)],
      f: { since: L.since, px0: L.px0 == null ? null : rp(L.px0), e: L.e, st: L.st, t: L.t,
           hit: L.hit, in: L.in, fk: fr ? fr.k : null, mv: mv == null ? null : Math.round(mv * 100) / 100 }
    };
  };

  const scans = buildOpps(
    { SCANS, scanRow, forcedDir, resolveOpp, consFromRows, scsFrom, oppQualityOf },
    { rows: summary.rows, wideRows, fund: F, secMed,
      stratByS: byS, stratMeta: STRAT_BY_ID, stratTotal: STRATEGIES.length, edge, annotate });

  /* ما غاب شرطُه في هذه الشمعة: يُعدّ غيابُه مرّةً لكل مفتاح، وبعد
     شمعتين يُنهى ويُحذف، فيعود شرطُه لاحقاً فرصةً جديدةً بعمرٍ جديد.
     والمنتهي (وقف/هدف/قِدَم) **الحاضر** يبقى محجوباً ما دام شرطُه يُطلق —
     وإلا عاد في الشمعة التالية «جديداً» وهو هو. */
  const closedNow = [];
  for (const [k, L] of Object.entries(life)) {
    if (seen.has(k)) continue;
    if (L.k < candleKey) { L.miss = (L.miss || 0) + 1; L.k = candleKey; }
    if (L.miss >= MISS_MAX) { closedNow.push([k, L.end ? L.end.k : "gone"]); delete life[k]; }
  }

  /* تحليل الخمسين كلّهم — لا من ظهر في قائمةٍ وحده. شاشةُ السهم تقرؤه
     فلا تحسب شيئاً بنفسها، فلا يختلف رقمُها عن رقم القائمة. */
  const bySym = {};
  for (const r of summary.rows) {
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

  return { ok: true, candleKey, rowsHash, strategyVersion, scans, count, life, bySym, closedNow,
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
    scans: next.scans,
    bySym: next.bySym,
    life: next.life,
    closedNow: next.closedNow
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
