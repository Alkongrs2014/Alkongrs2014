/* =====================================================================
   حدود الاستراتيجيات عند العتبة **بالضبط** — ما لا تبلغه البيانات العشوائية.
   كلُّ توقّعٍ من STRATEGY_SPECS §5 (tier: x≥a ⇒ +1 · x≥b ⇒ 0 · وإلا −1)،
   ويُفحص الإنتاج والمرجع كلاهما. كُتبت لتقتل طفرات «≥ ↔ >» التي نجت.
   ===================================================================== */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import * as R from "../reference/engine.mjs";
const require = createRequire(import.meta.url);
const S = require("../../stocks/strategies.js");

const gP = (sid, gid) => S.STRAT_BY_ID[sid].gates.find((g) => g.id === gid).v;
const gR = (sid, gid) => R.STRATS_REF.find((s) => s.id === sid).gates.find((g) => g[0] === gid)[3];
const both = (sid, gid, c, d, want) => { expect(gP(sid, gid)(c, d), `${sid}.${gid} prod`).toBe(want); expect(gR(sid, gid)(c, d), `${sid}.${gid} ref`).toBe(want); };
const k15 = [{}];

describe("عتبات RSI (الحدّ داخلٌ في الأفضل)", () => {
  const c = (rsi) => ({ k: { "15m": k15 }, an: { "15m": { rsi } }, ian: { "15m": { rsi } }, lv: { iTf: "15m" } });
  it("vwapRec.rsiRoom: 65 ⇒ +1 · 65.01 ⇒ 0 · 75 ⇒ 0 · 75.01 ⇒ −1 · وللبيع يُعكس", () => {
    both("vwapRec", "rsiRoom", c(65), 1, 1); both("vwapRec", "rsiRoom", c(65.01), 1, 0);
    both("vwapRec", "rsiRoom", c(75), 1, 0); both("vwapRec", "rsiRoom", c(75.01), 1, -1);
    both("vwapRec", "rsiRoom", c(35), -1, 1); both("vwapRec", "rsiRoom", c(24.99), -1, -1);
  });
  it("meanRev.rsiExt: 30 ⇒ +1 · 40 ⇒ 0 · 40.01 ⇒ −1", () => {
    both("meanRev", "rsiExt", c(30), 1, 1); both("meanRev", "rsiExt", c(40), 1, 0); both("meanRev", "rsiExt", c(40.01), 1, -1);
  });
  it("volSpike.rsiRoom: 70 ⇒ +1 · 80 ⇒ 0 · 80.5 ⇒ −1", () => {
    both("volSpike", "rsiRoom", c(70), 1, 1); both("volSpike", "rsiRoom", c(80), 1, 0); both("volSpike", "rsiRoom", c(80.5), 1, -1);
  });
});

describe("عتبات ADX والقوّة", () => {
  const c = (adx) => ({ k: { "15m": k15 }, an: { "15m": { adx }, "1h": { adx }, "1d": { adx } } });
  it("meanRev.noTrend: 21.99 ⇒ +1 · 22 ⇒ 0 · 28 ⇒ −1", () => {
    both("meanRev", "noTrend", c(21.99), 1, 1); both("meanRev", "noTrend", c(22), 1, 0); both("meanRev", "noTrend", c(28), 1, -1);
  });
  it("brk.adxOn: 22 ⇒ +1 · 16 ⇒ 0 · 15.99 ⇒ −1", () => {
    both("brk", "adxOn", c(22), 1, 1); both("brk", "adxOn", c(16), 1, 0); both("brk", "adxOn", c(15.99), 1, -1);
  });
  it("tfAlign.f1d: 45 ⇒ +1 · 25 ⇒ 0 · 24.9 ⇒ −1 (بالجهة)", () => {
    const s = (x) => ({ an: { "1d": { score: x } } });
    both("tfAlign", "f1d", s(45), 1, 1); both("tfAlign", "f1d", s(25), 1, 0); both("tfAlign", "f1d", s(24.9), 1, -1);
    both("tfAlign", "f1d", s(-45), -1, 1);
  });
  it("meanRev.notCrash: −15 ⇒ +1 · −45 ⇒ 0 · −45.1 ⇒ −1", () => {
    const s = (x) => ({ k: { "15m": k15 }, an: { "1d": { score: x } } });
    both("meanRev", "notCrash", s(-15), 1, 1); both("meanRev", "notCrash", s(-45), 1, 0); both("meanRev", "notCrash", s(-45.1), 1, -1);
  });
});

describe("المسافة بـATR", () => {
  it("momo.notExtended: 2.5 ⇒ +1 · 2.51 ⇒ −1", () => {
    const c = (px) => ({ px, an: { "1h": { atr: 1, e20: 100 } } });
    both("momo", "notExtended", c(102.5), 1, 1); both("momo", "notExtended", c(102.51), 1, -1);
    both("momo", "notExtended", c(97.5), -1, 1);
  });
  it("tfAlign.notExtended: 2 ⇒ +1 · 3.5 ⇒ 0 · 3.51 ⇒ −1", () => {
    const c = (px) => ({ px, an: { "1h": { atr: 1, e20: 100 } } });
    both("tfAlign", "notExtended", c(102), 1, 1); both("tfAlign", "notExtended", c(103.5), 1, 0); both("tfAlign", "notExtended", c(103.51), 1, -1);
  });
  it("volSpike.not52: فجوة 2 ⇒ +1 · 0.5 ⇒ 0 · 0.49 ⇒ −1", () => {
    const c = (w) => ({ px: 100, row: { w52h: w }, lv: { L: { atr: 1 } } });
    both("volSpike", "not52", c(102), 1, 1); both("volSpike", "not52", c(100.5), 1, 0); both("volSpike", "not52", c(100.49), 1, -1);
  });
  it("rsiDiv.atLevel: بُعد 1 ⇒ +1 · 2 ⇒ 0 · 2.01 ⇒ −1 (الدعم للشراء والمقاومة للبيع)", () => {
    const c = (p) => ({ px: 100, lv: { L: { atr: 1, supAll: [{ p }], resAll: [{ p: 200 - p }] } } });
    both("rsiDiv", "atLevel", c(99), 1, 1); both("rsiDiv", "atLevel", c(98), 1, 0); both("rsiDiv", "atLevel", c(97.99), 1, -1);
    both("rsiDiv", "atLevel", c(99), -1, 1);
  });
});

describe("dayAgree وتثبيت اليومي", () => {
  it("dayTrend يُسقَط (null) حين يُثبَّت اليوميّ — لا تصويت دائريّ", () => {
    expect(gP("brk", "trendAgree")({ an: { "1h": { score: 50 } } }, 1)).toBe(1);
    expect(gP("momo", "dayTrend")({ tfPin: "1d", an: { "1d": { score: 90 } } }, 1)).toBe(null);
    expect(gP("momo", "dayTrend")({ an: { "1d": { score: 15 } } }, 1)).toBe(0);
    expect(gP("momo", "dayTrend")({ an: { "1d": { score: 15.1 } } }, 1)).toBe(1);
    expect(gP("momo", "dayTrend")({ an: { "1d": { score: -15.1 } } }, 1)).toBe(-1);
  });
});

describe("وسم قوّة الاستراتيجية وهيستريسسه", () => {
  it("sBandOf: 55 ⇒ 1 · 54.99 ⇒ 0 · 70 ⇒ 2 · 85 ⇒ 3", () => {
    expect(S.sBandOf(55)).toBe(1); expect(S.sBandOf(54.99)).toBe(0); expect(S.sBandOf(70)).toBe(2); expect(S.sBandOf(85)).toBe(3);
    expect(S.sBandOf(NaN)).toBe(null);
  });
  it("sBandStable: الصعود بتجاوز الحدّ بـ3 والنزول تحته بـ3، خطوةً خطوة", () => {
    expect(S.sBandStable(72, 1)).toBe(1); expect(S.sBandStable(73, 1)).toBe(2);
    expect(S.sBandStable(68, 2)).toBe(2); expect(S.sBandStable(67, 2)).toBe(1);
    expect(S.sBandStable(90, 0)).toBe(3); expect(S.sBandStable(50, 3)).toBe(0);
    expect(S.sBandStable(88, 3)).toBe(3); expect(S.sBandStable(53, 0)).toBe(0);
    expect(S.sBandStable(60, 4)).toBe(1); expect(S.sBandStable(60, -1)).toBe(1); expect(S.sBandStable(NaN, 2)).toBe(null);
  });
  it("evalStrategy يطبّق الهيستريسس على الوسم مع السابقة", () => {
    const st = S.STRAT_BY_ID.tfAlign;
    /* f15 0 · f1h 0 · f4h +2 · f1d 0 · adx 0 · notExt +1.5 = 3.5/9.5 ⇒ round(68.4) = 68 */
    const c = { px: 101, an: { "15m": { score: 30 }, "1h": { score: 30, atr: 1, e20: 100 }, "4h": { score: 46 }, "1d": { score: 30, adx: 20 } } };
    expect(S.evalStrategy(st, c, {}).sc).toBe(68);
    expect(S.evalStrategy(st, c, {}).band).toBe(1);                       // بلا سابقة: 68 < 70 ⇒ 1
    expect(S.evalStrategy(st, c, { prev: { band: 2 } }).band).toBe(2);    // 68 > 70−3 ⇒ يبقى 2
  });
});

describe("closedBarTsOf وinRange", () => {
  it("closedBarTsOf: آخر ختم من السلسلة الجارية ثم الرسمية", () => {
    expect(S.closedBarTsOf({ ik: { "1h": [{ t: 5 }, { t: 9 }] }, k: {} }, "1h")).toBe(9);
    expect(S.closedBarTsOf({ k: { "1h": [{ t: 3 }] } }, "1h")).toBe(3);
    expect(S.closedBarTsOf({ k: {} }, "1h")).toBe(null);
    expect(S.closedBarTsOf({ k: { "1h": [{ t: NaN }] } }, "1h")).toBe(null);
  });
  it("inRange: الطرفان داخل، وربع العرض خارجهما 0", () => {
    expect(S.inRange(0.5, 0.5, 2.5)).toBe(1); expect(S.inRange(2.5, 0.5, 2.5)).toBe(1);
    expect(S.inRange(0, 0.5, 2.5)).toBe(0); expect(S.inRange(-0.01, 0.5, 2.5)).toBe(-1);
    expect(S.inRange(3, 0.5, 2.5)).toBe(0); expect(S.inRange(3.01, 0.5, 2.5)).toBe(-1); expect(S.inRange(NaN, 0, 1)).toBe(null);
  });
});
