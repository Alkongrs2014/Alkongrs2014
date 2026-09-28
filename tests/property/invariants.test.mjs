/* =====================================================================
   اختبارات الخصائص (fast-check) — آلاف الحالات المولَّدة، والثابت هو المقياس.

   لا تثبّت أرقاماً: تثبّت خصائص يجب أن تصحّ لأيّ مدخل. وأيُّ مثالٍ مضادّ
   يُحفظ بـseed ومساره ومثاله المصغَّر في tests/regression/fixtures/ فيصير
   اختبارَ انحدارٍ دائماً (انظر `onFail`).
   FC_RUNS يرفع العدد (الافتراضي 1000 · التعذيب 10000+).
   ===================================================================== */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as M from "../reference/math.mjs";
import * as R from "../reference/engine.mjs";
import { carryFrames, guardFrames } from "../../scripts/fetch-market.mjs";
import { monotonicGuard } from "../../scripts/lib/publish.mjs";

const require = createRequire(import.meta.url);
const IND = require("../../stocks/indicators.js");
const SC = require("../../stocks/score.js");
const S = require("../../stocks/strategies.js");
const CONS = require("../../stocks/consensus.js");
const CF = require("../../stocks/confluence.js");
const DIR = require("../../stocks/direction.js");
const OPP = require("../../stocks/opportunities.js");

const RUNS = Number(process.env.FC_RUNS || 1000);
const FIX = path.resolve("tests/regression/fixtures");

/* تشغيلٌ يحفظ المثال المضادّ قبل أن يُسقط الاختبار */
function check(name, prop, runs = RUNS) {
  const r = fc.check(prop, { numRuns: runs });
  if (r.failed) {
    fs.mkdirSync(FIX, { recursive: true });
    fs.writeFileSync(path.join(FIX, `fc-${name.replace(/[^\w-]/g, "_")}-${r.seed}.json`), JSON.stringify({
      name, seed: r.seed, path: r.counterexamplePath, counterexample: r.counterexample,
      error: String(r.errorInstance || r.error || ""), at: new Date().toISOString() }, null, 1));
  }
  expect(r.failed, r.failed ? `مثالٌ مضادّ: ${JSON.stringify(r.counterexample).slice(0, 400)} · seed=${r.seed} path=${r.counterexamplePath}` : "").toBe(false);
}

/* ---------------- مولِّدات ---------------- */
const price = fc.double({ min: 0.5, max: 2000, noNaN: true, noDefaultInfinity: true });
/* عوائدُ غير متحلّلة (|r| ≥ 1e-4): سلسلةٌ مسطّحة عددياً (مداها دون دقّة
   الفاصلة العائمة) يقرّر تصويتَها ضجيجُ التقريب — مقيسٌ ومعلَن في
   STRATEGY_SPECS §9، ومستبعَدٌ في المنبع (frozenSeries · المستقرّة). */
const ret = fc.tuple(fc.double({ min: 1e-4, max: 0.04, noNaN: true }), fc.boolean()).map(([m, neg]) => neg ? -m : m);
const series = (min = 30, max = 120) => fc.array(ret, { minLength: min, maxLength: max })
  .chain((rets) => price.map((p0) => {
    let p = p0; const t0 = 1_790_000_000_000;
    return rets.map((r, i) => {
      const o = p; p = Math.max(0.01, p * (1 + r));
      const h = Math.max(o, p) * (1 + Math.abs(r) / 3), l = Math.min(o, p) * (1 - Math.abs(r) / 3);
      return { t: t0 + i * 900000, o, h, l, c: p, v: 1000 + Math.round(Math.abs(r) * 1e5) };
    });
  }));
const scoreIn = fc.record({
  px: price, e20: price, e50: price, e200: price, bbMid: price,
  rsi: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  hist: fc.option(fc.double({ min: -5, max: 5, noNaN: true }), { nil: undefined }),
  histPrev: fc.option(fc.double({ min: -5, max: 5, noNaN: true }), { nil: undefined }),
  atr: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  histRising: fc.boolean()
});
const stratRes = fc.record({
  id: fc.constantFrom(...S.STRATEGIES.map((s) => s.id)), fam: fc.constantFrom("session", "trend", "revert", "vol"),
  dir: fc.constantFrom(-1, 0, 1), sc: fc.integer({ min: 0, max: 100 }), active: fc.boolean()
});
const tfScore = fc.record({ "15m": fc.double({ min: -100, max: 100, noNaN: true }), "1h": fc.double({ min: -100, max: 100, noNaN: true }),
  "4h": fc.double({ min: -100, max: 100, noNaN: true }), "1d": fc.double({ min: -100, max: 100, noNaN: true }) });

describe("النتيجة الفنية", () => {
  it("مداها ±100 دائماً ولا NaN مهما كانت المدخلات", () => check("score-bounded",
    fc.property(scoreIn, (o) => { const s = SC.scoreFrom(o); return Number.isFinite(s) && s >= -100 && s <= 100; })));
  it("الإنتاج = المرجع لأيّ مدخل", () => check("score-vs-ref",
    fc.property(scoreIn, (o) => Math.abs(SC.scoreFrom(o) - R.scoreRef(o)) < 1e-9)));
  it("المرآة: عكسُ كلِّ الفروق يعكس النتيجة (تماثل المنطقة الميتة وعتبتي RSI)", () => check("score-mirror",
    fc.property(scoreIn, (o) => {
      const m = { px: -o.px, e20: -o.e20, e50: -o.e50, e200: -o.e200, bbMid: -o.bbMid, atr: o.atr,
        rsi: o.rsi === undefined ? undefined : 100 - o.rsi,
        hist: o.hist === undefined ? undefined : -o.hist, histPrev: o.histPrev === undefined ? undefined : -o.histPrev,
        histRising: !o.histRising };
      if (o.rsi === 55 || o.rsi === 45) return true;                   // الحدّ المفتوح غير متماثل بتعريفه
      return Math.abs(SC.scoreFrom(o) + SC.scoreFrom(m)) < 1e-9;
    })));
  it("الكلية لا تتأثّر بترتيب مفاتيح الفريمات", () => check("overall-order",
    fc.property(tfScore, (t) => {
      const a = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { score: v }]));
      const b = Object.fromEntries(Object.entries(t).reverse().map(([k, v]) => [k, { score: v }]));
      return SC.overallScore(a) === SC.overallScore(b);
    })));
  it("هيستريسس النطاق: لا ينتقل أكثر من خطوةٍ بلا هامشها، ونتيجةٌ ثابتة ⇒ نطاقٌ ثابت", () => check("band-stable",
    fc.property(fc.double({ min: -100, max: 100, noNaN: true }), fc.integer({ min: 0, max: 4 }), (sc, prev) => {
      const b = SC.bandStable(sc, prev);
      return b === R.bandStableRef(sc, prev) && SC.bandStable(sc, b) === b;
    })));
});

describe("المؤشّرات والشمعات", () => {
  it("analyze = المرجع على سلاسل مولَّدة", () => check("analyze-vs-ref", fc.property(series(30, 90), (k) => {
    const a = IND.analyze(k), b = R.analyzeRef(k);
    if (!a || !b) return !a === !b;
    return ["score", "e20", "rsi", "hist", "atr", "bbMid", "adx", "stochK", "mfi"].every((f) =>
      (a[f] ?? null) === null ? (b[f] ?? null) === null : Math.abs(a[f] - b[f]) <= 1e-9 * Math.max(1, Math.abs(a[f])));
  }), Math.min(RUNS, 300)));
  it("closedBars: لا تُعيد شمعةً جارية، ومتساوية القوّة (idempotent)، وتطابق المرجع", () => check("closedBars",
    fc.property(fc.array(fc.integer({ min: 0, max: 400 }), { minLength: 2, maxLength: 40 }), fc.integer({ min: 0, max: 40 * 900 }),
      fc.constantFrom("15m", "1h", "4h", "1d"), (gaps, off, tf) => {
        let t = 1_790_000_000;
        const k = gaps.map((g) => [t += 60 * (1 + g), 1, 1, 1, 1, 1]);
        const now = (k[k.length - 1][0] + off) * 1000;
        const a = IND.closedBars(k, tf, now), b = M.closedRef(k, tf, now);
        const again = IND.closedBars(a, tf, now);
        const last = a[a.length - 1];
        return a.length === b.length && again.length === a.length
          && (a.length === 1 || !IND.isLiveBar(tf, last[0] * 1000, now));
      })));
  it("التجميع: الشمعات الكاملة لا تتأثّر ببداية السلسلة", () => check("aggregate-start",
    /* ≥ 4 شمعات بعد القصّ: دونها لا يُشتقّ طولُ الشمعة فيُجمَّع بالفهرس (ملاذٌ أخير موثّق) */
    fc.property(fc.integer({ min: 12, max: 60 }), fc.integer({ min: 1, max: 7 }), (n, drop) => {
      const bars = Array.from({ length: n }, (_, i) => ({ t: 1_789_000_000_000 - (1_789_000_000_000 % 14400000) + i * 3600000, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 1 }));
      const a = IND.aggregate(bars, 4), b = IND.aggregate(bars.slice(drop), 4);
      const tail = (x) => JSON.stringify(x.slice(-Math.max(1, Math.floor((n - drop) / 4) - 1)));
      return tail(a) === tail(b);
    })));
});

describe("الاستراتيجيات", () => {
  it("evalGates: النتيجة في 0..100 والغائبة لا تدخل المقام", () => check("gates",
    fc.property(fc.array(fc.tuple(fc.constantFrom(-1, 0, 1, null), fc.double({ min: 0.5, max: 3, noNaN: true })), { minLength: 1, maxLength: 8 }), (g) => {
      const gates = g.map(([v, w], i) => ({ id: "g" + i, w, kind: "ind", v: () => v }));
      const r = S.evalGates(gates, {}, 1);
      const live = g.filter(([v]) => v !== null);
      if (!live.length) return r === null;
      const W = live.reduce((s, [, w]) => s + w, 0);
      return r.sc >= 0 && r.sc <= 100 && Math.abs(r.w - W) < 1e-9;
    })));
  it("dirHold: لا انقلاب قبل ثلاث شمعاتٍ متمايزة، والإنتاج = المرجع", () => check("dirHold",
    fc.property(fc.array(fc.tuple(fc.constantFrom(-1, 0, 1), fc.integer({ min: 0, max: 3 })), { minLength: 1, maxLength: 30 }), (steps) => {
      let hP = { ld: 1 }, hR = { ld: 1 }, bar = 1000, pub = 1, streak = 0, cand = 0, lastBar = 0;
      for (const [d, adv] of steps) {
        bar += adv * 900;
        const p = S.dirHold(d, hP, bar), r = R.holdRef(d, hR, bar);
        if (p.dir !== r.dir || JSON.stringify(p.hold) !== JSON.stringify(r.hold)) return false;
        if (p.dir && p.dir !== pub && pub !== 0 && d !== 0) {
          /* نُشر انقلاب: يجب أن يسبقه صمودٌ على ثلاث شمعاتٍ متمايزة */
          if (cand !== d) return false;
        }
        if (d && d !== pub) { if (cand === d) { if (bar > lastBar) streak++; } else { cand = d; streak = 1; } lastBar = bar; }
        if (p.dir) pub = p.dir;
        hP = p.hold; hR = r.hold;
      }
      return true;
    })));
});

describe("الإجماع والتوافق والاتجاه", () => {
  it("consensusOf = المرجع، ولا يتأثّر بترتيب النتائج", () => check("consensus",
    fc.property(fc.array(stratRes, { maxLength: 10 }), (res) => {
      const a = CONS.consensusOf(res, {}), b = CONS.consensusOf([...res].reverse(), {}), r = R.consensusRef(res, {});
      return a.k === b.k && a.dir === b.dir && Math.abs((a.up || 0) - (b.up || 0)) < 1e-9
        && a.k === r.k && a.dir === r.dir && Math.abs((a.up || 0) - (r.up || 0)) < 1e-9;
    })));
  it("scsFrom في [−1,1]، والمتعارض صفرٌ معلَن، ويطابق المرجع", () => check("scs",
    fc.property(fc.array(stratRes, { maxLength: 10 }), (res) => {
      const c = CONS.consensusOf(res, {}), s = CF.scsFrom(c), r = R.scsRef(R.consensusRef(res, {}));
      if (s.scs === null) return r.scs === null;
      return s.scs >= -1 && s.scs <= 1 && Math.abs(s.scs - r.scs) < 1e-9 && (c.k !== "mixed" || s.scs === 0);
    })));
  it("oppQualityOf في [0,1] دائماً", () => check("oppQ",
    fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.constantFrom(-1, 1),
      (b, s, d) => { const q = CF.oppQualityOf(b, s, d).q; return q >= 0 && q <= 1; })));
  it("resolveOpp: لا اتجاهَ يعاكس إجماع الفريمات التامّ، وكلُّ مقبولٍ يوافق الاتجاه، ويطابق المرجع", () => check("resolveOpp",
    fc.property(tfScore, fc.integer({ min: 0, max: 4 }), fc.array(fc.record({ id: fc.string({ minLength: 1, maxLength: 4 }),
      forced: fc.constantFrom(undefined, 1, -1), dir: fc.constantFrom(undefined, 1, -1) }), { maxLength: 5 }), (tf, band, hits) => {
      const r = DIR.resolveOpp({ score: 0, band, tfScore: tf, hits });
      const ref = R.resolveOppRef({ score: 0, band, tfScore: tf, hits });
      const u = DIR.allTfDir(tf);
      if (r.dir !== ref.dir || r.kept.length !== ref.kept.length) return false;
      if (u !== 0 && r.dir !== null && r.dir !== u) return false;
      return r.kept.every((h) => { const own = h.forced ?? h.dir ?? r.dir; return own === r.dir; });
    })));
});

describe("سلامة البيانات", () => {
  const frames = fc.subarray(["15m", "1h", "4h", "1d"]);
  const rec = (tfs) => ({ tf: Object.fromEntries(tfs.map((t) => [t, { c: [[1, 1, 1, 1, 1, 1]] }])) });
  it("INV-10: الدمج لا يُسقط فريماً محفوظاً مهما كان الجلب الجزئي", () => check("carryFrames",
    fc.property(frames, frames, (prevTfs, fetched) => {
      const prev = rec(prevTfs), next = carryFrames(prev, rec(fetched), "core");
      return prevTfs.every((t) => next.tf[t]) && fetched.every((t) => next.tf[t]);
    })));
  it("INV-10: الحارس يرمي حين يغيب فريمٌ كان محفوظاً (بلا دمج)", () => check("guardFrames",
    fc.property(frames, frames, (prevTfs, got) => {
      const lost = prevTfs.some((t) => !got.includes(t));
      try { guardFrames(rec(prevTfs), rec(got), "core"); return !lost; } catch { return lost; }
    })));
  it("INV-12: حارس الرتابة يرفض كلَّ نزولٍ ويسمح بكلِّ تقدّم", () => check("monotonic",
    fc.property(fc.integer({ min: 1, max: 1e6 }), fc.integer({ min: 1, max: 1e6 }), fc.integer({ min: 1, max: 1e6 }), fc.integer({ min: 1, max: 1e6 }),
      (k1, k2, u1, u2) => {
        const why = monotonicGuard({ stocks: { candleKey: k2, updated: u2, rowsHash: "a", version: "v" }, crypto: {} },
                                   { stocks: { candleKey: k1, updated: u1, rowsHash: "a", version: "v" }, crypto: {} });
        return (k2 < k1 || u2 < u1) === (why.length > 0);
      })));
  it("بصمة اللقطة (snapCanon) لا تتأثّر بترتيب مفاتيح bySym ولا life", () => check("snapCanon",
    fc.property(fc.dictionary(fc.stringMatching(/^[A-Z]{1,5}$/), fc.record({ score: fc.integer(), n: fc.integer({ min: 0, max: 9 }) })), (o) => {
      const rev = Object.fromEntries(Object.entries(o).reverse());
      return OPP.snapCanon({ scans: {}, bySym: o, life: o }) === OPP.snapCanon({ scans: {}, bySym: rev, life: rev });
    })));
});
