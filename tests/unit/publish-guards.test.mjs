/* حرّاس النشر — وحداتٌ مباشرة لكلّ فرعٍ في `monotonicGuard` و`dupSymbols`
   (اختبارات السباق تغطّيها عبر git، وهذه تقتل طفراتها في مجموعة Stryker السريعة). */
import { describe, it, expect } from "vitest";
import { monotonicGuard, dupSymbols } from "../../scripts/lib/publish.mjs";

const st = (candleKey, updated, rowsHash = "a", version = "s/p") => ({ candleKey, updated, rowsHash, version });
const G = (cs, rs, cc = {}, rc = {}) => monotonicGuard({ stocks: cs, crypto: cc }, { stocks: rs, crypto: rc });

describe("dupSymbols", () => {
  it("لا تكرار ⇒ فارغة", () => expect(dupSymbols([{ s: "A" }, { s: "B" }])).toEqual([]));
  it("يُعيد المكرّر مرّةً واحدة ولو تكرّر ثلاثاً", () => expect(dupSymbols([{ s: "A" }, { s: "A" }, { s: "A" }, { s: "B" }])).toEqual(["A"]));
  it("قائمةٌ غائبة ⇒ فارغة", () => { expect(dupSymbols(null)).toEqual([]); expect(dupSymbols(undefined)).toEqual([]); });
});

describe("monotonicGuard", () => {
  it("تقدّمُ المفتاح والزمن ⇒ مسموح", () => expect(G(st(2, 2), st(1, 1))).toEqual([]));
  it("نفس المفتاح ونفس البصمة وزمنٌ أحدث ⇒ مسموح", () => expect(G(st(1, 2), st(1, 1))).toEqual([]));
  it("المفتاحُ ينزل ⇒ مرفوض", () => expect(G(st(1, 5), st(2, 1)).join()).toMatch(/candleKey ينزل/));
  it("الزمنُ ينزل ⇒ مرفوض", () => expect(G(st(2, 1), st(2, 5)).join()).toMatch(/updated ينزل/));
  it("زمنٌ غائب في أحدهما لا يُحكم به", () => { expect(G(st(2, null), st(2, 5))).toEqual([]); expect(G(st(2, 5), st(2, null))).toEqual([]); });
  it("بصمةٌ أخرى بنفس المفتاح والنسخة ⇒ مرفوض", () => expect(G(st(1, 2, "b"), st(1, 1, "a")).join()).toMatch(/البصمة تغيّرت/));
  it("بصمةٌ أخرى بنفس المفتاح ونسخةٍ أخرى ⇒ مسموح", () => expect(G(st(1, 2, "b", "s/q"), st(1, 1, "a", "s/p"))).toEqual([]));
  it("بصمةٌ أخرى بمفتاحٍ أحدث ⇒ مسموح", () => expect(G(st(2, 2, "b"), st(1, 1, "a"))).toEqual([]));
  it("المرشَّح بلا مفتاح والمنشور يحمله ⇒ مرفوض", () => {
    expect(G(st(null, 2), st(1, 1)).join()).toMatch(/بلا candleKey/);
    expect(monotonicGuard({ stocks: null, crypto: {} }, { stocks: st(1, 1), crypto: {} }).join()).toMatch(/بلا candleKey/);
  });
  it("لا منشورَ سابق لهذا الدفتر ⇒ لا حكم", () => { expect(G(st(1, 1), {})).toEqual([]); expect(G(st(1, 1), null)).toEqual([]); });
  it("الكريبتو يُحكم عليه مستقلاً", () => {
    expect(G(st(2, 2), st(1, 1), st(5, 5), st(6, 6)).join()).toMatch(/crypto: candleKey ينزل/);
    expect(G(st(2, 2), st(1, 1), st(7, 7), st(6, 6))).toEqual([]);
  });
});
