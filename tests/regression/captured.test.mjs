/* الإخفاقات الملتقَطة المرقّاة — كلُّ مثبِّتٍ يمرّ على الطبيب البنيويّ. عند
   الترقية يكون أحمرَ (العلّة قائمة)، وبعد إصلاحها يصير أخضر ويبقى حارساً. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { structuralChecks } from "../../scripts/lib/doctor-core.mjs";

const DIR = path.resolve("tests/regression/fixtures/captured");
const idx = fs.existsSync(path.join(DIR, "index.json")) ? JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8")) : [];

describe("الإخفاقات الملتقَطة", () => {
  it("الفهرس سليم", () => expect(Array.isArray(idx)).toBe(true));
  for (const c of idx) it(`${c.inv} ${c.id}`, () => {
    const data = path.join(DIR, c.id, "data");
    const res = structuralChecks(data).filter((r) => r.id === c.check && !r.ok);
    expect(res.map((r) => r.detail)).toEqual([]);
  });
});
