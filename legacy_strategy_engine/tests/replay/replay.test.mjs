/* إعادة التشغيل التاريخية — على المثبّتات (CI) أو على الأرشيف الحيّ محلياً
   (`WEBTRADE_REPLAY_LIVE=1`، يشغّله `npm run fortress`). */
import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

it("الإعادة التاريخية بلا خرقٍ حرج — الإنتاج = المرجع عند كل نقطة قطع", () => {
  const live = process.env.WEBTRADE_REPLAY_LIVE === "1" && fs.existsSync("data/summary.json");
  const args = live ? ["scripts/replay-audit.mjs", "--cuts=" + (process.env.REPLAY_CUTS || "40")]
                    : ["scripts/replay-audit.mjs", "--cuts=10", "--dir=tests/fixtures/data", "--archive=tests/fixtures/data"];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 1200000, maxBuffer: 32 << 20 });
  expect(r.status, (r.stdout || "").slice(-1500) + (r.stderr || "").slice(-500)).toBe(0);
  const rep = JSON.parse(fs.readFileSync("reports/replay-report.json", "utf8"));
  expect(rep.sections.timeTravel.analyses).toBeGreaterThan(0);
  expect(rep.sections.timeTravel.diffs).toBe(0);
});
