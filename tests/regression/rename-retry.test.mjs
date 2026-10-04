/* إعادة التسمية تصمد أمام قفل ويندوز العابر (EPERM أثناء نسخ مهمّة النشر) ولا تبتلع غيره */
import { describe, it, expect } from "vitest";
import { renameRetry } from "../../scripts/lib/rename-retry.mjs";

const err = (code) => Object.assign(new Error(code), { code });

describe("renameRetry", () => {
  it("EPERM مرّتين ثم نجاح ⇒ تنجح بثلاث محاولات", () => {
    let n = 0; const waits = [];
    renameRetry("a", "b", { rename: () => { if (++n < 3) throw err("EPERM"); }, sleep: (ms) => waits.push(ms) });
    expect(n).toBe(3);
    expect(waits).toEqual([50, 100]);
  });
  it("خطأٌ غير عابر يُرمى فوراً بلا إعادة", () => {
    let n = 0;
    expect(() => renameRetry("a", "b", { rename: () => { n++; throw err("ENOENT"); }, sleep: () => {} })).toThrow("ENOENT");
    expect(n).toBe(1);
  });
  it("العابر الدائم يُرمى بعد استنفاد المحاولات — لا تعليق", () => {
    let n = 0;
    expect(() => renameRetry("a", "b", { tries: 4, rename: () => { n++; throw err("EBUSY"); }, sleep: () => {} })).toThrow("EBUSY");
    expect(n).toBe(4);
  });
});
