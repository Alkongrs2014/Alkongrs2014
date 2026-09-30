/* الحالات الذهبية — Oracle للمحرّكين معاً.
   القيم المتوقّعة مكتوبةٌ باليد في JSON (باشتقاقها)، ويُختبر عليها **الإنتاج
   والمرجع كلاهما**. فالمرجع لا يولّد التوقّع الذي يُختبر به الإنتاج. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
import * as M from "../reference/math.mjs";
import * as R from "../reference/engine.mjs";

const require = createRequire(import.meta.url);
const IND = require("../../stocks/indicators.js");
const SC = require("../../stocks/score.js");
const S = require("../../stocks/strategies.js");
const CONS = require("../../stocks/consensus.js");
const CF = require("../../stocks/confluence.js");
const DIR = require("../../stocks/direction.js");

const math = JSON.parse(fs.readFileSync(new URL("./math.json", import.meta.url), "utf8"));
const logic = JSON.parse(fs.readFileSync(new URL("./logic.json", import.meta.url), "utf8"));

const close = (a, b) => {
  if (b === null || b === undefined) return expect(a ?? null).toBe(null);
  if (typeof b === "number") return expect(a).toBeCloseTo(b, 9);
  if (Array.isArray(b)) { expect(a.length).toBe(b.length); b.forEach((x, i) => close(a[i], x)); return; }
  if (typeof b === "object") { for (const k of Object.keys(b)) close(a && a[k], b[k]); return; }
  expect(a).toBe(b);
};

/* المحرّكان بواجهةٍ واحدة لكل دالّة في الحالات */
const ENGINES = {
  production: {
    sma: IND.sma, ema: IND.ema, rsi: IND.rsi, atr: IND.atr, obv: IND.obv,
    macdHist: (a, f, s, g) => IND.macd(a, f, s, g).hist, bbUp: (a, p, m) => IND.bb(a, p, m).up,
    adx: IND.adx, stoch: IND.stoch, mfi: IND.mfi, vwap: IND.sessionVwap,
    openingRange: IND.openingRange, volMedian: IND.volMedian, aggregate: IND.aggregate,
    closedLen: (k, tf, now) => IND.closedBars(k, tf, now).length
  },
  reference: {
    sma: M.smaRef, ema: M.emaRef, rsi: M.rsiRef, atr: M.atrRef, obv: M.obvRef,
    macdHist: (a, f, s, g) => M.macdRef(a, f, s, g).hist, bbUp: (a, p, m) => M.bbRef(a, p, m).up,
    adx: M.adxRef, stoch: M.stochRef, mfi: M.mfiRef, vwap: M.vwapRef,
    openingRange: M.openingRangeRef, volMedian: M.volMedianRef, aggregate: M.aggregateRef,
    closedLen: (k, tf, now) => M.closedRef(k, tf, now).length
  }
};

for (const [eng, F] of Object.entries(ENGINES)) {
  describe(`golden math — ${eng}`, () => {
    for (const c of math.cases) it(c.name, () => close(F[c.fn](...structuredClone(c.args)), c.expect));
  });
}

describe("golden score — production & reference", () => {
  for (const c of logic.score) it(c.name, () => {
    close(SC.scoreFrom(c.in), c.expect);
    close(R.scoreRef(c.in), c.expect);
  });
  for (const c of logic.overall) it("overall " + c.name, () => {
    close(SC.overallScore(c.in), c.expect);
    close(R.overallRef(c.in), c.expect);
  });
  for (const c of logic.band) it(`band ${c.sc}`, () => {
    expect(SC.bandOf(c.sc)).toBe(c.expect);
    expect(R.bandRef(c.sc)).toBe(c.expect);
  });
  for (const c of logic.bandStable) it(`bandStable ${c.sc}←${c.prev}`, () => {
    expect(SC.bandStable(c.sc, c.prev)).toBe(c.expect);
    expect(R.bandStableRef(c.sc, c.prev)).toBe(c.expect);
  });
});

describe("golden gates aggregation", () => {
  for (const c of logic.gates) it(c.name, () => {
    const gates = c.votes.map(([v, w], i) => ({ id: "g" + i, w, kind: "ind", v: () => v }));
    expect(S.evalGates(gates, {}, 1).sc).toBe(c.expect);
    const refG = c.votes.map(([v, w], i) => ["g" + i, w, "ind", () => v]);
    expect(R.gatesRef(refG, {}, 1).sc).toBe(c.expect);
  });
});

describe("golden strategies — production & reference", () => {
  const baseCtx = (x) => Object.assign({ k: {}, bw: {}, lv: {}, row: {}, ik: {}, an: {} }, structuredClone(x));
  for (const c of logic.strategies) it(c.name, () => {
    const st = S.STRAT_BY_ID[c.id], sr = R.STRATS_REF.find((x) => x.id === c.id);
    const p = S.evalStrategy(st, baseCtx(c.ctx), {});
    const r = R.evalStratRef(sr, baseCtx(c.ctx), null);
    for (const [k, v] of Object.entries(c.expect)) { expect(p[k] ?? 0).toBe(v); expect(r[k] ?? 0).toBe(v); }
  });
});

describe("golden consensus & confluence", () => {
  for (const c of logic.consensus) it(c.name, () => {
    const cp = CONS.consensusOf(c.res, {}), cr = R.consensusRef(c.res, {});
    const sp = CF.scsFrom(cp), sr = R.scsRef(cr);
    for (const k of ["dir", "k", "conf", "sc"]) if (k in c.expect) { expect(cp[k]).toBe(c.expect[k]); expect(cr[k]).toBe(c.expect[k]); }
    for (const k of ["up", "dn"]) if (k in c.expect) { close(cp[k], c.expect[k]); close(cr[k], c.expect[k]); }
    close(sp.scs, c.expect.scs); close(sr.scs, c.expect.scs);
    expect(sp.pct).toBe(c.expect.pct); expect(sr.pct).toBe(c.expect.pct);
  });
});

describe("golden direction", () => {
  const ids = (a) => a.map((h) => h.id);
  for (const c of logic.direction) it(c.name, () => {
    const p = DIR.resolveOpp(structuredClone(c.in)), r = R.resolveOppRef(structuredClone(c.in));
    for (const x of [p, r]) {
      expect(x.dir).toBe(c.expect.dir);
      expect(ids(x.kept)).toEqual(c.expect.kept);
      expect(ids(x.dropped)).toEqual(c.expect.dropped);
    }
  });
});

describe("golden direction hold", () => {
  for (const c of logic.hold) it(c.name, () => {
    let hP = structuredClone(c.start), hR = structuredClone(c.start);
    for (const s of c.steps) {
      const p = S.dirHold(s.d, hP, s.bar), r = R.holdRef(s.d, hR, s.bar);
      expect(p.dir).toBe(s.expectDir); expect(r.dir).toBe(s.expectDir);
      expect(p.hold.pn).toBe(s.pn); expect(r.hold.pn).toBe(s.pn);
      hP = p.hold; hR = r.hold;
    }
  });
});
