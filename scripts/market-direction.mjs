#!/usr/bin/env node
/* =====================================================================
   توجّه السوق — S&P 500 وأكبر خمس عشرة شركة، على ثلاثة فريمات.

   السؤال الذي يجيبه هذا الملفّ ليس «ما حال هذا السهم؟» — ذاك تجيبه
   شاشةُ السهم. السؤال: **إلى أين يميل السوق الآن، وبأيّ قوّة، وهل
   تتّفق آفاقُه الثلاثة أم تتعارض؟**

   ولا يؤثّر في شيء: لا يُقرأ من شروط الفرص ولا من الماسح ولا من
   السجلّ. قسمُ عرضٍ مستقلّ بقرار.

   ---------------------------------------------------------------------
   **لماذا يُحسب في الخادم ولا يُحسب في المتصفّح**

   ستّة عشر أصلاً × ثلاثة فريمات × إحدى عشرة طريقة = ‎528‎ تقييماً،
   وكلٌّ يحتاج ملفَّ رمزٍ كاملاً بشمعاته. وهي أرقامٌ لا تتغيّر إلا مع
   الشمعة، فحسابُها في كل فتحة صفحة إنفاقٌ بلا مقابل. تُحسب مرّةً كل
   دورة وتُقرأ لقطةً — ويُقال في الواجهة إنها لقطةُ خادم.

   ---------------------------------------------------------------------
   **إحدى عشرة طريقة لا عشر**

   العشر هي استراتيجيات الماسح، والحادية عشرة **محرّك الفرص** ممثَّلاً
   بنتيجته الفنية على ذلك الفريم (`an[tf].score`). وهما نظامان يقيسان
   شيئين مختلفين — «هل تحقّق شرطٌ معروف الحافّة؟» مقابل «كم طريقةً
   ترى نفس الجهة؟» — فجمعُهما يوسّع القاعدة ولا يكرّرها.

   وعتبةُ «له جهة» هي ‎±15‎: نفس عتبة `allTF` في `scans.js` حرفياً، لا
   رقمٌ جديد. ولو اختلفتا لقال هذا القسم إن الفريم صاعد ويقول شرطُ
   «توافق الفريمات» إنه ليس كذلك — عن نفس الرقم.

   ---------------------------------------------------------------------
   **وما لا يُقاس على فريمٍ يُعلَن `off` ولا يُحشى محايداً**

   `orb` و`vwapRec` استراتيجيتا جلسةٍ داخل اليوم، و`tfAlign` حكمٌ
   عابرٌ للفريمات، و`pbTrend`/`momo` يحتاجان فريماً فوق فريمهما فلا
   يعملان على اليوميّ (لا أسبوعيّ عندنا). فيخرج عمودُ اليوميّ بستٍّ
   عاملة من إحدى عشرة — ويُقال العدد صراحةً. وسمُ ما لا يعمل يملأ
   القائمة بلا شيء ويُقرأ عطلاً، وحشوُه محايداً يخفض كل نسبةٍ بلا سبب.

     node scripts/market-direction.mjs --check
     node scripts/market-direction.mjs --out data
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { sessionOf, currentWindow, statusNow } from "./lib/session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, "stocks/strategies.js"));
const C = require(path.join(ROOT, "stocks/consensus.js"));
const F = require(path.join(ROOT, "stocks/confluence.js"));
const SC = require(path.join(ROOT, "stocks/score.js"));

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const OUT = (() => { const i = args.indexOf("--out"); return i >= 0 ? path.resolve(args[i + 1]) : path.join(ROOT, "data"); })();

/* =====================================================================
   الثوابت — ولا واحد منها مخترَع.
   ===================================================================== */

/* فريمات القسم. **لا ‎15د‎ فيها بقرار**: السؤال هنا «إلى أين يميل
   السوق» لا «ما الذي يحدث هذه الربع ساعة»، وفريمٌ ربعُ ساعةٍ على
   مؤشّرٍ يضيف ضجيجاً لا ميلاً. */
const TFS = ["1h", "4h", "1d"];

/* أوزانُ الفريمات هي `TF_WEIGHT` في `stocks/score.js` — **تُستورد ولا
   تُكتب ثانيةً**. وهي تحقّق المطلوب أصلاً (اليوميّ أعلى ثم ‎4‎ ساعات
   ثم الساعة) بلا رقمٍ جديد، ونسخُها هنا يجعل وزنَ الفريم في هذا
   القسم يخالف وزنَه في النتيجة الفنية عند أوّل تعديل. */
const TF_W = SC.TF_WEIGHT;

/* ‎tfAlign‎ ساقٌ على مستوى الأصل لا عمودٌ في فريم: هو حكمٌ عابرٌ
   للفريمات، فاستنساخُه في الأعمدة الثلاثة يَعُدّه ثلاث مرّات. ووزنه
   ‎1.0‎ — وزنُ الساعة نفسه، أي أدنى وزنٍ في الجدول: حافّته المقيسة في
   الأرشيف **سالبة** (‎−0.28‎/‎−0.42‎ على ‎91,824‎ حالة)، فلا يُعطى
   أكثر من الحدّ الأدنى ولا يُحذف — يُعرض بحافّته مكتوبة. */
const ALIGN_W = 1.0;

/* وزنُ المؤشّر مقابل السهم المفرد. `SPY` يمثّل خمسمئة شركة والسهمُ
   يمثّل نفسه، فتساويهما يجعل خمس عشرة شركة تُغرق المؤشّر. والثلاثة
   حدٌّ معلن: يبقى للمؤشّر أثرٌ ظاهر (‎3‎ من ‎18‎ ≈ ‎17%‎) ولا يُلغي
   الخمس عشرة. */
const BENCH_W = 3;

/* عددُ الشركات. والمقام يُعلَن مع النتيجة دائماً: «أكبر 15» تتغيّر
   تركيبتُها بتغيّر القيم السوقية، وإخفاءُ ذلك يجعل رقمَ اليوم يُقارَن
   برقم الأمس وهما عن مجموعتين. */
const TOP_N = 15;

/* عتبةُ «للفريم جهة» في ساق محرّك الفرص — نفس عتبة `allTF`. */
const OPP_MIN = 15;

const r2 = (v) => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

/* =====================================================================
   اختيار الأصول — والدمج بالهوية لا بالاسم.

   `ranking.top` مرتَّبٌ بالقيمة السوقية وفيه `GOOGL` و`GOOG` معاً:
   فئتا أسهمٍ لشركةٍ واحدة. وأخذُ أعلى خمس عشرة حرفياً يعطي **أربع
   عشرة شركة** إحداها مرّتين — ويزيح شركةً حقيقية خارج القائمة.

   والدمج بـ`cik.json` لا بتشابه الأسماء: رقمُ الشركة عند هيئة الأوراق
   المالية **هويّةٌ** لا تخمين. «Alphabet» و«Alphabet Inc. (Class C)»
   يتطابقان بمقارنة البادئة، و«Fox Corp Class A/B» كذلك — لكن قاعدةً
   مبنيّةً على النصّ تنكسر بأوّل اسمٍ لا يتبع النمط. و`BRK-A`/`BRK-B`
   و`FOX`/`FOXA` و`NWS`/`NWSA` كلُّها محلولةٌ بالحقل نفسه.

   وحين يغيب `cik.json` تُستعمل البادئة النصّية بديلاً **مع إعلان
   ذلك** — تدهورٌ هادئ معلَن لا صامت.
   ===================================================================== */
export function pickTop(rankTop, cikMap, nameOf, n = TOP_N) {
  const seen = new Set(), out = [], merged = [];
  for (const s of rankTop || []) {
    if (out.length >= n) break;
    const cik = cikMap && cikMap[s];
    // البادئة: أوّل كلمتين من الاسم الإنجليزي — بديلٌ حين لا هوية
    const nm = String((nameOf && nameOf(s)) || s).toLowerCase()
                 .replace(/[.,]/g, "").split(/\s+/).slice(0, 2).join(" ");
    const key = cik ? `cik:${cik}` : `nm:${nm}`;
    if (seen.has(key)) { merged.push(s); continue; }
    seen.add(key);
    out.push(s);
  }
  return { syms: out, merged };
}

/* =====================================================================
   سيقانُ فريمٍ واحد — العشر مثبَّتةً عليه، ومحرّك الفرص معها.
   ===================================================================== */
export function legsFor(rec, row, tf, now, sess, win, mkt) {
  const c = S.buildCtx({ rec, row, now, px: row && row.p, sess, win, tfPin: tf,
                         sessOf: (t) => sessionOf(t, mkt) });
  const legs = S.evalAll(c).map(r => ({
    id: r.id, lbl: r.lbl, fam: r.fam, dir: r.dir, sc: r.sc,
    active: !!r.active, off: r.off || null, at: r.at || null
  }));

  /* الساق الحادية عشرة. `sc` هو **مقدار** النتيجة لا إشارتها —
     `consensusOf` تأخذ الجهة من `dir` والقناعة من `sc`، وتمريرُ رقمٍ
     سالب في `sc` يعطي كتلةً سالبة فيُطرح من جهته بدل أن يُضاف. */
  const a = rec.an && rec.an[tf];
  const sco = a && Number.isFinite(a.score) ? a.score : null;
  legs.push(sco === null
    ? { id: "opps", lbl: "محرّك الفرص", fam: "trend", dir: 0, sc: null,
        active: false, off: `لا مؤشّرات على ${tf}` }
    : { id: "opps", lbl: "محرّك الفرص", fam: "trend",
        dir: Math.abs(sco) > OPP_MIN ? Math.sign(sco) : 0,
        sc: Math.min(100, Math.round(Math.abs(sco))),
        active: Math.abs(sco) > OPP_MIN, off: null });
  return { legs, ctx: c };
}

/* توجّهُ فريمٍ واحد: إجماعٌ ثم درجةٌ موقَّعة ثم وسم. */
export function tfDir(legs, edge, regime) {
  const cons = C.consensusOf(legs, { edge, regime });
  const s = F.scsFrom(cons);
  const off = legs.filter(l => l.off).length;
  return {
    dir: s.dir, pct: s.pct, mixed: s.mixed,
    n: cons.n, nUp: cons.nUp, nDn: cons.nDn,
    on: legs.length - off, off,
    conf: cons.conf, agree: r2(cons.agree),
    // الدرجة الموقَّعة تُحفظ: منها يُبنى إجمالي الأصل، وإعادةُ اشتقاقها
    // من `pct` و`dir` تفقد دقّتها بالتقريب
    scs: s.scs === null ? null : r2(s.scs)
  };
}

/* =====================================================================
   إجمالي الأصل — متوسّطٌ موزون على أربع سيقان.

   ثلاثةُ فريماتٍ بأوزان `TF_WEIGHT`، و`tfAlign` ساقاً رابعة بوزن
   ‎1.0‎. والمقام **ما شارك فعلاً** لا مجموعُ الأوزان: فريمٌ بلا قراءة
   (`scs === null`) يخرج من البسط والمقام معاً. قسمةٌ على مقامٍ ثابت
   تجعل أصلاً بفريمٍ واحد يبدو أضعفَ من أصلٍ بثلاثة وهو ليس كذلك —
   هو **أقلُّ معلوميةً**، وذاك يُقال بعدد السيقان لا بخفض الرقم.
   ===================================================================== */
export function assetDir(byTf, alignLeg) {
  let num = 0, den = 0, legs = 0;
  for (const tf of TFS) {
    const d = byTf[tf];
    if (!d || d.scs === null) continue;
    const w = TF_W[tf] || 1;
    num += d.scs * w; den += w; legs++;
  }
  if (alignLeg && alignLeg.dir && Number.isFinite(alignLeg.sc)) {
    num += alignLeg.dir * (alignLeg.sc / 100) * ALIGN_W;
    den += ALIGN_W; legs++;
  }
  if (!den) return { dir: 0, pct: null, scs: null, legs: 0 };
  const scs = num / den;
  const dir = scs > 0 ? 1 : (scs < 0 ? -1 : 0);
  return { dir, pct: Math.round(Math.abs(scs) * 100), scs: r2(scs), legs };
}

/* =====================================================================
   توجّه السوق العام — والوزن يتبع ما يمثّله الأصل.
   ===================================================================== */
export function marketDir(rows) {
  let num = 0, den = 0;
  const counts = { up: 0, flat: 0, dn: 0 };
  for (const r of rows) {
    if (!r.all || r.all.scs === null) continue;
    const w = r.bench ? BENCH_W : 1;
    num += r.all.scs * w; den += w;
    const lb = F.dirLabelOf(r.all.dir, r.all.pct);
    counts[lb.k === "flat" ? "flat" : (r.all.dir > 0 ? "up" : "dn")]++;
  }
  if (!den) return { dir: 0, pct: null, counts, agree: null, n: 0 };
  const scs = num / den;
  const dir = scs > 0 ? 1 : (scs < 0 ? -1 : 0);

  /* نسبةُ التوافق العام: كتلةُ الأصول الموافقة ÷ كتلةُ الأصول ذات
     الجهة. والمقام **ذوات الجهة** لا الكلّ: أصلٌ محايد لا يوافق ولا
     يخالف، وعدُّه في المقام يخفض النسبة كلّما هدأ السوق — فتقيس
     الهدوء لا الاتفاق. */
  let agN = 0, agD = 0;
  for (const r of rows) {
    if (!r.all || !r.all.dir) continue;
    const w = r.bench ? BENCH_W : 1;
    agD += w;
    if (r.all.dir === dir) agN += w;
  }
  return { dir, pct: Math.round(Math.abs(scs) * 100), scs: r2(scs),
           counts, agree: agD ? r2(agN / agD) : null, n: rows.length };
}

/* =====================================================================
   التشغيل
   ===================================================================== */
export function run(out = OUT, nowArg = Date.now()) {
  const now = nowArg;
  const summary = readJSON(path.join(out, "summary.json"));
  if (!summary || !Array.isArray(summary.rows) || !summary.rows.length)
    throw new Error("لا summary.json — لا يُكتب فوق بياناتٍ سليمة");
  const ranking = readJSON(path.join(out, "ranking.json"), {});
  const market = readJSON(path.join(out, "market.json"), {});
  const cikFile = readJSON(path.join(out, "cik.json"), {});
  const cik = cikFile && cikFile.map ? cikFile.map : null;
  const edgeFile = readJSON(path.join(out, "strategy-edge.json"));
  const edge = {};
  for (const r of (edgeFile && edgeFile.rows) || []) edge[r.id] = r;

  const rowBy = {};
  for (const r of summary.rows) rowBy[r.s] = r;
  const nameOf = (s) => (rowBy[s] && (rowBy[s].en || rowBy[s].ar)) || s;

  /* الترتيب من `ranking.top` حين يوجد، وإلا من الملخّص بقيمته السوقية
     — والملخّص مرتَّبٌ بها أصلاً. وتُستبعد الكريبتو: «أكبر الشركات
     الأمريكية» لا تشمل بيتكوين. */
  const rankTop = (ranking.top && ranking.top.length)
    ? ranking.top
    : summary.rows.filter(r => r.mkt !== "crypto").map(r => r.s);
  const { syms, merged } = pickTop(rankTop.filter(s => rowBy[s] && rowBy[s].mkt !== "crypto"),
                                   cik, nameOf, TOP_N);

  /* بديلُ المؤشّر: من `market.bench` حين يوجد (يكتبه `fetch-market`)،
     وإلا من `market.indices` بحقل `proxy`. والملفّ شرطُ وجود: بلا
     شمعاتٍ لا تحليل، فيُقال ذلك ولا يُعرض صفٌّ فارغ. */
  const benchList = (market.bench && market.bench.length)
    ? market.bench
    : (market.indices || []).filter(i => i.proxy)
        .map(i => ({ s: i.proxy, idx: i.s, ar: i.ar, en: i.en }));
  const bench = benchList.find(b => b.idx === "^GSPC") || benchList[0] || null;

  const jobs = [];
  if (bench) jobs.push({ s: bench.s, bench: true, meta: bench });
  for (const s of syms) jobs.push({ s, bench: false, meta: null });

  const rows = [];
  let missing = 0;
  for (const j of jobs) {
    const rec = readJSON(path.join(out, "sym", `${j.s}.json`));
    if (!rec || !rec.an) { missing++; continue; }
    // الشمعات مضغوطة على القرص — درسٌ موثّق: نسيانُ الفكّ ينهار على
    // `x.c.toFixed` ولا يظهر إلا بعد أن يوجد ملفٌّ سابق فعلاً
    for (const o of Object.values(rec.tf || {})) if (o && o.c) o.c = require(path.join(ROOT, "stocks/plan.js")).unpackK(o.c);

    const mkt = rec.mkt || null;
    const sess = sessionOf(now, mkt);
    const win = currentWindow(now, mkt);
    /* الصفّ للبديل غيرُ موجود في الملخّص عمداً، فيُركَّب من المؤشّر
       نفسه: السعر والتغيّر من `market.indices` حيث يعيش `^GSPC`. */
    const idxRow = j.bench
      ? (market.indices || []).find(i => i.s === (j.meta && j.meta.idx))
      : null;
    const d1 = (rec.tf && rec.tf["1d"] && rec.tf["1d"].c) || [];
    const lastC = d1.length ? d1[d1.length - 1].c : null;
    const row = rowBy[j.s] || {
      s: j.s, ar: (j.meta && j.meta.ar) || j.s, en: (j.meta && j.meta.en) || j.s,
      sec: "مؤشر", p: lastC, chg: idxRow ? idxRow.chg : null,
      w52h: null, w52l: null
    };

    const byTf = {};
    let alignLeg = null, at = null;
    for (const tf of TFS) {
      const { legs } = legsFor(rec, row, tf, now, sess, win, mkt);
      const regime = C.marketRegime(rec.an);
      byTf[tf] = tfDir(legs, edge, regime);
      for (const l of legs) if (l.active && l.at && (at === null || l.at < at)) at = l.at;
    }
    /* `tfAlign` بلا تثبيت — حكمُه عابرٌ للفريمات فيُقرأ مرّةً واحدة
       على مستوى الأصل. وهذا هو موضعُه الصحيح: لا في عمود، ولا مكرَّراً
       في الثلاثة. */
    {
      const c = S.buildCtx({ rec, row, now, px: row.p, sess, win,
                             sessOf: (t) => sessionOf(t, mkt) });
      const r = S.evalStrategy(S.STRAT_BY_ID.tfAlign, c);
      alignLeg = (r && r.dir && r.active) ? { dir: r.dir, sc: r.sc } : null;
    }

    const all = assetDir(byTf, alignLeg);
    rows.push({
      s: j.s, bench: j.bench, ...(j.bench && j.meta ? { idx: j.meta.idx } : {}),
      ar: row.ar, en: row.en,
      tf: byTf, align: alignLeg, all,
      at: at === null ? null : at,
      stale: !!rec.stale
    });
  }

  if (!rows.length) throw new Error("لم يُقرأ أصلٌ واحد — لا يُكتب فوق بياناتٍ سليمة");

  const mkt = marketDir(rows);
  const status = statusNow(null, now);

  return {
    updated: now, priceAt: summary.updated || now,
    tfs: TFS,
    weights: { tf: Object.fromEntries(TFS.map(t => [t, TF_W[t]])), align: ALIGN_W,
               bench: BENCH_W, oppMin: OPP_MIN, full: F.SCS_FULL, floor: F.SCS_FLOOR },
    bands: { strong: F.DIR_STRONG, on: F.DIR_ON },
    top: TOP_N, merged, missing,
    status: status && status.state,
    market: mkt,
    rows
  };
}

export function writeOut(res, out = OUT) {
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, "market-dir.json");
  /* بوابةُ السلامة على **عدد الأصول**: القسم ثابتُ الحجم (بديلٌ +
     خمس عشرة)، فتقلّصُه يعني ملفاتِ رموزٍ لم تُقرأ لا سوقاً هادئة.
     وهي نفس قاعدة «لا تُكتب بيانات فوق بيانات سليمة عند الفشل». */
  const prev = readJSON(file);
  if (prev && Array.isArray(prev.rows) && res.rows.length < prev.rows.length * 0.7)
    throw new Error(`تقلّص عدد الأصول ${prev.rows.length} ← ${res.rows.length} — لن نكتب`);
  fs.writeFileSync(file, JSON.stringify(res));
  return fs.statSync(file).size;
}

/* =====================================================================
   الفحص الذاتي
   ===================================================================== */
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function selftest() {
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n} — ${e.message}`); fail++; } };
  const eq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b);
                            if (x !== y) throw new Error(`${m}: ${x} ≠ ${y}`); };
  const ok = (c, m) => { if (!c) throw new Error(m); };

  console.log("\n▶ فحص توجّه السوق (بلا شبكة)\n");

  t("الفريمات ثلاثة ولا ‎15د‎ فيها", () => {
    eq(TFS, ["1h", "4h", "1d"], "الفريمات");
    for (const s of ["1m", "3m", "5m", "15m"])
      if (TFS.includes(s)) throw new Error(`${s} تسرّب إلى فريمات توجّه السوق`);
  });

  t("أوزان الفريمات مستوردة لا مكتوبة — واليوميّ أعلاها", () => {
    // لو نُسخت هنا لاختلفت عن النتيجة الفنية بأول تعديل هناك
    ok(TF_W === SC.TF_WEIGHT, "TF_W هي TF_WEIGHT نفسها لا نسخة");
    ok(TF_W["1d"] > TF_W["4h"] && TF_W["4h"] > TF_W["1h"], "الترتيب المطلوب");
  });

  t("فئتا أسهمٍ لشركةٍ واحدة تُدمجان بالهوية لا بالاسم", () => {
    const cik = { GOOGL: "0001652044", GOOG: "0001652044", AAPL: "0000320193",
                  MSFT: "0000789019", BRK_B: "0001067983" };
    const r = pickTop(["NVDA", "AAPL", "GOOGL", "GOOG", "MSFT"], cik, () => "", 4);
    eq(r.syms, ["NVDA", "AAPL", "GOOGL", "MSFT"], "GOOG يسقط وMSFT يدخل مكانه");
    eq(r.merged, ["GOOG"], "والمدموج يُعلَن لا يُبتلع");
    // بلا خريطة هوية: البادئة النصّية بديلٌ يعمل
    const r2_ = pickTop(["GOOGL", "GOOG", "MSFT"], null,
                        (s) => s === "MSFT" ? "Microsoft" : "Alphabet Inc. (Class C)", 2);
    eq(r2_.syms, ["GOOGL", "MSFT"], "البادئة تعمل حين لا هوية");
  });

  t("العدد يُستكمل بعد الدمج لا يَنقص", () => {
    const cik = { A: "1", B: "1", C: "2", D: "3", E: "4" };
    const r = pickTop(["A", "B", "C", "D", "E"], cik, () => "", 3);
    eq(r.syms.length, 3, "ثلاثة فعلاً لا اثنان");
    eq(r.syms, ["A", "C", "D"], "والمتاح بعد الدمج");
  });

  t("ساقُ محرّك الفرص تمرّر المقدار لا الإشارة", () => {
    /* `consensusOf` تحسب الكتلة `w × sc/100`، فـ`sc` سالبة تعطي كتلةً
       سالبة تُطرح من جهتها — فتُقلب الإشارة مرّتين ويصير السهم الهابط
       صاعداً. الجهة من `dir` وحدها. */
    const rec = { an: { "1h": { score: -80 } }, tf: {} };
    const { legs } = legsFor(rec, { s: "X", p: 10 }, "1h", Date.now(), "CLOSED", null, null);
    const o = legs.find(l => l.id === "opps");
    eq(o.dir, -1, "الجهة هابطة");
    eq(o.sc, 80, "والمقدار موجب");
    ok(o.sc > 0, "sc لا تكون سالبة أبداً");
  });

  t("عتبة «للفريم جهة» هي عتبة allTF نفسها", () => {
    const mk = (sc) => legsFor({ an: { "1d": { score: sc } }, tf: {} },
                               { s: "X", p: 10 }, "1d", Date.now(), "CLOSED", null, null)
                       .legs.find(l => l.id === "opps");
    eq(OPP_MIN, 15, "العتبة 15 كما في scans.js");
    eq(mk(16).dir, 1, "فوقها لها جهة");
    eq(mk(15).dir, 0, "وعندها بالضبط لا جهة — كما allTF");
    eq(mk(-16).dir, -1, "وهبوطاً كذلك");
    eq(mk(14).active, false, "وما دونها لا يتفعّل");
  });

  t("الفريم بلا قراءة يخرج من البسط والمقام معاً", () => {
    /* لو بقي في المقام لخرجت نسبةُ أصلٍ بفريمٍ واحد أقلَّ من نسبة أصلٍ
       بثلاثة رغم تطابق قراءتهما — فيقيس الرقمُ اكتمالَ البيانات لا
       قوّة التوجّه. */
    const full = assetDir({ "1h": { scs: 1 }, "4h": { scs: 1 }, "1d": { scs: 1 } }, null);
    const one = assetDir({ "1h": { scs: 1 }, "4h": { scs: null }, "1d": null }, null);
    eq(full.pct, 100, "الثلاثة");
    eq(one.pct, 100, "وواحدٌ بنفس القراءة يعطي نفس النسبة");
    eq(one.legs, 1, "والعدد وحده يقول إنها أقلُّ معلوميةً");
    eq(assetDir({}, null).pct, null, "ولا شيء يعطي — لا صفراً");
  });

  t("اليوميّ يزن أكثر فعلاً — لا بالنيّة", () => {
    // ساعةٌ صاعدة تماماً ويوميٌّ هابطٌ تماماً: النتيجة تتبع اليوميّ
    const a = assetDir({ "1h": { scs: 1 }, "4h": { scs: 0 }, "1d": { scs: -1 } }, null);
    eq(a.dir, -1, "اليوميّ يغلب الساعة");
    // والعكس بنفس المقدار: تماثلٌ لا تحيّز
    const b = assetDir({ "1h": { scs: -1 }, "4h": { scs: 0 }, "1d": { scs: 1 } }, null);
    eq(b.dir, 1, "والعكس كذلك");
    eq(a.pct, b.pct, "وبنفس القوّة — لا تحيّز اتجاهي");
  });

  t("tfAlign ساقٌ رابعة بوزن الساعة لا أكثر", () => {
    eq(ALIGN_W, TF_W["1h"], "وزنُه أدنى وزنٍ في الجدول — حافّته سالبة مقيسة");
    const without = assetDir({ "1d": { scs: 1 } }, null);
    const withA = assetDir({ "1d": { scs: 1 } }, { dir: -1, sc: 100 });
    ok(withA.pct < without.pct, "ساقٌ مخالفة تخفض النسبة");
    eq(withA.legs, 2, "وتُعدّ ساقاً");
  });

  t("المؤشّر يزن أكثر من السهم المفرد", () => {
    const rows = [
      { bench: true, all: { dir: -1, scs: -1, pct: 100 } },
      { bench: false, all: { dir: 1, scs: 1, pct: 100 } },
      { bench: false, all: { dir: 1, scs: 1, pct: 100 } }
    ];
    const m = marketDir(rows);
    eq(BENCH_W, 3, "وزن المؤشّر ثلاثة");
    eq(m.dir, -1, "مؤشّرٌ هابط يغلب سهمين صاعدين");
    eq(m.counts, { up: 2, flat: 0, dn: 1 }, "والعدّاد يصف الأصول لا الوزن");
  });

  t("نسبة التوافق مقامُها ذواتُ الجهة لا الكلّ", () => {
    /* لو دخل المحايد المقام لانخفضت النسبة كلّما هدأ السوق — فتقيس
       الهدوء لا الاتفاق، وهما سؤالان مختلفان. */
    const rows = [
      { bench: false, all: { dir: 1, scs: 0.9, pct: 90 } },
      { bench: false, all: { dir: 1, scs: 0.9, pct: 90 } },
      { bench: false, all: { dir: 0, scs: 0, pct: 0 } },
      { bench: false, all: { dir: 0, scs: 0, pct: 0 } }
    ];
    eq(marketDir(rows).agree, 1, "اتفاقٌ تامّ بين ذوات الجهة");
  });

  t("التعارض لا يُعطى جهة — والحدّ هو حدّ الإجماع نفسه", () => {
    const mk = (dnSc) => tfDir([
      { id: "a", fam: "trend", dir: 1, sc: 100, active: true },
      { id: "b", fam: "revert", dir: 1, sc: 100, active: true },
      { id: "c", fam: "vol", dir: -1, sc: dnSc, active: true }
    ], {}, null);
    /* الحدّ كتلةٌ لا عدد: إشارتان مقابل واحدة **ليست** تعارضاً
       (‎1/3 = 33%‎ دون ‎35%‎)، والثالثة تصير تعارضاً حين تقوى كتلتُها.
       وهذا هو المقصود بـ«الوزن لا العدّ» — والاختبار يمرّ بالحدّ
       من الجهتين كي لا يمرّ بالصدفة. */
    eq(C.MIX_SHARE, 0.35, "الحدّ من `consensus.js` لا رقمٌ محلّي");
    const below = mk(100);          // 1.0 / 3.0 = 33.3% — دون الحدّ
    eq(below.mixed, false, "ثلثٌ مخالف دون الحدّ ⇒ جهةٌ قائمة");
    eq(below.dir, 1, "والجهة للأغلبية");
    const above = mk(100 * 1.2);    // كتلةٌ أكبر ⇒ فوق الحدّ
    const heavy = tfDir([
      { id: "a", fam: "trend", dir: 1, sc: 100, active: true },
      { id: "b", fam: "revert", dir: 1, sc: 100, active: true },
      { id: "c", fam: "vol", dir: -1, sc: 100, active: true },
      { id: "d", fam: "session", dir: -1, sc: 60, active: true }
    ], {}, null);
    eq(heavy.mixed, true, "كتلةٌ مخالفة فوق الحدّ ⇒ متعارض");
    eq(heavy.dir, 0, "ولا جهة");
    eq(heavy.pct, 0, "ونسبةٌ صفر **معلنة** لا null — «قِيس فخرج متعارضاً»");
    ok(above !== null, "");
  });

  t("«متعذّرة» تُعدّ ولا تُحشى محايدة", () => {
    const legs = [
      { id: "a", fam: "trend", dir: 1, sc: 90, active: true },
      { id: "b", fam: "session", dir: 0, sc: null, active: false, off: "استراتيجيةُ جلسة" },
      { id: "c", fam: "trend", dir: 0, sc: null, active: false, off: "حكمٌ عابر" }
    ];
    const d = tfDir(legs, {}, null);
    eq(d.off, 2, "العدد يُقال");
    eq(d.on, 1, "والعامل كذلك");
    eq(d.dir, 1, "والمتعذّرة لا تخفض الجهة");
  });

  t("المنفردة أضعفُ من الاثنتين أضعفُ من الثلاث — ترتيبٌ يجب أن يصمد", () => {
    /* انكسر فعلاً بقيمةٍ أولى لـ`SCS_FLOOR`: إشارةٌ منفردة نقيّة خرجت
       بـ‎+11‎ نقطة وخمسُ استراتيجيات بينها خلافٌ يسير بـ‎+9‎، فقرأ
       الصفّان مقلوبين على الشاشة. والرقم كان صحيحاً حسابياً وكاذباً
       دلالةً — يقيس نقاء الاتفاق لا اتّساعه.

       والشرط ليس ذوقاً: `consensusOf` نفسها تشترط ثلاثاً للثقة
       العالية، فالرقم يجب أن يوافق الوسم الذي يقوله النظام عن نفسه. */
    const mk = (n) => {
      const legs = Array.from({ length: n }, (_, i) => ({
        id: "s" + i, lbl: "s", fam: ["trend", "revert", "vol", "session"][i % 4],
        dir: 1, sc: 100, active: true }));
      while (legs.length < 11) legs.push({ id: "q" + legs.length, dir: 0, sc: null, active: false });
      return F.scsFrom(C.consensusOf(legs, {})).scs;
    };
    const one = mk(1), two = mk(2), three = mk(3), five = mk(5);
    ok(one < two && two < three, `الترتيب انكسر: ${one} / ${two} / ${three}`);
    eq(three, five, "وثلاثٌ فأكثر تبلغ السقف — التغطية تشبع عند حدّ الثقة");
    ok(one < 0.65, `المنفردة ${one} قريبةٌ من الإجماع أكثر مما ينبغي`);
  });

  t("حدّا الوسم مشتقّان من حدود الثقة لا مكتوبَين", () => {
    /* ولا يُثبَّت الرقمان: اختبارٌ يثبّت رقماً يُسقط نفسه عند أوّل تعديل
       فيدفع إلى تخفيفه بدل قراءته — مصيدة موثّقة وقعت ثلاث مرّات. يُفحص
       **الاشتقاق**: «صاعد» يبدأ عند صافي الاتفاق الذي تسمّيه آلةُ
       الإجماع ثقةً عالية، فلو تحرّك `CONF_HI` تحرّك معه الوسم. */
    eq(F.DIR_ON, Math.round((2 * C.CONF_HI - 1) * 100), "«صاعد» = صافي CONF_HI");
    ok(F.DIR_STRONG > F.DIR_ON, "و«قوي» فوقه");
    ok(F.DIR_STRONG < 100, "ودون التمام — وإلا لم يُوسَم شيءٌ قوياً");
    // والحدّ الأدنى يجب أن يفوق التعادل بهامش، وإلا سُمّي الضجيجُ اتجاهاً
    ok(F.DIR_ON > 50, "عتبةُ «له جهة» فوق التعادل");
  });

  t("الوسم يتبع النسبة فلا يظهر «صاعد قوي 40%»", () => {
    eq(F.dirLabelOf(1, 90).t, "صاعد قوي", "");
    eq(F.dirLabelOf(1, 60).t, "صاعد", "");
    eq(F.dirLabelOf(1, 40).t, "محايد", "نسبةٌ ضعيفة ⇒ محايد مهما كانت الجهة");
    eq(F.dirLabelOf(0, 90).t, "محايد", "وبلا جهة ⇒ محايد مهما كانت النسبة");
    eq(F.dirLabelOf(-1, 90).t, "هابط قوي", "");
  });

  t("التثبيت يغيّر الفريم المقروء فعلاً — على بياناتٍ حقيقية", () => {
    const f = path.join(ROOT, "data/sym/NVDA.json");
    const g = path.join(ROOT, "data/summary.json");
    if (!fs.existsSync(f) || !fs.existsSync(g)) { console.log("      (لا بيانات محلية — تُخطّى)"); return; }
    const rec = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const o of Object.values(rec.tf || {})) if (o && o.c)
      o.c = require(path.join(ROOT, "stocks/plan.js")).unpackK(o.c);
    const row = JSON.parse(fs.readFileSync(g, "utf8")).rows.find(r => r.s === "NVDA");
    const now = Date.now();
    const seen = {};
    for (const tf of TFS) {
      const { legs } = legsFor(rec, row, tf, now, "CLOSED", null, null);
      // كلُّ ساقٍ عاملة يجب أن تكون قد قُرئت على الفريم المطلوب
      const o = legs.find(l => l.id === "opps");
      seen[tf] = o.sc;
      // واستراتيجيات الجلسة والحكم العابر متعذّرة على كل هذه الفريمات
      for (const id of ["orb", "vwapRec", "tfAlign"])
        ok(legs.find(l => l.id === id).off, `${id} يجب أن يكون متعذّراً على ${tf}`);
    }
    // ثلاث قراءات من ثلاثة فريمات: تطابقُها التامّ يعني أن التثبيت لم يعمل
    const vals = TFS.map(t => seen[t]);
    ok(new Set(vals).size > 1 || vals.every(v => v === null),
       `نتيجة محرّك الفرص متطابقة على الفريمات الثلاثة (${vals.join("/")}) — التثبيت لا يعمل`);
  });

  t("بوابةُ السلامة ترفض تقلّص الأصول", () => {
    const dir = fs.mkdtempSync(path.join(ROOT, ".mdtest-"));
    try {
      fs.writeFileSync(path.join(dir, "market-dir.json"),
        JSON.stringify({ rows: Array.from({ length: 16 }, (_, i) => ({ s: "S" + i })) }));
      let threw = false;
      try { writeOut({ rows: [{ s: "A" }, { s: "B" }] }, dir); } catch { threw = true; }
      ok(threw, "التقلّص إلى الثُمن يجب أن يُرفض");
      // وتقلّصٌ طفيف مشروع (رمزٌ واحد بلا ملف) يمرّ
      writeOut({ rows: Array.from({ length: 15 }, (_, i) => ({ s: "S" + i })) }, dir);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
  return fail;
}

if (IS_MAIN) {
  if (CHECK) process.exit(selftest() ? 1 : 0);
  const res = run(OUT);
  const size = writeOut(res, OUT);
  const m = res.market;
  const lb = F.dirLabelOf(m.dir, m.pct);
  console.log(`▶ توجّه السوق: ${lb.t} ${m.pct}% · ${res.rows.length} أصلاً ` +
              `(${m.counts.up}▲ ${m.counts.flat}⇄ ${m.counts.dn}▼) · ` +
              `توافق ${Math.round((m.agree || 0) * 100)}% · ${(size / 1024).toFixed(1)} ك.ب`);
  if (res.merged.length) console.log(`  فئاتُ أسهمٍ مدموجة: ${res.merged.join("، ")}`);
  if (res.missing) console.log(`  ⚠ ${res.missing} أصلاً بلا ملفّ رمز`);
}
