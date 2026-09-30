/* مدقّق التوصية: سجلٌّ سليم ⇒ D، مدخلاتٌ عُبث بها ⇒ B، عرضٌ مخالف ⇒ C. */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { auditStamp, closedInputs } from "../../scripts/lib/audit-trail.mjs";

const require = createRequire(import.meta.url);
const IND = require("../../stocks/indicators.js");
const SC = require("../../stocks/score.js");
const P = require("../../stocks/plan.js");

let dir;
const run = (...a) => JSON.parse(spawnSync(process.execPath, ["scripts/audit-rec.mjs", ...a],
  { encoding: "utf8", env: { ...process.env, WEBTRADE_DATA: dir } }).stdout);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-aud-"));
  const sym = JSON.parse(fs.readFileSync("tests/fixtures/data/sym/NVDA.json", "utf8"));
  const summary = JSON.parse(fs.readFileSync("tests/fixtures/data/summary.json", "utf8"));
  const row = summary.rows.find((r) => r.s === "NVDA");
  const aud = auditStamp({ sym: "NVDA", symRec: sym, row, ck: row.cbar, outDir: dir });
  const byP = {};
  for (const [tf, c] of Object.entries(closedInputs(sym, row.cbar))) { const a = IND.analyze(P.unpackK(c)); if (a) byP[tf] = a; }
  const sc = Math.round(SC.overallScore(byP) * 100) / 100;
  const snap = { dir: 1, e: 100, st: 95, t: [110] };
  fs.writeFileSync(path.join(dir, "signals.json"), JSON.stringify({ records: [
    { sym: "NVDA", scan: "align", at: Date.now(), sc, aud, snap, out: { st: "wait" } }] }));
});

describe("مدقّق التوصية", () => {
  it("سجلٌّ سليم على مدخلاته ⇒ D (حُسبت صحيحةً)", () => expect(run("NVDA").class).toBe("D"));
  it("ما رآه المستخدم يخالف اللقطة ⇒ C", () => expect(run("NVDA", "--shown=101,95,110").class).toBe("C"));
  it("مدخلاتٌ عُبث بها بعد الختم ⇒ B", () => {
    const f = fs.readdirSync(path.join(dir, "audit")).map((d) => path.join(dir, "audit", d, fs.readdirSync(path.join(dir, "audit", d))[0]))[0];
    const a = JSON.parse(fs.readFileSync(f, "utf8"));
    a.inputs["1d"][5][4] *= 1.01;
    fs.writeFileSync(f, JSON.stringify(a));
    expect(run("NVDA").class).toBe("B");
  });
});
