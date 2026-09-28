#!/usr/bin/env node
/* =====================================================================
   التعذيب — `npm run torture`: آلاف الحالات، والثوابت هي الحكم.
     · الخصائص بـ FC_RUNS=10000 (الافتراضي؛ `--runs=N`)
     · مرشَّحاتٌ فاسدة بالجملة على بوّابة النشر + سباقاتٌ متزامنة (TORTURE=1)
     · اختبارات السباق والتحوّل مكرّرةً `--repeat` مرّات (تكشف التذبذب)
   ===================================================================== */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/snapshot.mjs";

const opt = (k, d) => { const a = process.argv.find((x) => x.startsWith(k + "=")); return a ? a.slice(k.length + 1) : d; };
const RUNS = opt("--runs", "10000"), N = opt("--n", "200"), REPEAT = Number(opt("--repeat", "3"));
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (argv, env) => spawnSync(npx, argv, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32",
  env: { ...process.env, ...env }, timeout: 7200000, maxBuffer: 64 << 20 });
const res = [];
const note = (name, r) => {
  const out = ((r.stdout || "") + (r.stderr || "")).replace(/\x1b\[[0-9;]*m/g, "");
  const m = out.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed/);
  res.push({ name, ok: r.status === 0, failed: m ? Number(m[1] || 0) : null, passed: m ? Number(m[2]) : null,
             gate: (out.match(/نتائج البوّابة: (\{[^}]*\})/) || [])[1] || null,
             /* الفشل يُحفظ بسطوره — تقريرٌ يقول «فشل واحد» بلا اسمه لا يُعاد إنتاجه */
             failures: r.status === 0 ? [] : out.split(/\r?\n/).filter((l) => /×|FAIL|→|AssertionError|مثالٌ مضادّ|Error:/.test(l)).slice(0, 30) });
  console.log(`${r.status === 0 ? "✔" : "✗"} ${name} — ${m ? m[0] : out.trim().split("\n").slice(-2).join(" ")}`);
};
note(`الخصائص × ${RUNS}`, run(["vitest", "run", "tests/property"], { FC_RUNS: RUNS }));
/* المرشَّحات الفاسدة والسباقات بلا vitest — مهلةُ RPC فيه تُسقط تشغيلاً ناجحاً */
{
  const { runTorture } = await import("../tests/race/torture-core.mjs");
  const r = await runTorture({ fixtures: path.join(ROOT, "tests", "fixtures", "data"), N: Number(N), log: (m) => console.log("  " + m) });
  res.push({ name: `مرشَّحاتٌ فاسدة × ${N} + كريبتو فاسد + سباقات`, ok: r.ok, passed: null, failed: r.violations.length,
             gate: JSON.stringify(r.gate), failures: r.violations.slice(0, 30),
             detail: { candidates: r.candidates, cryptoCases: r.cryptoCases, raceRounds: r.raceRounds, racePublished: r.racePublished, raceRejected: r.raceRejected } });
  console.log(`${r.ok ? "✔" : "✗"} مرشَّحاتٌ فاسدة × ${r.candidates} · كريبتو ${r.cryptoCases} · سباقات ${r.raceRounds} جولة — البوّابة ${JSON.stringify(r.gate)}`);
}
for (let i = 1; i <= REPEAT; i++) note(`السباقات والتحوّل — تكرار ${i}`, run(["vitest", "run", "tests/race/publish.test.mjs", "tests/metamorphic"]));
const report = { at: new Date().toISOString(), runs: Number(RUNS), candidates: Number(N), repeat: REPEAT,
  status: res.every((r) => r.ok) ? "PASS" : "FAIL", results: res };
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", "torture-report.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.status}`);
process.exit(report.status === "PASS" ? 0 : 1);
