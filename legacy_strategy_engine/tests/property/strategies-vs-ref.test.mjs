/* =====================================================================
   الاستراتيجيات العشر: الإنتاج = المرجع المستقلّ على سياقاتٍ مولَّدة.

   المقارنة على البيانات الحيّة لا تمرّ إلا بالفروع التي تصادفها اللقطة —
   لقطةُ عطلةٍ لا تُفعِّل استراتيجيتَي الجلسة أبداً، فنجت طفراتُ شروطهما
   في اختبار الطفرات. هنا تُولَّد سياقاتٌ تغطّي الجهتين والعتبات والغياب،
   ويُطلب التطابق في التعذّر والجهة والنتيجة والتفعيل لكلّ استراتيجية.
   ===================================================================== */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createRequire } from "node:module";
import * as R from "../reference/engine.mjs";

const require = createRequire(import.meta.url);
const S = require("../../stocks/strategies.js");
const RUNS = Number(process.env.FC_RUNS || 1000);

const px = 100;
const near = (lo, hi) => fc.double({ min: lo, max: hi, noNaN: true, noDefaultInfinity: true });
const opt = (arb) => fc.option(arb, { nil: undefined, freq: 6 });
const analysis = fc.record({
  score: near(-100, 100), px: near(90, 110), e20: near(92, 108), e50: near(90, 110), e200: near(85, 115),
  rsi: opt(near(0, 100)), hist: opt(near(-2, 2)), histRising: fc.boolean(), atr: fc.oneof(near(0.2, 4), fc.constant(0)),
  bbUp: near(101, 106), bbLo: near(94, 99), bbMid: near(98, 102), adx: opt(near(5, 45)),
  stochK: opt(near(0, 100)), stochD: opt(near(0, 100)), mfi: opt(near(0, 100)), obvSlope: opt(near(-20, 20)),
  div: fc.option(fc.record({ dir: fc.constantFrom(-1, 1), bars: fc.integer({ min: 1, max: 30 }) }), { nil: null })
});
const bars = (n) => fc.array(fc.record({ h: near(100, 106), l: near(94, 100), c: near(95, 105), v: fc.oneof(near(100, 5000), fc.constant(0)) }),
  { minLength: n, maxLength: n + 30 }).map((a) => a.map((b, i) => ({ t: 1_790_000_000_000 + i * 900000, o: b.c, h: Math.max(b.h, b.c), l: Math.min(b.l, b.c), c: b.c, v: b.v })));
const widths = fc.array(near(0.005, 0.2), { minLength: 40, maxLength: 70 });
const TF = ["15m", "1h", "4h", "1d"];

const ctxArb = fc.record({
  px: near(92, 108),
  an: fc.record(Object.fromEntries(TF.map((t) => [t, opt(analysis)]))),
  k: fc.record(Object.fromEntries(TF.map((t) => [t, opt(bars(30))]))),
  bw: fc.record(Object.fromEntries(TF.map((t) => [t, opt(widths)]))),
  vwap: fc.option(fc.record({ vwap: near(97, 103), sd: near(0.2, 2) }), { nil: null }),
  or: fc.option(fc.record({ hi: near(100, 104), lo: near(96, 100), complete: fc.boolean() }), { nil: null }),
  L: fc.option(fc.record({ atr: near(0.5, 3), sup: near(90, 99.9), res: near(100.1, 110) }), { nil: null }),
  w52h: opt(near(101, 140)), w52l: opt(near(60, 99)),
  sess: fc.constantFrom("REGULAR", "CLOSED", "PRE"), today: fc.boolean(), short: fc.boolean(),
  /* انحيازٌ اتجاهيّ في ثلث الحالات: يوحّد إشارة الفريمات ويصنع اتجاهاً أمّاً
     وتراجعاً — وإلا لم يبلغ المولِّدُ فروعَ tfAlign وpbTrend أبداً */
  bias: fc.constantFrom(0, 0, 0, 1, -1, 1, -1), rsiPb: near(33, 52)
}).map((g) => {
  if (g.bias) for (const [t, a] of Object.entries(g.an)) {
    if (!a) continue;
    a.score = g.bias * (16 + Math.abs(a.score) * 0.84);
    if (t === "4h" || t === "1d") { a.e200 = 100 - g.bias * 5; a.e50 = a.e200 + g.bias * 2; a.px = a.e200 + g.bias * 6; }
    if (t === "1h" && a.atr > 0) { a.e20 = g.px + g.bias * a.atr * 1.3; a.rsi = g.bias > 0 ? g.rsiPb : 100 - g.rsiPb; }
  }
  const an = Object.fromEntries(Object.entries(g.an).filter(([, v]) => v));
  const k = Object.fromEntries(Object.entries(g.k).filter(([, v]) => v));
  const bw = Object.fromEntries(Object.entries(g.bw).filter(([, v]) => v));
  return {
    px: g.px, an, ian: an, k, ik: k, bw, row: { w52h: g.w52h, w52l: g.w52l },
    sess: g.sess, win: { start: 1_790_000_000_000, end: 1_790_023_400_000 }, today: g.today,
    lv: { iTf: k["15m"] ? "15m" : null, short: g.short,
          vwap: g.vwap ? { vwap: g.vwap.vwap, upper: g.vwap.vwap + g.vwap.sd, lower: g.vwap.vwap - g.vwap.sd } : null,
          or: g.or, L: g.L ? { atr: g.L.atr, supAll: [{ p: g.L.sup }], resAll: [{ p: g.L.res }] } : null }
  };
});

describe("الاستراتيجيات العشر — الإنتاج = المرجع على سياقاتٍ مولَّدة", () => {
  for (const st of S.STRATEGIES) it(st.id, () => {
    const sr = R.STRATS_REF.find((x) => x.id === st.id);
    let active = 0;
    const r = fc.check(fc.property(ctxArb, (c) => {
      const p = S.evalStrategy(st, c, {}), q = R.evalStratRef(sr, c, null);
      if (!!p.off !== !!q.off) return false;
      if ((p.dir || 0) !== (q.dir || 0) || (p.sc ?? null) !== (q.sc ?? null) || !!p.active !== !!q.active) return false;
      if (p.dir) active++;
      return true;
    }), { numRuns: RUNS, seed: 20260928 });
    expect(r.failed, r.failed ? JSON.stringify(r.counterexample).slice(0, 600) : "").toBe(false);
    /* الفحص بلا معنى إن لم تتفعّل الاستراتيجية في العيّنة */
    expect(active, "لم تتفعّل الاستراتيجية في العيّنة — المولِّد لا يبلغ فروعها").toBeGreaterThan(RUNS / 200);
  });
});
