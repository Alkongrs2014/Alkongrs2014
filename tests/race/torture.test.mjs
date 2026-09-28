/* غلافُ التعذيب في vitest بعددٍ صغير (`TORTURE=1`). التشغيل الكامل (200+ مرشَّح)
   في `npm run torture` مباشرةً — انظر torture-core.mjs لماذا خارج vitest. */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { runTorture } from "./torture-core.mjs";

describe.skipIf(process.env.TORTURE !== "1")("التعذيب (مصغَّر)", () => {
  it("مرشَّحاتٌ فاسدة وكريبتو فاسد وسباقات — بلا خرق", async () => {
    const r = await runTorture({ fixtures: path.resolve("tests/fixtures/data"), N: Number(process.env.TORTURE_N || 24), rounds: 2 });
    expect(r.violations).toEqual([]);
    expect(r.candidates).toBeGreaterThan(0);
  }, 600000);
});
