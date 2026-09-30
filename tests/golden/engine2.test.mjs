/* حالاتٌ ذهبية للمحرّك V2 — كلُّ رقمٍ متوقَّع محسوبٌ يدوياً في التعليق بجانبه
   من docs/ENGINE_V2_SPEC.md، لا مأخوذٌ من تشغيلٍ سابق. */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../../stocks/engine2.js");

const bars = (h, l) => h.map((x, i) => ({ t: i, o: x, h: x, l: l[i], c: x }));

describe("E1 — هيكل القمم والقيعان", () => {
  // قمم محلية (k=3) عند 3 (19) و9 (21) ⇒ أعلى؛ قيعان عند 3 (2) و9 (2.5) ⇒ أعلى ⇒ صاعد
  const hUp = [11, 12, 13, 19, 13, 12, 11, 12, 13, 21, 13, 12, 11, 12];
  const lUp = [5, 4, 3, 2, 3, 4, 5, 4, 3, 2.5, 3, 4, 5, 6];
  it("قمة أعلى وقاع أعلى ⇒ +1", () => expect(E.swingTrend(bars(hUp, lUp))).toBe(1));
  // قمم 21 ثم 19 ⇒ أدنى؛ قيعان 2.5 ثم 2 ⇒ أدنى ⇒ هابط
  const hDn = [11, 12, 13, 21, 13, 12, 11, 12, 13, 19, 13, 12, 11, 12];
  const lDn = [5, 4, 3, 2.5, 3, 4, 5, 4, 3, 2, 3, 4, 5, 6];
  it("قمة أدنى وقاع أدنى ⇒ −1", () => expect(E.swingTrend(bars(hDn, lDn))).toBe(-1));
  it("قمة أعلى وقاع أدنى ⇒ 0", () => expect(E.swingTrend(bars(hUp, lDn))).toBe(0));
  it("أقلّ من قمّتين مؤكَّدتين ⇒ 0", () => expect(E.swingTrend(bars(hUp.slice(0, 11), lUp.slice(0, 11)))).toBe(0));
  it("الوضوح: لا معاكس واثنان في الجهة", () => {
    expect(E.trendClear([1, 1, 0])).toBe(1);
    expect(E.trendClear([1, 1, 1])).toBe(1);
    expect(E.trendClear([1, 1, -1])).toBe(0);     // فريمٌ معاكس ⇒ متعارض
    expect(E.trendClear([1, 0, 0])).toBe(0);      // واحدٌ لا يكفي — المحايد لا يصير شراء
    expect(E.trendClear([-1, 0, -1])).toBe(-1);
  });
});

describe("المستويات وVWAP", () => {
  it("الأسبوع السابق = أعلى/أدنى أيام آخر أسبوعٍ مكتمل", () => {
    const d1 = [{ w: 202601, h: 10, l: 5 }, { w: 202602, h: 12, l: 7 }, { w: 202602, h: 14, l: 6 }, { w: 202603, h: 20, l: 1 }];
    expect(E.prevWeek(d1, 202603)).toEqual({ w: 202602, h: 14, l: 6 });
    expect(E.prevWeek(d1, 202604)).toEqual({ w: 202603, h: 20, l: 1 });
  });
  it("VWAP الجلسة: (10×100 + 12×300) ÷ 400 = 11.5، والجلسة السابقة لا تدخل", () => {
    const b = [{ d: 1, h: 50, l: 50, c: 50, v: 1000 }, { d: 2, h: 11, l: 9, c: 10, v: 100 }, { d: 2, h: 13, l: 11, c: 12, v: 300 }];
    expect(E.vwapToday(b)).toBeCloseTo(11.5, 12);
  });
});

describe("التأكيد والوقف والأهداف", () => {
  const L = [{ id: "PDH", p: 100 }];
  const p = { c: 99.9 };
  it("كسرٌ بإغلاقٍ > المستوى + 0.1×ATR15 وفي النصف الصاعد", () => {
    // buf = 0.2 ؛ 100.5 > 100.2 ؛ (100.5 − 99.8) = 0.7 ≥ 0.5×1.0
    expect(E.findTrigger([p, { h: 100.8, l: 99.8, c: 100.5 }], L, 1, 2)).toEqual(["PDH"]);
  });
  it("إغلاقٌ دون الهامش ⇒ لا تأكيد", () => {
    expect(E.findTrigger([p, { h: 100.8, l: 99.8, c: 100.15 }], L, 1, 2)).toBe(null);
  });
  it("إغلاقٌ في النصف الهابط ⇒ لا تأكيد", () => {
    // المدى 1.7 ونصفه 0.85 ؛ موضع الإغلاق 0.5
    expect(E.findTrigger([p, { h: 101.5, l: 99.8, c: 100.3 }], L, 1, 2)).toBe(null);
  });
  it("السابقة فوق المستوى أصلاً ⇒ ليست كسراً", () => {
    expect(E.findTrigger([{ c: 100.1 }, { h: 100.8, l: 99.8, c: 100.5 }], L, 1, 2)).toBe(null);
  });
  it("الوقف: أدنى 4 قيعان − 0.1×ATR15 = 98.5 − 0.2 = 98.3", () => {
    const b = [{ l: 90, h: 91 }, { l: 99, h: 100 }, { l: 98.5, h: 99 }, { l: 99.2, h: 100 }, { l: 99.8, h: 101 }];
    expect(E.stopOf(b, 1, 2)).toBeCloseTo(98.3, 12);
    expect(E.stopOf(b, -1, 2)).toBeCloseTo(101.2, 12);   // بيع: أعلى 4 قمم + 0.2
  });
  it("الأهداف: الأمامية مرتّبة، ويُدمج ما يبعد < 0.1×ATRd", () => {
    const lv = [{ p: 101 }, { p: 105 }, { p: 101.05 }, { p: 99 }];
    expect(E.targetsOf(100, 1, lv, [], 1)).toEqual([101, 105]);
    expect(E.targetsOf(100, -1, lv, [], 1)).toEqual([99]);
  });
});

describe("إدارة الصفقة وR", () => {
  // دخول معلن 100، وقف 99 ⇒ المخاطرة المعلنة 1؛ ATRd = 1 ⇒ انزلاق 0.05
  const sig = { d: 1, e: 100, st: 99, tg: [101, 102], atrD: 1 };
  const run = (bs) => { let tr = null; for (const b of bs) { tr = tr ? E.stepTrade(tr, b) : E.openTrade(sig, b); if (tr.end) break; } return tr; };
  it("T1 ثم الوقف ينتقل إلى التنفيذ ⇒ خروج «be» بـ R = −0.090090", () => {
    // F = 100.2 + 0.05 = 100.25 ؛ الخروج 100.25 − 0.05 = 100.2
    // (100.2 − 100.25) − 0.0002×(100.25 + 100.2) = −0.05 − 0.04009 = −0.09009
    const tr = run([{ o: 100.2, h: 100.6, l: 100.1, c: 100.5, d: 1 }, { o: 100.5, h: 101.2, l: 100.4, c: 101, d: 1 },
                    { o: 101, h: 101.1, l: 100.2, c: 100.3, d: 1 }]);
    expect(tr.end.k).toBe("be");
    expect(E.tradeR(tr)).toBeCloseTo(-0.09009, 9);
  });
  it("الشمعة التي تلمس الوقف والهدف معاً وقف ⇒ R = −1.33984", () => {
    // خروج 99 − 0.05 = 98.95 ؛ (98.95 − 100.25) − 0.0002×199.2 = −1.3 − 0.03984
    const tr = run([{ o: 100.2, h: 100.6, l: 100.1, c: 100.5, d: 1 }, { o: 100.5, h: 102.5, l: 98.9, c: 100, d: 1 }]);
    expect(tr.end.k).toBe("stop");
    expect(E.tradeR(tr)).toBeCloseTo(-1.33984, 9);
  });
  it("فجوة افتتاحٍ تحت الوقف ⇒ خروجٌ فوري عند الافتتاح، R = −0.13952", () => {
    // F = 98.85 ؛ الخروج 98.8 − 0.05 = 98.75 ؛ (98.75 − 98.85) − 0.0002×197.6 = −0.1 − 0.03952
    const tr = E.openTrade(sig, { o: 98.8, h: 99, l: 98.5, c: 98.9, d: 1 });
    expect(tr.end.k).toBe("stop");
    expect(E.tradeR(tr)).toBeCloseTo(-0.13952, 9);
  });
  it("الانقضاء عند إغلاق الجلسة الخامسة بعد جلسة التنفيذ ⇒ R = −0.04014", () => {
    // F = 100.3 + 0.05 = 100.35 ؛ الخروج 100.4 − 0.05 = 100.35 ؛ 0 − 0.0002×(100.35 + 100.35)
    const bs = [1, 2, 3, 4, 5, 6, 7].map(d => ({ o: 100.3, h: 100.5, l: 100.1, c: 100.4, d, last: true }));
    const tr = run(bs);
    expect(tr.end.k).toBe("exp");
    expect(tr.end.px).toBe(100.4);
    expect(E.tradeR(tr)).toBeCloseTo(-0.04014, 9);
    expect(tr.sess).toBe(5);
  });
  it("بلوغ آخر هدف ⇒ «tgt» عنده", () => {
    const tr = run([{ o: 100.2, h: 100.6, l: 100.1, c: 100.5, d: 1 }, { o: 100.5, h: 102.3, l: 100.4, c: 102, d: 1 }]);
    expect(tr.end).toMatchObject({ k: "tgt", px: 102 });
  });
});
