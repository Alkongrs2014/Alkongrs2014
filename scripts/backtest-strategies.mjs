#!/usr/bin/env node
/* =====================================================================
   الأرشيف اللحظي — قياس حافّة كل استراتيجية على بياناتٍ حقيقية.

   لماذا أرشيفٌ ثانٍ ولا يكفي `backtest.mjs`: ذاك يملك الشمعات اليومية
   وحدها على عشر سنوات، و`orb` و`vwapRec` لا وجود لهما فيه إطلاقاً —
   نطاقُ الافتتاح وVWAP الجلسة لا يُشتقّان من شمعةٍ يومية. فبلا هذا
   الملفّ تبقى استراتيجيتان بلا قياسٍ أبداً، لا بلا قياسٍ بعد.

   ---------------------------------------------------------------------
   **الحدّ المعلن: ستون يوم تداول.**

   وهو أقصى ما يعطيه ياهو لفريم ‎15د‎ — حدُّ المصدر لا اختيارُنا. وستون
   يوماً تغطّي حالةَ سوقٍ واحدة غالباً، فالرقم الخارج منها يصف تلك
   الحالة وقد لا يعمّ. يُكتب بجانب كل رقم في المخرَج وتعرضه الواجهة،
   **ولا يُقارن برقم الأرشيف اليومي** (عشر سنوات) كأنهما نفس الشيء.

   ---------------------------------------------------------------------
   ولا يُعاد اختراع شيء: `simulatePlan` و`summarizePlans` تُستوردان من
   `backtest.mjs` كما هما، بقواعدهما الستّ — المسير من الشمعة التالية،
   والوقف يغلب الهدف في الشمعة الواحدة، والفجوة تُنفَّذ عند الفتح،
   والدخول المعلَّق عند مستواه، وثلاثة مقامات، وثلاث سياسات خروج.
   ونموذج التكلفة من `lib/costs.mjs` نفسه. نسختان تجعلان السجلَّ الحيّ
   يُقارَن بأرشيفٍ يقيس شيئاً آخر — وهي علّة `plan.js` بعينها.

   والتاريخ **في الذاكرة ولا يُخزَّن**: خمسون ألف شمعةٍ لكل رمز تُنشر
   بلا أن يقرأها أحد، ومخرَجُ هذا الملفّ بضعة كيلوبايتات.
   ===================================================================== */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { fetchChart } from "./lib/yahoo.mjs";
import { isRegularBar } from "./lib/session.mjs";
import { simulatePlan, summarizePlans } from "./backtest.mjs";
import { COSTS } from "./lib/costs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, "stocks/strategies.js"));
const C = require(path.join(ROOT, "stocks/consensus.js"));
const IND = require(path.join(ROOT, "stocks/indicators.js"));
const SC = require(path.join(ROOT, "stocks/score.js"));
const PLAN = require(path.join(ROOT, "stocks/plan.js"));

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const OUT = (() => { const i = args.indexOf("--out"); return i >= 0 ? path.resolve(args[i + 1]) : path.join(ROOT, "data"); })();
const LIMIT = Number(process.env.SBT_LIMIT || 0);       // لتجربةٍ سريعة

/* حدّ العيّنة: ما دونه `edge: null` ولا يُعرض رقم. مئتان هي نفس حدّ
   التركيبات في `backtest.mjs` — رقمٌ تحت المئتين يقيس الحظّ. */
const MIN_N = 200;
const OOS_FRAC = 0.3;
const WARMUP = 210;                     // EMA200 بهامش
const COOLDOWN = 8;                     // شمعات — تمنع عدّ نفس الإشارة مراراً
const SIM_BARS = 60;
/* ‎5د‎ أُزيل من المشروع كلِّه، فسقط من هنا كذلك — والأرشيف يجب أن يقيس
   ما يُعرض حرفياً، وإلا شهد لاستراتيجيةٍ بحافّةٍ تخصّ فريماً لا يراه
   المستخدم. ومعنى ذلك أن حافّتَي `orb` و`vwapRec` **تُعاد قياسهما من
   الصفر** على ‎15د‎ ولا تُنقلان عن القياس القديم. */
const RANGES = { "15m": "60d", "1h": "730d", "1d": "5y" };

const r2 = (v) => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
const med = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

/* =====================================================================
   السلاسل تُحسب **مرّة** لكل فريم ثم تُقرأ بالفهرس.

   الكتابة البديهية أن يُنادى `analyze` على شريحةٍ متنامية عند كل شمعة،
   وكلفتُها تربيعية: قِيس فعلاً — رمزٌ واحد تجاوز دقيقتين، فتسعون رمزاً
   ثلاث ساعات. وهي المصيدة التي يوثّقها `backtest.mjs` بالحرف («تُحسب
   السلاسل مرة ثم تُستدعى الدالّة لكل نقطة»)، ووقعتُ فيها ثم أُصلحت.

   والنتيجة يجب أن تبقى **مطابقة** لما يعطيه `analyze` — وهذا شرطُ
   قبولٍ يفحصه `--check` بمقارنةٍ ذهبية عند شمعاتٍ مختارة.
   ===================================================================== */
export function seriesOf(k) {
  const c = k.map(x => x.c), h = k.map(x => x.h), l = k.map(x => x.l);
  const v = k.map(x => x.v || 0);
  const hasVol = v.filter(x => x > 0).length >= Math.min(30, k.length * 0.5);
  const m = IND.macd(c), b = IND.bb(c, 20, 2), ax = IND.adx(h, l, c, 14);
  const sk = IND.stoch(h, l, c, 14, 3);
  return { k, c, h, l, v, hasVol,
    e20: IND.ema(c, 20), e50: IND.ema(c, 50), e200: IND.ema(c, 200),
    rsi: IND.rsi(c, 14), hist: m.hist, atr: IND.atr(h, l, c, 14),
    bbUp: b.up, bbLo: b.lo, bbMid: b.mid,
    adx: ax.adx, pdi: ax.pdi, mdi: ax.mdi, bbw: IND.bbWidth(c, 20, 2),
    mfi: hasVol ? IND.mfi(h, l, c, v, 14) : [],
    stochK: sk.k, stochD: sk.d, obv: hasVol ? IND.obv(c, v) : null };
}

/* قراءةُ المؤشّرات عند شمعةٍ بعينها — نفس حقول `analyze` وبنفس قيمها */
export function anAt(S, j) {
  if (j < 0 || j >= S.c.length) return null;
  const g = (a) => (a && j < a.length && Number.isFinite(a[j])) ? a[j] : null;
  const hist = g(S.hist);
  let histPrev = null;
  if (hist !== null) for (let q = j - 1; q >= 0 && q > j - 8; q--)
    if (Number.isFinite(S.hist[q])) { histPrev = S.hist[q]; break; }
  const o = {
    px: S.c[j], e20: g(S.e20), e50: g(S.e50), e200: g(S.e200), rsi: g(S.rsi),
    hist, histPrev,
    histRising: (hist !== null && histPrev !== null) ? hist > histPrev : false,
    atr: g(S.atr), bbUp: g(S.bbUp), bbLo: g(S.bbLo), bbMid: g(S.bbMid),
    adx: g(S.adx), pdi: g(S.pdi), mdi: g(S.mdi), bbw: g(S.bbw),
    mfi: g(S.mfi), stochK: g(S.stochK), stochD: g(S.stochD), div: null
  };
  o.score = SC.scoreFrom(o);
  /* ميل التراكم على عشرين شمعة — نفس حساب `analyze` بالضبط */
  if (S.obv && j >= 21) {
    const d0 = S.obv[j - 20], d1 = S.obv[j];
    if (Number.isFinite(d0) && Number.isFinite(d1)) {
      const scale = Math.max(1, Math.abs(d0) || 1);
      o.obvSlope = (d1 - d0) / scale * 100;
    }
  }
  return o;
}

/* التباعد وحده يُحسب على نافذةٍ محدودة عند الشمعة المرشَّحة: هو مسحٌ
   لقممٍ وقيعان لا سلسلةٌ متدحرجة، ونافذتُه ‎60‎ شمعة أصلاً — فحسابُه
   على كامل السابق هدرٌ بلا فرق في الناتج. */
const DIV_WIN = 160;
function divAt(S, j) {
  if (j < 40) return null;
  const a = Math.max(0, j - DIV_WIN);
  const dv = IND.divergence(S.h.slice(a, j + 1), S.l.slice(a, j + 1),
                            S.rsi.slice(a, j + 1), S.atr.slice(a, j + 1), { lookback: 60 });
  return (dv && dv.length) ? { dir: dv[0].dir, bars: dv[0].bars, kind: dv[0].kind } : null;
}

/* نافذةُ شمعاتٍ تكفي كلَّ ما تقرؤه الاستراتيجيات: أطولُ نظرةٍ إلى
   الوراء هي جلسةُ يومٍ كاملة على ‎5د‎ (78 شمعة) و`levelsFrom` (120).
   فثلاثمئة تكفي بهامش، وتجعل الكلفة ثابتة لكل شمعة بدل أن تنمو. */
const WIN = 300;

/* سياقُ التقييم عند شمعةٍ — يُجمَّع من السلاسل المحسوبة لا يُعاد حسابه */
function ctxAt(SS, cur, meta) {
  const k = {}, an = {}, bw = {};
  for (const [tf, S] of Object.entries(SS)) {
    const j = cur[tf];
    if (j === undefined || j < 30) continue;
    const a = anAt(S, j);
    if (!a) continue;
    an[tf] = a;
    k[tf] = S.k.slice(Math.max(0, j - WIN), j + 1);
    if (j >= 40) bw[tf] = S.bbw.slice(Math.max(0, j - 160), j + 1);
  }
  if (!an[meta.tf]) return null;
  const px = an[meta.tf].px, tEnd = SS[meta.tf].k[cur[meta.tf]].t;
  // نفس نافذة `buildCtx` بالضبط: ثلاثون دقيقة على ‎15د‎. اختلافُهما
  // يجعل الأرشيف يقيس نطاقَ افتتاحٍ غير الذي يعرضه التطبيق.
  const lv = { iTf: k["15m"] ? "15m" : null };
  if (lv.iTf && meta.period) {
    lv.vwap = IND.sessionVwap(k[lv.iTf], meta.period);
    lv.or = IND.openingRange(k[lv.iTf], meta.period, 30);
  }
  const d = k["1d"] || k["1h"];
  lv.L = d ? PLAN.levelsFrom({ k4h: k["4h"], k1d: d, px,
    a: an["4h"] || an["1d"] || an[meta.tf], w52h: meta.w52h, w52l: meta.w52l, now: tEnd }) : null;
  const tfScore = {};
  for (const tf of SC.TFS) if (an[tf] && Number.isFinite(an[tf].score)) tfScore[tf] = an[tf].score;
  return { s: meta.s, px, now: tEnd, k, an, bw, lv, period: meta.period, today: true,
           /* `win` — **النافذة الجارية، وغيابُها كان يقتل استراتيجيتَي
              الجلسة في الأرشيف بصمت.**

              `buildCtx` تشتقّها من التقويم وتسقط إلى `period.regular`،
              و`orb`/`vwapRec` تشترطانها (`if (!c.win) return …`). وهذا
              السياق لم يكن يضعها قط — فكانتا تخرجان `off` عند **كل**
              شمعة، وتظهران في الملفّ بـ`n: 0` و`edge: null`.

              ولم يظهر ذلك لأن الملفّ احتفظ بأرقامٍ قديمة: قِيست
              ‎45,481‎ و‎28,673‎ حالة في بناءٍ سابق **قبل** إضافة الحارس،
              فبقيت معروضةً وموزوناً بها الإجماع بينما صار قياسُها
              مستحيلاً. رقمٌ صحيحٌ يوماً ما، ويصف نظاماً لم يعد قائماً. */
           win: (meta.period && meta.period.regular) || null,
           /* `ian` و`ik` — **السلسلة الجارية ومؤشّراتها**، وغيابُهما كان
              يكمل ما بدأه غيابُ `win`.

              `buildCtx` تفرّق بين الرسمية والممتدة (`ik = extSess && kx
              ? kx : k`) وتعطي `ian` مؤشّراتِ ما اختير. والأرشيف بلا
              جلسةٍ ممتدة أصلاً، فهما `k` و`an` نفسهما — لكن **الاسم
              الغائب لا يُقرأ مرادفاً**: `c.ian[...]` على `undefined`
              ترمي، فيُبتلع الاستثناء وتخرج الاستراتيجية «بلا جهة» عند
              كل شمعة.

              وهي ما أبقى `orb` و`vwapRec` على صفرٍ حتى بعد إصلاح
              `win`: حقلان ناقصان لا حقلٌ واحد. */
           ik: k, ian: an, kx: {}, anx: {}, extSess: false, extAge: null,
           mkt: meta.mkt || null, wide: false,
           /* `sessOf` — بها يقارن `volRatio` حجمَ الشمعة بوسيط شمعاتٍ
              **من نفس نوع الجلسة**. والأرشيف يرشّح إلى الجلسة الرسمية
              وحدها قبل القياس، فكلُّ شمعةٍ فيه رسمية. وتمريرُ دالّةٍ
              ثابتة أصدقُ من تركها غائبةً: الغائبة تُسقط خطّ الأساس،
              والثابتة تصف الحقيقة. */
           sessOf: () => "REGULAR",
           sess: "REGULAR", row: { s: meta.s, p: px, w52h: meta.w52h, w52l: meta.w52l },
           /* `src` — وسائطُ البناء التي تعيد `confirmBase` منها سياقَ
              التأكيد. والأرشيف يقيس عند **إغلاق** كل شمعة أصلاً، فلا
              شمعةَ جارية فيه ولا معنى لتأكيدٍ ثانٍ: تُترك `null` فتردّ
              `confirmCtx` «متعذّر» بصوتٍ عالٍ لو نُوديت هنا يوماً، بدل
              أن تتراجع صامتةً إلى سعرٍ غير مؤكَّد. والأرشيف ينادي
              `evalAll` لا `evalAllConfirmed`. */
           src: null,
           tfScore, f: null, _SS: SS, _cur: cur };
}

/* جلسةُ اليوم الذي تقع فيه شمعةٌ لحظية — تُشتقّ من الشمعات نفسها لا
   من `period` المحفوظ (وهو يصف يوم جلبه، مصيدة موثّقة). أول شمعةٍ في
   اليوم هي الافتتاح، وآخرها الإغلاق. */
function sessionsOf(k) {
  const by = new Map();
  for (const x of k) {
    const d = new Date(x.t);
    const key = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    const cur = by.get(key);
    if (!cur) by.set(key, { start: x.t, end: x.t });
    else { if (x.t < cur.start) cur.start = x.t; if (x.t > cur.end) cur.end = x.t; }
  }
  return by;
}
const dayKey = (t) => { const d = new Date(t);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); };

/* =====================================================================
   قياس رمزٍ واحد
   ===================================================================== */
export function measureSymbol(series, meta, acc) {
  const SS = {};
  for (const [tf, arr] of Object.entries(series))
    if (arr && arr.length >= 40) SS[tf] = seriesOf(arr);

  for (const st of S.STRATEGIES) {
    const tf = SS[st.tf] ? st.tf : (SS["15m"] ? "15m" : (SS["1h"] ? "1h" : "1d"));
    const base = SS[tf];
    if (!base || base.k.length < WARMUP + SIM_BARS + 10) continue;
    const sess = sessionsOf(base.k);
    /* مؤشّرٌ لكل فريم يتقدّم مع الزمن — الفهرسة بالبحث الخطّي عند كل
       شمعة تعيد الكلفة تربيعيةً من بابٍ آخر. */
    const cur = {}, ptr = {};
    for (const t of Object.keys(SS)) ptr[t] = 0;
    let last = -COOLDOWN;

    for (let i = WARMUP; i < base.k.length - SIM_BARS; i++) {
      const tEnd = base.k[i].t;
      for (const [t, S2] of Object.entries(SS)) {
        while (ptr[t] + 1 < S2.k.length && S2.k[ptr[t] + 1].t <= tEnd) ptr[t]++;
        cur[t] = (S2.k[ptr[t]] && S2.k[ptr[t]].t <= tEnd) ? ptr[t] : undefined;
      }
      cur[tf] = i;
      if (i - last < COOLDOWN) continue;

      const day = sess.get(dayKey(tEnd));
      const c = ctxAt(SS, cur, { ...meta, tf, period: day ? { regular: day } : null });
      if (!c) continue;
      /* التباعد يُحسب عند الشمعة المرشَّحة وحدها ولمن يقرؤه فقط:
         حسابُه لكل فريمٍ عند كل شمعة أغلى من بقيّة المؤشّرات مجتمعة. */
      if (st.id === "rsiDiv")
        for (const t of ["1h", "15m", "1d"])
          if (c.an[t] && cur[t] !== undefined) c.an[t].div = divAt(SS[t], cur[t]);

      const r = S.evalStrategy(st, c);
      if (!r.dir || !r.active) continue;
      const plan = S.planFor(c, r);
      if (!plan || plan.bad) continue;
      const sim = simulatePlan(base.k, i, plan, { maxBars: SIM_BARS, costs: COSTS });
      if (!sim) continue;
      last = i;
      const row = acc[st.id] ||= { id: st.id, tf, n: 0, sims: [], t: [], regime: {} };
      row.sims.push(sim); row.t.push(tEnd); row.n++;
      const reg = C.marketRegime(c.an);
      if (reg) (row.regime[reg] ||= []).push(sim);
    }
  }
  return acc;
}

/* =====================================================================
   الحافّة — التوقّع مطروحاً منه خط أساسٍ **مطابق للفترة**.

   مقارنةُ إشارةٍ ظهرت في فترةٍ بخط أساسٍ من فترةٍ أخرى تنسب إليها فرق
   السوقين لا فرق الشرط. ولذلك يُحسب خط الأساس من نفس مجموعة الشمعات.
   ===================================================================== */
function edgeOf(sims, baseExp) {
  const s = summarizePlans(sims);
  if (!s) return null;
  return { s, edge: Number.isFinite(s.exp) && Number.isFinite(baseExp) ? r2(s.exp - baseExp) : null };
}

export function splitOOS(rows, frac = OOS_FRAC) {
  /* الحدّ **زمني** لا بالرموز: قسمةُ الرموز تُبقي نفس الفترة في
     الجهتين فيتسرّب إليهما أثر السوق نفسه، والفترتان المختلفتان وحدهما
     تختبران الثبات عبر الزمن. */
  const ts = rows.map(r => r.t).filter(Number.isFinite).sort((a, b) => a - b);
  if (ts.length < 10) return { cut: null, ins: rows, oos: [] };
  const cut = ts[Math.floor(ts.length * (1 - frac))];
  return { cut, ins: rows.filter(r => r.t < cut), oos: rows.filter(r => r.t >= cut) };
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
  const sumFile = path.join(OUT, "summary.json");
  const rowsBy = {};
  if (fs.existsSync(sumFile))
    for (const r of JSON.parse(fs.readFileSync(sumFile, "utf8")).rows) rowsBy[r.s] = r;

  /* الطبقة المرصودة وحدها: الواسعة يوميّةٌ، وحافّتها اليومية مقيسةٌ
     أصلاً في `backtest.mjs` على عشر سنوات — وإعادةُ قياسها على ستين
     يوماً تستبدل عيّنةً كبيرة بصغيرة بلا مقابل. والكريبتو مستثنى كما
     في الأرشيف اليومي: تواريخه تحمل قفزاتٍ تُفسد الإحصاء. */
  let syms = (cfg.symbols || []).map(m => m.s).filter(s => rowsBy[s]);
  if (LIMIT) syms = syms.slice(0, LIMIT);

  console.log(`▶ الأرشيف اللحظي: ${syms.length} رمزاً · نافذة ${RANGES["15m"]} لِـ15د و${RANGES["1h"]} للساعة`);
  const acc = {};
  let ok = 0, failed = 0, bars = 0, req = 0;
  const errs = [];

  for (const sym of syms) {
    try {
      const series = {};
      for (const tf of ["15m", "1h", "1d"]) {
        const { candles: raw } = await fetchChart(sym, { range: RANGES[tf], interval: tf, prePost: false });
        /* نفس ترشيح `fetch-market`: الجلسة الرسمية وحدها. و`prePost: false`
           لا يكفي — ياهو يُرفق شمعةَ ‎16:00‎ (مطبعةُ الإغلاق) في بعض
           الأيام لبعض الرموز وليس كلِّها (قِيس: ABBV ‎18‎ يوماً من ‎60‎،
           وMSFT صفر). فالسلسلة المقيسة هنا كانت تختلف عن المعروضة في
           تلك الأيام وحدها — وهي بالضبط علّة «الأرشيف يقيس شرطاً غير
           الذي يُعرض». */
        const candles = tf === "1d" ? raw : raw.filter(c => isRegularBar(c.t));
        req++;
        if (candles && candles.length) { series[tf] = candles; bars += candles.length; }
      }
      if (series["1h"] && series["1h"].length > 40)
        series["4h"] = IND.aggregate(series["1h"], 4);
      if (!series["15m"] && !series["1h"]) { failed++; continue; }
      const r = rowsBy[sym] || {};
      measureSymbol(series, { s: sym, w52h: r.w52h, w52l: r.w52l }, acc);
      ok++;
      if (ok % 10 === 0) console.log(`  … ${ok}/${syms.length}`);
    } catch (e) {
      failed++;
      if (errs.length < 3) errs.push(`${sym}: ${e.message}`);
    }
  }
  if (!ok) throw new Error("لم يُقَس رمزٌ واحد — لا يُكتب فوق أرشيفٍ سليم" + (errs.length ? ` (${errs[0]})` : ""));

  /* خط الأساس: توقّعُ خططٍ تُفتح على شمعاتٍ عشوائية بنفس القواعد. وهو
     الرقم الذي تُطرح منه الحافّة — بدونه تصف الأرقامُ السوقَ لا الشرط. */
  const allSims = Object.values(acc).flatMap(r => r.sims);
  const baseSum = summarizePlans(allSims);
  const baseExp = baseSum ? baseSum.exp : null;

  const rows = [];
  let measured = 0, thin = 0;
  for (const st of S.STRATEGIES) {
    const a = acc[st.id];
    if (!a || !a.n) { rows.push({ id: st.id, src: "intraday", tf: st.tf, n: 0, edge: null,
                                  min: MIN_N, act: null, exp: null, med: null, win: null,
                                  stop: null, t1: null, oos: null, byRegime: null,
                                  why: "لم تظهر إشارةٌ واحدة في النافذة" }); continue; }
    const pairs = a.sims.map((s, i) => ({ ...s, t: a.t[i] }));
    const { cut, ins, oos } = splitOOS(pairs);
    const all = edgeOf(a.sims, baseExp);
    const insE = ins.length ? edgeOf(ins, baseExp) : null;
    const oosE = oos.length ? edgeOf(oos, summarizePlans(oos.map(x => x))?.exp === undefined ? baseExp : baseExp) : null;
    const enough = a.n >= MIN_N;
    if (enough) measured++; else thin++;
    const byRegime = {};
    for (const [k, v] of Object.entries(a.regime)) {
      if (v.length < 60) continue;                    // شريحةٌ رقيقة لا تُعرض
      const e = edgeOf(v, baseExp);
      if (e && Number.isFinite(e.edge)) byRegime[k] = e.edge;
    }
    rows.push({
      id: st.id, src: "intraday", tf: a.tf, range: RANGES["15m"],
      n: a.n, min: MIN_N,
      /* `edge: null` تعني **لم تُقَس** ولا تتحوّل صفراً في أي مستهلك.
         والعيّنة الرقيقة تُذكر بعددها: «جُرّبت وسقطت» معلومة. */
      edge: enough ? (all && all.edge) : null,
      why: enough ? null : `عيّنة تحت الحدّ (${a.n} من ${MIN_N})`,
      act: all && all.s ? all.s.actRate : null,
      exp: all && all.s ? all.s.exp : null,
      med: all && all.s ? all.s.med : null,
      win: all && all.s ? all.s.win : null,
      stop: all && all.s ? all.s.stop : null,
      t1: all && all.s && all.s.t ? all.s.t[0] : null,
      oos: (enough && oos.length >= Math.round(MIN_N * OOS_FRAC))
             ? { n: oos.length, edge: oosE && oosE.edge, exp: oosE && oosE.s ? oosE.s.exp : null }
             : null,
      oosCut: cut || null,
      byRegime: Object.keys(byRegime).length ? byRegime : null
    });
  }

  const out = {
    updated: Date.now(),
    window: { intraday: RANGES["15m"], hourly: RANGES["1h"] },
    symbols: ok, failed, bars, requests: req,
    baseline: baseSum ? { n: allSims.length, exp: baseSum.exp, actRate: baseSum.actRate } : null,
    costs: COSTS, minN: MIN_N, oosFrac: OOS_FRAC, simBars: SIM_BARS,
    note: "نافذةٌ قصيرة تغطّي حالة سوقٍ واحدة غالباً — لا تُقارَن بالأرشيف اليومي (عشر سنوات)",
    rows
  };
  fs.writeFileSync(path.join(OUT, "strategy-edge.json"), JSON.stringify(out));
  console.log(`✔ ${ok} رمزاً · ${bars.toLocaleString("en")} شمعة · ${req} طلباً · ` +
              `${measured} استراتيجية مقيسة و${thin} تحت حدّ العيّنة`);

  /* =====================================================================
     **صفرُ حالةٍ في مليون شمعة ليس ندرةَ سوق بل سياقاً مكسوراً.**

     استراتيجيةٌ «تحت حدّ العيّنة» تُعلَن ويُقال عددُها، أما التي تخرج
     بصفرٍ تامّ فتمرّ صامتةً في السطر نفسه — وهي بالضبط الحالة التي
     أخفت أن `ctxAt` لا تضع `win`، فبقيت حافّتا `orb` و`vwapRec`
     معروضتين من بناءٍ أقدم وموزوناً بهما الإجماع بينما صار قياسُهما
     مستحيلاً. الصفر يُصاح به لا يُبتلع. */
  const dead = rows.filter(r => !r.n);
  /* والحدُّ **المعلن** يُقال ولا يُنذَر به: `btNA` تصف استراتيجيةً
     يُعرف سلفاً أنها لا تُقاس في هذا الإطار. وإنذارٌ يصيح عنها في كل
     تشغيل يُدرَّب المستخدم على تجاهله، فيُبتلع معه صفرٌ حقيقيّ حين
     يقع — نفس قاعدة «إنذارٌ كاذب يُدرَّب المستخدم على تجاهله». */
  const known = dead.filter(r => S.STRAT_BY_ID[r.id] && S.STRAT_BY_ID[r.id].btNA);
  const odd = dead.filter(r => !(S.STRAT_BY_ID[r.id] && S.STRAT_BY_ID[r.id].btNA));
  for (const r of known)
    console.log(`  ⓘ ${r.id}: لا يُقاس هنا بحدٍّ معلن — ${S.STRAT_BY_ID[r.id].btNA}`);
  if (odd.length)
    console.warn(`  ⚠ صفرُ حالة على ${bars.toLocaleString("en")} شمعة: ` +
                 `${odd.map(r => r.id).join("، ")} — راجع شروط السياق، ` +
                 `فهذا سياقٌ مكسور غالباً لا ندرةُ سوق`);
}

/* =====================================================================
   الفحص الذاتي
   ===================================================================== */
function selfTest() {
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n} — ${e.message}`); fail++; } };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
  const ok = (c, m) => { if (!c) throw new Error(m); };

  console.log("\n▶ فحص الأرشيف اللحظي (بلا شبكة)\n");

  t("الحدّ خارج العيّنة زمنيّ لا بالرموز", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ t: 1000 + i, x: i }));
    const { cut, ins, oos } = splitOOS(rows, 0.3);
    eq(ins.length, 70, "داخل العيّنة أقدم 70%");
    eq(oos.length, 30, "وخارجها أحدث 30%");
    ok(ins.every(r => r.t < cut) && oos.every(r => r.t >= cut), "الفصل بالزمن");
    // مختلطةُ الترتيب تُفرز بالزمن لا بموضعها في المصفوفة
    const shuffled = rows.slice().reverse();
    eq(splitOOS(shuffled, 0.3).oos.length, 30, "الترتيب لا يغيّر القسمة");
  });

  t("الجلسات تُشتقّ من الشمعات لا من فتراتٍ محفوظة", () => {
    const d1 = Date.UTC(2026, 8, 14, 13, 30), d2 = Date.UTC(2026, 8, 15, 13, 30);
    const k = [{ t: d1 }, { t: d1 + 3600e3 }, { t: d2 }, { t: d2 + 7200e3 }];
    const s = sessionsOf(k);
    eq(s.size, 2, "يومان");
    eq(s.get(dayKey(d1)).start, d1, "افتتاح اليوم الأول أول شمعةٍ فيه");
    eq(s.get(dayKey(d2)).end, d2 + 7200e3, "وإغلاقه آخرها");
  });

  t("قواعد المحاكاة مستوردة لا معادة الكتابة", () => {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    ok(/import \{ simulatePlan, summarizePlans \} from "\.\/backtest\.mjs"/.test(src),
       "تُستورد من الأرشيف اليومي");
    ok(!/function simulatePlan\s*\(/.test(src), "ولا يُعاد تعريفها هنا");
    ok(/import \{ COSTS \} from "\.\/lib\/costs\.mjs"/.test(src), "ونموذج التكلفة مشترك");
  });

  t("الوقف يغلب الهدف في الشمعة الواحدة (عبر الدالّة المستوردة)", () => {
    const k = Array.from({ length: 80 }, (_, i) => ({ t: i * 60000, o: 100, h: 100, l: 100, c: 100, v: 1 }));
    k[1] = { t: 60000, o: 100, h: 106, l: 97, c: 100, v: 1 };   // تلمس الاثنين
    const p = { dir: 1, entry: 100, stop: 98, atr: 1, targets: [{ p: 105 }] };
    const sim = simulatePlan(k, 0, p, { maxBars: 60, costs: { slipAtr: 0, feeBps: 0 } });
    eq(sim.st, "stop", "الشمعة التي تلمس الاثنين وقفٌ لا هدف");
  });

  t("المسار السريع يطابق analyze بالضبط", () => {
    /* شرطُ قبول الاستبدال: السلاسل المحسوبة مرّة يجب أن تعطي **نفس**
       ما يعطيه `analyze` على شريحةٍ متنامية. وبلا هذا الفحص يكون
       الأرشيف أسرع ويقيس شيئاً آخر — وهو أسوأ من بطئه. */
    const k = [];
    let p0 = 100;
    for (let i = 0; i < 320; i++) {
      // سلسلةٌ فيها اتجاهٌ وتذبذب كي تتحرّك كل المؤشّرات
      p0 += Math.sin(i / 7) * 1.4 + (i < 160 ? 0.25 : -0.2);
      k.push({ t: (1789000000 + i * 900) * 1000, o: p0 - 0.3, h: p0 + 0.9,
               l: p0 - 0.9, c: p0, v: 100000 + (i % 13) * 4000 });
    }
    const S2 = seriesOf(k);
    for (const j of [240, 275, 300, 319]) {
      const fast = anAt(S2, j);
      const slow = IND.analyze(k.slice(0, j + 1));
      for (const f of ["px", "e20", "e50", "e200", "rsi", "hist", "histPrev",
                       "atr", "bbUp", "bbLo", "bbMid", "adx", "pdi", "mdi",
                       "bbw", "mfi", "stochK", "stochD", "score", "obvSlope"]) {
        const a = fast[f], b = slow[f];
        if (a === null && (b === null || b === undefined)) continue;
        if (!Number.isFinite(a) || !Number.isFinite(b))
          throw new Error(`شمعة ${j} حقل ${f}: ${a} مقابل ${b}`);
        if (Math.abs(a - b) > 1e-9)
          throw new Error(`شمعة ${j} حقل ${f}: ${a} ≠ ${b}`);
      }
      eq(fast.histRising, slow.histRising, `شمعة ${j} ميل الهيستوغرام`);
    }
  });

  t("حدّ العيّنة يمنع رقماً تحته", () => {
    ok(MIN_N >= 200, "الحدّ مئتان على الأقل");
    // وهو نفس حدّ التركيبات في الأرشيف اليومي — مسطرةٌ واحدة
    ok(OOS_FRAC > 0 && OOS_FRAC < 1, "قسمةٌ صالحة");
  });

  t("الاستراتيجيات كلها لها فريمٌ قابل للقياس", () => {
    for (const st of S.STRATEGIES)
      ok(RANGES[st.tf], `${st.id} فريمُه ${st.tf} بلا مدىً معرَّف`);
  });

  t("الحدُّ المعلن يُقال ولا يُنذَر به — والصفرُ غيرُ المعلن يُنذَر", () => {
    /* التمييز شرطُ ألّا يصير الإنذار ضجيجاً: استراتيجيةٌ يُعرف سلفاً
       أنها لا تُقاس هنا تُذكر بسببها، وصفرٌ غيرُ متوقَّع يُصاح به.
       وخلطُهما يُبطل الاثنين — الأوّل يزعج والثاني يضيع. */
    const na = S.STRATEGIES.filter(s => s.btNA);
    ok(na.length, "استراتيجيةٌ واحدة على الأقل بحدٍّ معلن");
    for (const s of na)
      ok(typeof s.btNA === "string" && s.btNA.length > 20,
         `${s.id}: \`btNA\` يجب أن تشرح السبب لا أن تكون علماً`);
    // و`btNA` لا تُمنح لما يُقاس فعلاً: ذلك يُخفي عطلاً حقيقياً
    const file = path.join(OUT, "strategy-edge.json");
    if (!fs.existsSync(file)) return;
    const rows = JSON.parse(fs.readFileSync(file, "utf8")).rows || [];
    for (const r of rows) {
      const st = S.STRAT_BY_ID[r.id];
      if (st && st.btNA && r.n)
        throw new Error(`${r.id} موسومٌ «لا يُقاس» وقد قِيس ${r.n} حالة — أزِل الوسم`);
    }
  });

  t("سياقُ الأرشيف يحمل كلَّ حقلٍ يبنيه `buildCtx`", () => {
    /* كلّف هذا تشخيصاً مرّتين. أوّلاً غابت `win` فخرجت `orb`/`vwapRec`
       بـ`off` عند كل شمعة. وبعد إصلاحها بقيتا على صفر: `orb.side` تقرأ
       `c.ian` وهي غائبةٌ كذلك — `undefined[...]` ترمي، فيُبتلع
       الاستثناء وتخرج «بلا جهة». حقلان ناقصان لا حقلٌ واحد.

       **وأوّل صيغةٍ لهذا الفحص كتبتْ قائمةَ الحقول بيدٍ — فنسيتْ `ian`
       بالضبط كما نسيتها الشيفرة**، ومرّت. قائمةٌ مكتوبة تنسى ما نسيه
       كاتبُها، فهي تعيد إنتاج الخطأ لا تكشفه.

       والصيغة الصحيحة: القائمة **تُشتقّ من `buildCtx` نفسها** وقتَ
       التشغيل. فأيُّ حقلٍ يُضاف هناك يصير مطلوباً هنا تلقائياً، ولا
       يمكن أن يُنسى في الاثنين معاً. */
    const live = S.buildCtx({ rec: { s: "X", tf: {}, an: {} }, row: { s: "X", p: 100 },
                              now: Date.now(), px: 100, sess: "REGULAR" });
    const bars = Array.from({ length: 60 }, (_, i) => ({
      t: Date.UTC(2026, 8, 14, 13, 30) + i * 900e3,
      o: 100 + i * 0.1, h: 100.5 + i * 0.1, l: 99.5 + i * 0.1, c: 100 + i * 0.1, v: 1000 }));
    const SS = { "15m": seriesOf(bars) };
    const day = { start: bars[0].t, end: bars[bars.length - 1].t };
    const c = ctxAt(SS, { "15m": 59 }, { s: "X", tf: "15m", period: { regular: day } });
    ok(c, "السياق يُبنى");

    /* `tfPin` مستثناة وحدها: خيارٌ يخصّ «توجّه السوق» ولا يستعمله
       الأرشيف — وغيابُه يعني «بلا تثبيت» وهو المطلوب هنا. */
    const skip = new Set(["tfPin"]);
    const missing = Object.keys(live).filter(f => !skip.has(f) && !(f in c));
    ok(!missing.length,
       `حقولٌ في \`buildCtx\` وليست في سياق الأرشيف: ${missing.join("، ")} — ` +
       `الاستراتيجية التي تقرؤها تصمت للأبد`);
    ok(c.win && c.win.start === day.start, "و`win` هي نافذة الجلسة لا كائنٌ فارغ");
    ok(c.ian === c.an, "و`ian` هي مؤشّرات السلسلة الجارية — الرسمية هنا");
    console.log(`      (${Object.keys(live).length - skip.size} حقلاً قُوبل)`);
  });

  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
  process.exit(fail ? 1 : 0);
}

const IS_MAIN = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (IS_MAIN) {
  if (CHECK) selfTest();
  else main().catch(e => { console.error("✗ فشل التشغيل:", e.message); process.exit(1); });
}
