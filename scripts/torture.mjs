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
             gate: (out.match(/نتائج البوّابة: (\{[^}]*\})/) || [])[1] || null });
  console.log(`${r.status === 0 ? "✔" : "✗"} ${name} — ${m ? m[0] : out.trim().split("\n").slice(-2).join(" ")}`);
};
note(`الخصائص × ${RUNS}`, run(["vitest", "run", "tests/property"], { FC_RUNS: RUNS }));
note(`مرشَّحاتٌ فاسدة × ${N} + سباقات`, run(["vitest", "run", "tests/race/torture.test.mjs"], { TORTURE: "1", TORTURE_N: N }));
for (let i = 1; i <= REPEAT; i++) note(`السباقات والتحوّل — تكرار ${i}`, run(["vitest", "run", "tests/race/publish.test.mjs", "tests/metamorphic"]));
const report = { at: new Date().toISOString(), runs: Number(RUNS), candidates: Number(N), repeat: REPEAT,
  status: res.every((r) => r.ok) ? "PASS" : "FAIL", results: res };
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", "torture-report.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.status}`);
process.exit(report.status === "PASS" ? 0 : 1);
