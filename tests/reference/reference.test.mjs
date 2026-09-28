/* =====================================================================
   المحرّك المرجعيّ — استقلالُه ومقارنتُه بالإنتاج على بياناتٍ حقيقية.
   (المثبّتات دائماً؛ و`WEBTRADE_REF_LIVE=1` يضيف لقطةً من data/ محلياً.)
   ===================================================================== */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { structuralChecks, referenceChecks } from "../../scripts/lib/doctor-core.mjs";

const REF_DIR = path.resolve("tests/reference");

describe("استقلال المرجع", () => {
  it("لا ملفَّ في المرجع (عدا المقارِن) يستورد من stocks/ أو scripts/", () => {
    const bad = [];
    for (const f of fs.readdirSync(REF_DIR).filter((x) => /\.mjs$/.test(x) && !/compare|\.test\./.test(x))) {
      const s = fs.readFileSync(path.join(REF_DIR, f), "utf8");
      for (const m of s.matchAll(/(?:import[^"'`]*from\s*|require\(\s*|import\(\s*)["'`]([^"'`]+)["'`]/g))
        if (!/^\.\/[\w.-]+\.mjs$|^node:/.test(m[1])) bad.push(f + " ← " + m[1]);
    }
    expect(bad).toEqual([]);
  });
});

const dirs = [["fixtures", path.resolve("tests/fixtures/data")]];
if (process.env.WEBTRADE_REF_LIVE === "1" && fs.existsSync("data/summary.json")) dirs.push(["live", path.resolve("data")]);

for (const [name, dir] of dirs) {
  describe(`الإنتاج = المرجع — ${name}`, () => {
    const res = [...structuralChecks(dir), ...referenceChecks(dir)];
    for (const r of res) it(`${r.inv} ${r.id}`, () => expect(r.ok, r.detail).toBe(true));
  });
}
