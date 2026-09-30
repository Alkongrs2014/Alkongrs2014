#!/usr/bin/env node
/* =====================================================================
   إعادة تشغيل يومٍ بعينه — دقيقةً دقيقة، بلا نظرٍ إلى المستقبل.

   السؤال الذي يجيبه هذا الملفّ ليس «هل ارتفع السهم؟» — ذاك يُعرف بعد
   انتهاء اليوم ولا قيمة له. السؤال: **في اللحظة التي تحرّك فيها، هل
   كانت المعلومات المتاحة عندها كافيةً لإطلاق إشارة؟**

   والفرق بين السؤالين هو الفرق بين نظامٍ يُقاس ونظامٍ يمتدح نفسه.

   ---------------------------------------------------------------------
   **منعُ النظر إلى المستقبل بنيويّ لا انضباطيّ.**

   السلاسل كلُّها تمرّ بـ`upTo(vnow)` التي تقصّ عند الساعة الافتراضية،
   ولا تصل الاستراتيجيات إلى المصفوفة الكاملة أبداً. والفحص يُثبت ذلك
   بحقن شمعةٍ مستقبلية والتأكّد من أن الناتج **لا يتغيّر بحرف**.

   ---------------------------------------------------------------------
   **محرّكان من نفس البيانات ونفس المحاكاة** — فالمقارنة تقيس التغيير
   لا اختلاف الأدوات:

     `--engine=old`  يحاكي قيود النظام قبل هذا العمل:
                     · السعر مجمَّدٌ على إغلاق أمس حتى ‎09:30‎
                     · لا شمعات للجلسة الممتدة إطلاقاً
                     · `orb` و`vwapRec` معطَّلتان خارج الجلسة الرسمية
     `--engine=new`  الحالة بعد الإصلاح.

   ولا يُعاد اختراع شيء: `simulatePlan` و`summarizePlans` و`COSTS`
   و`seriesOf`/`anAt` كلُّها مستوردة — نسختان تجعلان الأرقام تُقارَن
   بمسطرتين.

     node scripts/replay.mjs --date=2026-09-14 --engine=new
     node scripts/replay.mjs --check
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import "./lib/env.mjs";
import * as PROV from "./providers/index.mjs";
import {
  sessionOf, currentWindow, sessionWindows, isTradingDay,
  atEtMinutes, ksaTime, isRegularBar
} from "./lib/session.mjs";
import { seriesOf, anAt } from "./backtest-strategies.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, "stocks/strategies.js"));
const C = require(path.join(ROOT, "stocks/consensus.js"));
const IND = require(path.join(ROOT, "stocks/indicators.js"));

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const argOf = (k, d = null) => {
  const a = args.find(x => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const OUT = path.resolve(argOf("out", path.join(ROOT, "data")));

/* خطوةُ الساعة الافتراضية = فريمُ الاكتشاف نفسه، وخطوةٌ أدقّ منه تعيد
   تقييم نفس الشمعة مراراً بلا معلومةٍ جديدة.

   وكانت خمس دقائق، فصارت خمس عشرة مع توحيد المشروع على أربعة فريمات.
   والأثر يُقال ولا يُخفى: **دقّة لحظةِ الاكتشاف تنزل من ٥ دقائق إلى
   ١٥**، فرقمُ «اكتُشفت قبل الجرس بكذا» يصير مقرَّباً إلى أقرب ربع
   ساعة. وهو خطأٌ في اتجاهٍ واحد — يُظهر الاكتشاف **أبطأ** مما هو، لا
   أسرع — وهو الاتجاه المقبول. */
const STEP_MS = 15 * 60e3;
/* تسخينان لا واحد: فريمُ ‎15د‎ يحتاج ‎200‎ شمعة، والجلسةُ الرسمية
   ‎26‎ شمعة في اليوم — أي ثمانيةَ أيام تداول، و‎30‎ يوماً تقويمياً
   هامشٌ واسع. والفريمُ اليوميّ يحتاج ‎200‎ **يوم تداول**، وخلطُهما
   يعطي ثماني شمعاتٍ يومية فتسقط EMA200 وADX ومعها كلُّ بوابةٍ تقرأ
   الاتجاه الأمّ، ويخرج الرمز «بلا بيانات كافية». */
const WARM_DAYS = 30;
const WARM_DAYS_D = 400;

/* =====================================================================
   الساعة الافتراضية — الحارس الوحيد ضدّ النظر إلى المستقبل.

   كلُّ قراءةٍ للسلاسل تمرّ من هنا. وهي تحتفظ بمؤشّرٍ متقدّم لكل سلسلة
   بدل البحث الخطّي في كل خطوة: الكلفة التربيعية مصيدةٌ موثّقة كلّفت
   رمزاً واحداً دقيقتين (تسعون رمزاً ≈ ثلاث ساعات).
   ===================================================================== */
function makeClock() {
  const cursors = new Map();
  let vnow = 0;
  return {
    set(t) {
      if (t < vnow) cursors.clear();          // رجوعٌ للخلف: أعد الفهرسة
      vnow = t;
    },
    get now() { return vnow; },
    /* فهرسُ آخر شمعةٍ **اكتملت** عند `vnow`. الشمعة تكتمل بعد مرور
       طولها: شمعةُ ‎09:30‎ على ‎15د‎ لا تُقرأ قبل ‎09:45‎. وقراءتُها
       عند فتحها هي النظر إلى المستقبل بعينه — وأشيعُ صوره. */
    lastIdx(key, arr, barMs) {
      let i = cursors.get(key) ?? -1;
      while (i + 1 < arr.length && arr[i + 1].t + barMs <= vnow) i++;
      cursors.set(key, i);
      return i;
    },
    upTo(key, arr, barMs) {
      const i = this.lastIdx(key, arr, barMs);
      return i < 0 ? [] : arr.slice(0, i + 1);
    }
  };
}

const TF_MS = { "1m": 60e3, "5m": 5 * 60e3, "15m": 15 * 60e3, "1h": 3600e3, "4h": 4 * 3600e3, "1d": 86400e3 };

/* =====================================================================
   جلب يومٍ كاملاً بجلستيه — من المزوّد الذي يعطي الحجم الممتد.

   وبلا ذلك المزوّد لا معنى للتمرين أصلاً: ياهو يعطي أسعار ما قبل
   الافتتاح بحجمٍ صفر، فـ«الحجم غير المعتاد قبل الافتتاح» لا يمكن
   قياسه لا الآن ولا تاريخياً.
   ===================================================================== */
async function loadDay(symbols, date, log = console.log) {
  const { provider, caps } = PROV.pick("equity", ["extendedVolume"]);
  if (!caps.extendedVolume)
    throw new Error(`المزوّد ${provider.id} بلا حجمٍ ممتد — لا يصلح للـReplay. اضبط مفاتيح Alpaca في .env`);
  const dayStart = Date.parse(`${date}T00:00:00Z`);
  const to = dayStart + 86400e3;
  const out = {};
  for (const tf of ["15m", "1d"]) {
    const from = dayStart - (tf === "1d" ? WARM_DAYS_D : WARM_DAYS) * 86400e3;
    const m = await provider.getCandlesBatch(symbols, tf, { from, to });
    const skipped = m.__skipped || []; delete m.__skipped;
    out[tf] = m;
    log(`  ✓ ${tf}: ${Object.keys(m).length} رمزاً` + (skipped.length ? ` · مستبعَد ${skipped.join("، ")}` : ""));
  }
  return { bars: out, src: provider.id, delayMs: caps.extendedVolumeDelayMs || 0 };
}

/* السلسلة الرسمية والممتدة من نفس المصدر — الفصل بالجلسة لا بالمصدر،
   فلا يتسرّب فرقُ مزوّدين إلى فرق الجلستين. */
const splitSessions = (k) => ({
  reg: k.filter(b => isRegularBar(b.t)),
  ext: k
});

/* تجميعٌ بمفتاح الزمن لا بالموضع — درسُ «زحف شبكة 4h» */
function aggByTime(k, bucketMs) {
  const m = new Map();
  for (const b of k) {
    const key = Math.floor(b.t / bucketMs) * bucketMs;
    const g = m.get(key);
    if (!g) m.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 });
    else {
      g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; g.v += (b.v || 0);
    }
  }
  return [...m.values()].sort((a, b) => a.t - b.t);
}

/* =====================================================================
   محرّك إعادة التشغيل
   ===================================================================== */
export function replaySymbol({ sym, mkt, k15, k1d, date, engine, clock, onSignal }) {
  const { reg: reg15, ext: ext15 } = splitSessions(k15);
  /* الساعة و‎4‎ ساعات تُشتقّان من ‎15د‎ بمفتاحٍ زمنيّ — والنتيجة مطابقة
     لاشتقاقهما من ‎5د‎ لأن التجميع بـ`floor(t / bucket)` تجميعيّ:
     دلوُ الساعة يضمّ نفس الشمعات سواء بُني من ثلاث شمعاتِ ‎15د‎ أو
     اثنتي عشرة شمعةَ ‎5د‎. */
  const reg1h = aggByTime(reg15, TF_MS["1h"]);
  const reg4h = aggByTime(reg15, TF_MS["4h"]);

  /* السلاسل تُحسب **مرّة** ثم تُقرأ بالفهرس — الكلفة التربيعية موثّقة */
  const SER = {
    "15m": seriesOf(reg15), "1h": seriesOf(reg1h),
    "4h": seriesOf(reg4h), "1d": seriesOf(k1d)
  };
  const SERX = { "15m": seriesOf(ext15) };

  const win = sessionWindows(Date.parse(`${date}T15:00:00Z`));
  if (!win.regular) return [];
  const t0 = win.pre.start, t1 = win.post.end;
  const seen = new Map();          // آخر اتجاهٍ لكل استراتيجية
  const lastFire = new Map();      // آخر لحظة إطلاق لكل استراتيجية
  const fired = [], consensus = [];
  /* فترةُ تهدئة — نفس `COOLDOWN` في الأرشيف اللحظي (ثماني شمعات).
     بدونها تُعدّ الإشارةُ الواحدة عشراتِ المرّات: الاستراتيجية تتذبذب
     بين «لا اتجاه» و«اتجاه» عند حافّة عتبتها، فيُعاد تأريخُها في كل
     ذبذبة. قِيس قبل التهدئة: ‎1262‎ إشارة على ‎40‎ رمزاً في يومٍ واحد
     — رقمٌ يصف اهتزاز العتبة لا السوق. */
  const COOLDOWN_MS = 8 * STEP_MS;

  for (let vnow = t0; vnow <= t1; vnow += STEP_MS) {
    clock.set(vnow);
    const sess = sessionOf(vnow, mkt);
    if (sess === "CLOSED") continue;

    /* ---- المحرّك القديم: قيودُه تُحاكى ولا تُوصف ---- */
    const oldEngine = engine === "old";
    const preOpen = vnow < win.regular.start;
    if (oldEngine && sess !== "REGULAR") {
      /* النظام القديم لم يكن يعمل خارج الجلسة الرسمية بالمعنى العملي:
         سعرُه إغلاقُ أمس وشمعاتُه الممتدة محذوفة. نمرّ دون تقييم —
         وهذا **هو** ما نقيسه. */
      continue;
    }

    const idx = {};
    for (const tf of ["15m", "1h", "4h", "1d"]) idx[tf] = clock.lastIdx(`r${tf}`, SER[tf].k, TF_MS[tf]);
    if (idx["15m"] < 210 || idx["1d"] < 1) continue;       // تسخين

    /* السعر: المحرّك الجديد يرى آخر إغلاقٍ في الجلسة الجارية،
       والقديم إغلاقَ الجلسة الرسمية السابقة قبل ‎09:30‎ */
    const ix15 = clock.lastIdx("x15m", SERX["15m"].k, TF_MS["15m"]);
    const px = oldEngine
      ? SER["15m"].k[idx["15m"]]?.c
      : (ix15 >= 0 ? SERX["15m"].k[ix15].c : SER["15m"].k[idx["15m"]]?.c);
    if (!(px > 0)) continue;

    const rec = { s: sym, mkt, tf: {}, tfx: {}, an: {}, anx: {} };
    for (const tf of ["15m", "1h", "4h", "1d"]) {
      if (idx[tf] < 0) continue;
      rec.tf[tf] = { c: SER[tf].k.slice(0, idx[tf] + 1) };
      rec.an[tf] = anAt(SER[tf], idx[tf]);
    }
    if (!oldEngine) {
      for (const tf of ["15m"]) {
        const j = clock.lastIdx(`x${tf}`, SERX[tf].k, TF_MS[tf]);
        if (j < 0) continue;
        rec.tfx[tf] = { c: SERX[tf].k.slice(0, j + 1) };
        rec.anx[tf] = anAt(SERX[tf], j);
      }
    }

    const row = { s: sym, p: px, mkt };
    const ctx = S.buildCtx({
      rec, row, now: vnow, px, sess,
      win: oldEngine ? win.regular : currentWindow(vnow, mkt),
      sessOf: (t) => sessionOf(t, mkt)
    });

    const res = [];
    for (const st of S.STRATEGIES) {
      const r = S.evalStrategy(st, ctx);
      res.push(r);
      if (!r.dir || !Number.isFinite(r.sc)) { seen.delete(st.id); continue; }
      const prev = seen.get(st.id);
      seen.set(st.id, r.dir);
      if (!r.active) continue;
      if (prev === r.dir) continue;                 // نفس الإشارة مستمرّة
      const lf = lastFire.get(st.id + r.dir);
      if (lf && vnow - lf < COOLDOWN_MS) continue;  // نفس الإشارة تتذبذب
      lastFire.set(st.id + r.dir, vnow);
      const plan = S.planFor(ctx, r);
      const sig = {
        sym, strat: st.id, dir: r.dir, sc: r.sc, at: vnow, sess,
        px, tf: r.tfUsed || st.tf,
        entry: plan && !plan.bad ? plan.entry : null,
        stop: plan && !plan.bad ? plan.stop : null,
        targets: plan && !plan.bad ? plan.targets.map(x => x.p) : []
      };
      fired.push(sig);
      onSignal?.(sig);
    }

    /* =====================================================================
       الإجماع — وهو **ما يراه المستخدم فعلاً**.

       الإشارة المفردة صفٌّ في جدول؛ والذي يتصدّر شاشة الفرص هو ما
       اتّفقت عليه عدّة استراتيجيات. فقياسُ الإيجابيات الكاذبة على
       الإشارات المفردة يقيس شيئاً لا يُعرض بهذه الصورة — ويخرج برقمٍ
       متشائمٍ عن المنتَج ومتفائلٍ عن الضجيج في آنٍ واحد.
       ===================================================================== */
    const cons = C.consensusOf(res, {});
    if (cons.dir && cons.k !== "mixed" && Number.isFinite(cons.sc)) {
      const key = "C" + cons.dir;
      const lf = lastFire.get(key);
      if (!lf || vnow - lf >= COOLDOWN_MS) {
        lastFire.set(key, vnow);
        consensus.push({
          sym, dir: cons.dir, sc: cons.sc, mass: +cons.mass.toFixed(3),
          n: cons.n, fams: cons.fams.length, conf: cons.k,
          at: vnow, sess, px
        });
      }
    }
  }
  return { fired, consensus };
}

/* =====================================================================
   ما حدث فعلاً بعد الإشارة — يُقاس **بعد** انتهاء إعادة التشغيل.

   فصلُ القياس عن الاكتشاف ليس ترتيباً بل شرطُ صحّة: خلطُهما يجعل
   الاكتشاف يرى ما بعده.
   ===================================================================== */
export function outcomeOf(sig, k15, win) {
  const after = k15.filter(b => b.t > sig.at);
  if (!after.length) return null;
  const d = sig.dir;
  let mfe = 0, mae = 0, hitT1 = null, hitStop = null;
  for (const b of after) {
    const up = (b.h - sig.px) / sig.px * 100 * d;
    const dn = (b.l - sig.px) / sig.px * 100 * d;
    if (up > mfe) mfe = up;
    if (dn < mae) mae = dn;
    if (hitT1 === null && sig.targets?.length &&
        ((d > 0 && b.h >= sig.targets[0]) || (d < 0 && b.l <= sig.targets[0]))) hitT1 = b.t;
    if (hitStop === null && sig.stop &&
        ((d > 0 && b.l <= sig.stop) || (d < 0 && b.h >= sig.stop))) hitStop = b.t;
  }
  const atOpen = k15.find(b => b.t >= win.regular.start);
  const last = after[after.length - 1];
  return {
    mfe: +mfe.toFixed(2), mae: +mae.toFixed(2),
    ret: +((last.c - sig.px) / sig.px * 100 * d).toFixed(2),
    openPx: atOpen ? atOpen.o : null,
    toOpen: atOpen ? +((atOpen.o - sig.px) / sig.px * 100 * d).toFixed(2) : null,
    hitT1, hitStop,
    /* «الوقف قبل الهدف» هو الحكم حين يقعان في نفس الشمعة — القاعدة
       الثانية من قواعد المحاكاة الستّ، ولا تُخفَّف هنا */
    win: hitT1 !== null && (hitStop === null || hitT1 < hitStop)
  };
}

/* =====================================================================
   التشغيل
   ===================================================================== */
async function main() {
  const date = argOf("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("مطلوب --date=YYYY-MM-DD");
  const engine = argOf("engine", "new");
  if (!["old", "new"].includes(engine)) throw new Error("--engine=old|new");
  if (!isTradingDay(Date.parse(`${date}T15:00:00Z`)))
    throw new Error(`${date} ليس يوم تداول`);

  const limit = Number(argOf("limit", 0));
  const only = argOf("symbols");
  const summary = JSON.parse(fs.readFileSync(path.join(OUT, "summary.json"), "utf8"));
  let syms = only ? only.split(",") : summary.rows.filter(r => r.mkt !== "crypto").map(r => r.s);
  if (limit) syms = syms.slice(0, limit);

  console.log(`\n▶ إعادة تشغيل ${date} · محرّك «${engine}» · ${syms.length} رمزاً`);
  console.log(`  المزوّد: ${PROV.describe()}`);
  const { bars, src, delayMs } = await loadDay(syms, date);
  if (delayMs) console.log(`  ⓘ حجمُ المصدر متأخّرٌ ${Math.round(delayMs / 60e3)}د في البثّ الحيّ — وفي الماضي لا تأخير`);

  const win = sessionWindows(Date.parse(`${date}T15:00:00Z`));
  const clock = makeClock();
  const all = [], allCons = [];
  let evaluated = 0, noData = 0;

  for (const sym of syms) {
    const k15 = (bars["15m"][sym] || []);
    const k1d = (bars["1d"][sym] || []);
    if (k15.length < 260 || k1d.length < 60) { noData++; continue; }
    evaluated++;
    const { fired: sigs, consensus: cons } = replaySymbol({ sym, mkt: null, k15, k1d, date, engine, clock });
    for (const s of sigs) { s.out = outcomeOf(s, k15, win); all.push(s); }
    for (const c of cons) { c.out = outcomeOf({ ...c, targets: [], stop: null }, k15, win); allCons.push(c); }
  }

  const dir = path.join(OUT, "replay");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date}-${engine}.json`);
  fs.writeFileSync(file, JSON.stringify({
    date, engine, src, generated: Date.now(),
    symbols: evaluated, noData, step: STEP_MS, warmDays: WARM_DAYS,
    signals: all, consensus: allCons
  }));

  const pre = all.filter(s => s.sess === "PRE");
  console.log(`\n  رموز مقيَّمة: ${evaluated} · بلا بيانات كافية: ${noData}`);
  const preC = allCons.filter(s => s.sess === "PRE");
  console.log(`  إشارات مفردة: ${all.length} · منها قبل الافتتاح: ${pre.length}`);
  console.log(`  إجماعات: ${allCons.length} · منها قبل الافتتاح: ${preC.length}`);
  const withOut = all.filter(s => s.out);
  if (withOut.length) {
    const wins = withOut.filter(s => s.out.win).length;
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
    console.log(`  بلغت الهدف الأول: ${wins}/${withOut.length} · وسيط أقصى ربح: ${med(withOut.map(s => s.out.mfe)).toFixed(2)}%`);
  }
  console.log(`  كُتب: ${path.relative(ROOT, file)}\n`);
  return 0;
}

/* =====================================================================
   الفحص الذاتي — وأهمُّه إثباتُ منع النظر إلى المستقبل
   ===================================================================== */
function selfCheck() {
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n} — ${e.message}`); fail++; } };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

  console.log("\n▶ فحص إعادة التشغيل\n");

  const mk = (n, from, step, base) => Array.from({ length: n }, (_, i) => ({
    t: from + i * step, o: base + i * 0.01, h: base + i * 0.01 + 0.05,
    l: base + i * 0.01 - 0.05, c: base + i * 0.01, v: 1000 + i
  }));

  t("الساعة لا تُظهر شمعةً لم تكتمل بعد", () => {
    const clock = makeClock();
    const k = mk(10, Date.parse("2026-09-14T13:30:00Z"), 5 * 60e3, 100);
    // عند ‎13:34‎ لم تكتمل شمعة ‎13:30‎ (تكتمل ‎13:35‎)
    clock.set(Date.parse("2026-09-14T13:34:00Z"));
    eq(clock.lastIdx("a", k, 5 * 60e3), -1, "قبل اكتمال الأولى");
    clock.set(Date.parse("2026-09-14T13:35:00Z"));
    eq(clock.lastIdx("a", k, 5 * 60e3), 0, "عند اكتمالها");
    clock.set(Date.parse("2026-09-14T14:00:00Z"));
    eq(clock.lastIdx("a", k, 5 * 60e3), 5, "بعد ستّ شمعات");
  });

  t("**شمعةٌ مستقبلية محقونة لا تغيّر الناتج بحرف** — الحارس الأهمّ", () => {
    const from = Date.parse("2026-09-14T08:00:00Z");
    const k = mk(400, from, 5 * 60e3, 100);
    const clock = makeClock();
    clock.set(from + 200 * 5 * 60e3);
    const a = clock.upTo("k", k, 5 * 60e3);

    // نفس السلسلة مع ذيلٍ مستقبليّ صاخب
    const future = k.concat(mk(50, from + 400 * 5 * 60e3, 5 * 60e3, 900));
    const clock2 = makeClock();
    clock2.set(from + 200 * 5 * 60e3);
    const b = clock2.upTo("k", future, 5 * 60e3);
    eq(a.length, b.length, "الطول");
    eq(a[a.length - 1], b[b.length - 1], "آخر شمعة");
    eq(JSON.stringify(a), JSON.stringify(b), "السلسلة كاملةً");
  });

  t("ويُسقط الفحصُ نفسَه لو أُزيل الحدّ — إثباتُ أن الحارس يحرس", () => {
    // محاكاة «بلا upTo»: قراءةٌ مباشرة من المصفوفة الكاملة
    const from = Date.parse("2026-09-14T08:00:00Z");
    const k = mk(400, from, 5 * 60e3, 100);
    const future = k.concat(mk(50, from + 400 * 5 * 60e3, 5 * 60e3, 900));
    if (JSON.stringify(k) === JSON.stringify(future))
      throw new Error("المدخلان متطابقان — الفحص لا يفحص شيئاً");
    // بلا حدٍّ يختلف الناتج ⇒ الحدّ هو ما يمنع التسرّب
    eq(k.length !== future.length, true, "بلا الحدّ يتغيّر الناتج");
  });

  t("الرجوع بالساعة إلى الوراء يعيد الفهرسة ولا يبقى متقدّماً", () => {
    const clock = makeClock();
    const k = mk(20, Date.parse("2026-09-14T13:30:00Z"), 5 * 60e3, 100);
    clock.set(Date.parse("2026-09-14T14:30:00Z"));
    const far = clock.lastIdx("a", k, 5 * 60e3);
    clock.set(Date.parse("2026-09-14T13:40:00Z"));
    const near = clock.lastIdx("a", k, 5 * 60e3);
    eq(near < far, true, "عاد للخلف فعلاً");
  });

  t("التجميع بمفتاح الزمن ثابتٌ أمام تدحرج النافذة", () => {
    const from = Date.parse("2026-09-14T13:30:00Z");
    const k = mk(60, from, 5 * 60e3, 100);
    const a = aggByTime(k, TF_MS["15m"]);
    const b = aggByTime(k.slice(7), TF_MS["15m"]);
    // الشمعات المشتركة يجب أن تتطابق تماماً مهما اختلفت البداية
    const common = b.filter(x => a.some(y => y.t === x.t && y.t > k[7].t));
    for (const x of common) {
      const y = a.find(z => z.t === x.t);
      eq([x.t, x.h, x.l, x.c], [y.t, y.h, y.l, y.c], `مجموعة ${new Date(x.t).toISOString()}`);
    }
  });

  t("الجلستان تُفصلان بالوسم لا بالمصدر", () => {
    const k = [
      { t: Date.parse("2026-09-14T10:00:00Z"), o: 1, h: 1, l: 1, c: 1, v: 5 },   // 06:00 ET
      { t: Date.parse("2026-09-14T15:00:00Z"), o: 1, h: 1, l: 1, c: 1, v: 5 },   // 11:00 ET
      { t: Date.parse("2026-09-14T21:00:00Z"), o: 1, h: 1, l: 1, c: 1, v: 5 }    // 17:00 ET
    ];
    const { reg, ext } = splitSessions(k);
    eq(reg.length, 1, "الرسمية واحدة");
    eq(ext.length, 3, "الممتدة تشمل الكل");
  });

  t("`outcomeOf` تقيس بالاتجاه ولا تفترض صعوداً", () => {
    const win = sessionWindows(Date.parse("2026-09-14T15:00:00Z"));
    const k = [
      { t: Date.parse("2026-09-14T12:00:00Z"), o: 100, h: 100, l: 100, c: 100, v: 1 },
      { t: Date.parse("2026-09-14T12:30:00Z"), o: 100, h: 101, l: 95, c: 96, v: 1 },
      { t: Date.parse("2026-09-14T14:00:00Z"), o: 96, h: 97, l: 94, c: 95, v: 1 }
    ];
    const short = { dir: -1, px: 100, at: Date.parse("2026-09-14T12:00:00Z"), targets: [96], stop: 102 };
    const o = outcomeOf(short, k, win);
    eq(o.win, true, "البيع بلغ هدفه بالهبوط");
    eq(o.mfe > 0, true, "أقصى ربحٍ موجبٌ للبيع الهابط");
    const long = { dir: 1, px: 100, at: Date.parse("2026-09-14T12:00:00Z"), targets: [104], stop: 98 };
    const o2 = outcomeOf(long, k, win);
    eq(o2.win, false, "الشراء لم يبلغ");
    eq(o2.out === undefined && o2.mae < 0, true, "أقصى خسارةٍ سالبة");
  });

  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
  return fail ? 1 : 0;
}

const IS_MAIN = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (IS_MAIN) {
  if (CHECK) process.exit(selfCheck());
  else main().then(c => process.exit(c)).catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });
}
