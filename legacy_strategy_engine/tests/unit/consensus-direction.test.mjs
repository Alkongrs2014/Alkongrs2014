/* حدود الإجماع والتوافق والاتجاه — محسوبةٌ يدوياً من STRATEGY_SPECS §6–§7.
   كُتبت لتقتل طفراتٍ نجت (فروعٌ لا تبلغها البيانات الحيّة ولا المرجع). */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../../stocks/consensus.js");
const F = require("../../stocks/confluence.js");
const D = require("../../stocks/direction.js");

describe("marketRegime — الترتيب: انضغاط ← اتجاه ← توسّع ← نطاق ← مختلط", () => {
  const R = (adx, squeeze, tf = "1d") => C.marketRegime({ [tf]: { adx, squeeze } });
  it("انضغاط ≤ 20 يسبق الاتجاه", () => expect(R(40, 20)).toBe("squeeze"));
  it("اتجاه ≥ 25", () => { expect(R(25, 50)).toBe("trend"); expect(R(24.9, 50)).toBe("mixed"); });
  it("توسّع ≥ 80", () => { expect(R(20, 80)).toBe("expansion"); expect(R(20, 79.9)).toBe("mixed"); });
  it("نطاق < 18", () => { expect(R(17.9, 50)).toBe("range"); expect(R(18, 50)).toBe("mixed"); });
  it("اليومي أوّلاً ثم 4س، وبلا حقول ⇒ null", () => {
    expect(C.marketRegime({ "4h": { adx: 30 } })).toBe("trend");
    expect(C.marketRegime({ "1d": { adx: 10 }, "4h": { adx: 30 } })).toBe("range");
    expect(C.marketRegime({ "1d": {} })).toBe(null); expect(C.marketRegime({})).toBe(null);
    expect(R(null, 10)).toBe("squeeze"); expect(R(30, null)).toBe("trend");
  });
});

describe("weightFor — الحافّة والحالة ومدى القصّ", () => {
  it("بلا قياس ⇒ 1 غير مقيس", () => expect(C.weightFor("x", {})).toMatchObject({ w: 1, measured: false }));
  it("حافّة +0.8 ⇒ 1.4 · −2 ⇒ 0.4 (حدّ أدنى) · +3 ⇒ 1.8 (حدّ أعلى)", () => {
    expect(C.weightFor("a", { edge: { a: { edge: 0.8 } } }).w).toBeCloseTo(1.4, 12);
    expect(C.weightFor("a", { edge: { a: { edge: -2 } } }).w).toBeCloseTo(0.4, 12);
    expect(C.weightFor("a", { edge: { a: { edge: 3 } } }).w).toBeCloseTo(1.8, 12);
  });
  it("الحالة تضرب بفارقها عن الحافّة العامة", () => {
    const w = C.weightFor("a", { regime: "trend", edge: { a: { edge: 0.2, byRegime: { trend: 0.6 } } } });
    expect(w.w).toBeCloseTo(1.1 * 1.2, 12); expect(w.reg).toBeCloseTo(0.4, 12);
  });
});

describe("confluenceOf وcompareEngines", () => {
  const cons = { dir: 1, k: "up", agree: 0.7, fams: ["trend", "revert"] };
  const res = [{ dir: 1, active: true, st: "NEW", eq: 60 }];
  it("يتحقّق عند الحدود الدنيا بالضبط", () => expect(C.confluenceOf(cons, res)).not.toBe(null));
  it("يسقط تحت كلّ حدّ", () => {
    expect(C.confluenceOf({ ...cons, agree: 0.69 }, res)).toBe(null);
    expect(C.confluenceOf({ ...cons, fams: ["trend"] }, res)).toBe(null);
    expect(C.confluenceOf(cons, [{ ...res[0], eq: 59 }])).toBe(null);
    expect(C.confluenceOf(cons, [{ ...res[0], st: "LATE" }])).toBe(null);
    expect(C.confluenceOf({ ...cons, k: "mixed" }, res)).toBe(null);
    expect(C.confluenceOf(cons, [{ ...res[0], dir: -1 }])).toBe(null);
  });
  it("compareEngines: اتفاق/تعارض/لا شيء", () => {
    expect(C.compareEngines(1, cons).k).toBe("agree");
    expect(C.compareEngines(-1, cons).k).toBe("clash");
    expect(C.compareEngines(0, cons)).toBe(null);
    expect(C.compareEngines(1, { ...cons, k: "mixed" })).toBe(null);
  });
});

describe("التوافق — الوسم والإنتاج من الصفوف", () => {
  it("dirLabelOf: الوسم يتبع النسبة", () => {
    expect(F.dirLabelOf(1, F.DIR_ON - 1).k).toBe("flat");
    expect(F.dirLabelOf(1, F.DIR_ON).k).toBe("up");
    expect(F.dirLabelOf(-1, F.DIR_STRONG).k).toBe("dn2");
    expect(F.dirLabelOf(0, 100).k).toBe("flat");
    expect(F.DIR_ON).toBe(56);                      // round((2·0.78 − 1)·100)
    expect(F.DIR_STRONG).toBe(78);                  // round((2·8/9 − 1)·100)
  });
  it("oppQualityOf: بلا جهة لا تعديل، وبها ±0.15·scs", () => {
    expect(F.oppQualityOf(0.5, 0.5, 0).q).toBe(0.5);
    expect(F.oppQualityOf(0.5, 0.5, -1).q).toBeCloseTo(0.425, 12);
    expect(F.oppQualityOf(0.99, 1, 1).q).toBe(1);
    expect(F.oppQualityOf(null, 1, 1).q).toBe(null);
  });
  it("consFromRows يحشو غير المتفعّلة إلى العدد الكلّي", () => {
    const { res, cons } = F.consFromRows([{ st: "orb", dir: 1, sc: 80, act: true }], { orb: { fam: "session" } }, { total: 10 });
    expect(res.length).toBe(10); expect(cons.nQuiet).toBe(9); expect(cons.k).toBe("solo");
  });
  it("oldestActiveAt: أقدم نشطة بالملّي، وغير النشطة لا تُحسب", () => {
    expect(F.oldestActiveAt([{ active: true, dir: 1, at: 200 }, { active: true, dir: -1, at: 100 }, { active: false, dir: 1, at: 50 }])).toBe(100000);
    expect(F.oldestActiveAt([])).toBe(null);
  });
});

describe("الاتجاه — resolveDir وأجزاؤه", () => {
  const tfDn = { "15m": -20, "1h": -30, "4h": -16, "1d": -50 };
  it("baseDirOf: النطاق ≤ 1 هبوط، وبلا نطاق حدّ −15", () => {
    expect(D.baseDirOf(50, 1)).toBe(-1); expect(D.baseDirOf(-50, 2)).toBe(1);
    expect(D.baseDirOf(-15, null)).toBe(1); expect(D.baseDirOf(-15.01, null)).toBe(-1); expect(D.baseDirOf(null, null)).toBe(null);
  });
  it("conflictOf: الطرفان المتطرّفان وحدهما", () => {
    expect(D.conflictOf(1, 0)).toBe(true); expect(D.conflictOf(-1, 4)).toBe(true);
    expect(D.conflictOf(1, 1)).toBe(false); expect(D.conflictOf(0, 0)).toBe(false); expect(D.conflictOf(1, null)).toBe(false);
  });
  it("allTfDir: أربعةٌ بالضبط، والحدّ 15 مفتوح", () => {
    expect(D.allTfDir(tfDn)).toBe(-1);
    expect(D.allTfDir({ ...tfDn, "4h": -15 })).toBe(0);
    expect(D.allTfDir({ "1h": -30 })).toBe(0);
    expect(D.allTfDir({ ...tfDn, "5m": -20 })).toBe(0);
    expect(D.allTfDir({ ...tfDn, "1d": null })).toBe(0);
  });
  it("resolveDir: الفرض يغلب إلا ضدّ نطاقٍ متطرّف أو إجماع فريمات", () => {
    expect(D.resolveDir({ score: 0, band: 2, forced: -1, tfScore: {} })).toMatchObject({ dir: -1, forced: -1, conflict: false });
    expect(D.resolveDir({ score: -70, band: 0, forced: 1, tfScore: {} })).toMatchObject({ dir: -1, forced: null, conflict: true });
    expect(D.resolveDir({ score: -20, band: 1, forced: 1, tfScore: tfDn })).toMatchObject({ dir: -1, conflict: true });
    expect(D.resolveDir({ score: 30, band: 3, forced: null, tfScore: tfDn })).toMatchObject({ dir: -1, conflict: false });
    expect(D.resolveDir({ score: 30, band: 3, forced: 1, tfScore: {} })).toMatchObject({ dir: 1, forced: 1 });
  });
});
