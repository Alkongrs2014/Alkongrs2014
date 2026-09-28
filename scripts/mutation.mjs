#!/usr/bin/env node
/* اختبار الطفرات — يشغّل Stryker ويلخّص النتيجة لكل ملفّ في
   reports/mutation-summary.json (تقرؤه الصحّة). */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/snapshot.mjs";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const r = spawnSync(npx, ["stryker", "run"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", timeout: 4 * 3600000 });
const rep = JSON.parse(fs.readFileSync(path.join(ROOT, "reports", "mutation-report.json"), "utf8"));
const by = {};
for (const [file, f] of Object.entries(rep.files || {})) {
  const s = by[file] = { killed: 0, survived: 0, timeout: 0, noCoverage: 0, other: 0, survivors: [] };
  for (const m of f.mutants) {
    if (m.status === "Killed") s.killed++;
    else if (m.status === "Timeout") s.timeout++;
    else if (m.status === "Survived") { s.survived++; if (s.survivors.length < 40) s.survivors.push({ line: m.location.start.line, mutator: m.mutatorName, replacement: (m.replacement || "").slice(0, 60) }); }
    else if (m.status === "NoCoverage") s.noCoverage++;
    else s.other++;
  }
  const det = s.killed + s.timeout, valid = det + s.survived + s.noCoverage;
  s.score = valid ? +(det / valid * 100).toFixed(1) : null;
}
const T = Object.values(by).reduce((a, s) => ({ det: a.det + s.killed + s.timeout, all: a.all + s.killed + s.timeout + s.survived + s.noCoverage }), { det: 0, all: 0 });
const summary = { at: new Date().toISOString(), score: +(T.det / T.all * 100).toFixed(1), detected: T.det, total: T.all, files: by };
fs.writeFileSync(path.join(ROOT, "reports", "mutation-summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nالطفرات: ${summary.score}% (${T.det}/${T.all})`);
for (const [f, s] of Object.entries(by)) console.log(`  ${s.score}%  ${f}  (نجت ${s.survived} · بلا تغطية ${s.noCoverage})`);
process.exit(r.status === 0 ? 0 : 1);
