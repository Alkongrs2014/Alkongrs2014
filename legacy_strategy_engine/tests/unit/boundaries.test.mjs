/* حدودٌ كشفها اختبار الطفرات — كلُّ حالةٍ هنا قتلت طفرةً نجت قبلها. */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SC = require("../../stocks/score.js");

describe("score.js — حدود", () => {
  it("RSI = 45 بالضبط محايد (الحدّ مفتوح)", () => expect(SC.scoreFrom({ rsi: 45 })).toBe(0));
  it("RSI 44.999 يصوّت هبوطاً", () => expect(SC.scoreFrom({ rsi: 44.999 })).toBe(-100));
  it("بلا ATR: تساوٍ تامّ لا يصوّت (tol = 0 لا NaN)", () => expect(SC.scoreFrom({ px: 5, e200: 5 })).toBe(0));
  it("ATR غير منتهٍ يُعامَل صفراً", () => expect(SC.scoreFrom({ px: 5, e200: 5, atr: NaN })).toBe(0));
  it("bandStable: النطاق 0 يُحترم هيستريسسه (لا يُعامَل غائباً)", () => expect(SC.bandStable(-43, 0)).toBe(0));
  it("bandStable: النطاق 4 يُحترم هيستريسسه", () => expect(SC.bandStable(43, 4)).toBe(4));
  it("bandStable: نطاقٌ سابق خارج المدى يُهمل", () => { expect(SC.bandStable(0, 5)).toBe(2); expect(SC.bandStable(0, -1)).toBe(2); });
  it("bandStable: نتيجة غير منتهية ⇒ null ولو وُجد سابق", () => expect(SC.bandStable(NaN, 2)).toBe(null));
  it("labelOf: الوسوم الخمسة مميّزة وغير فارغة", () => {
    const k = [0, 1, 2, 3, 4].map((b) => SC.labelOf(0, b).k);
    expect(new Set(k).size).toBe(5); expect(k.every(Boolean)).toBe(true);
  });
});
