/* =====================================================================
   REG-REBUILD-IDEMPOTENT — بناءان للشمعة الواحدة يجب أن يتطابقا.

   وقع 2026-09-29: خطةٌ ضُرب وقفُها داخل الشمعة الجارية تُنهى في البناء
   الأوّل، والبناءُ الثاني داخل نفس الشمعة كان يقرأ ذلك الانتهاء «سابقاً»
   فيجدّدها فرصةً جديدة — فيختلف المحسوب عن المنشور (INV-20 متقطّعاً).
   على المثبّتات المجمَّدة وحدها، بلا كتابة.
   ===================================================================== */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildSnapshot } from "../../scripts/build-opportunities.mjs";

const BASE = path.resolve("tests/fixtures/data");
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(BASE, f), "utf8")); } catch { return null; } };
const io = (doc) => ({ rd: (f) => (f === "opportunities.json" ? doc : rd(f)), sym: (s) => rd("sym/" + s + ".json") });

describe("إعادة البناء داخل الشمعة", () => {
  it("REG-REBUILD-IDEMPOTENT: وقفٌ داخل الشمعة لا يجعل البناء الثاني يجدّد الخطة", () => {
    const now = rd("strategies.json").updated;
    const pub = structuredClone(rd("opportunities.json"));
    let forced = 0;
    for (const L of Object.values(pub.life || {})) {
      if (L.end || L.d !== 1 || forced >= 5) continue;
      L.in = 1; L.st = 1e9; L.upto = pub.candleKey - 3 * 900; forced++;   // صفٌّ عاد بعد غياب: شمعاتٌ لم تُمشَ
    }
    const s1 = buildSnapshot(now, io(pub));
    expect(s1.ok).toBe(true);
    const s2 = buildSnapshot(now, io({ ...pub, candleKey: s1.candleKey, life: s1.life, scans: s1.scans, bySym: s1.bySym }));
    expect(s2.rowsHash).toBe(s1.rowsHash);
    if (forced) expect(Object.values(s1.life).some((L) => L.end && L.end.k === "stop")).toBe(true);
  });
});
