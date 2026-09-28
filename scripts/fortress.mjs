#!/usr/bin/env node
/* =====================================================================
   الحصن — `npm run fortress`: الفحص الشامل في أمرٍ واحد، بلا أيّ نموذج لغوي.

     الفحوص الذاتية ← الطبيب (لقطة + مثبّتات) ← vitest كاملاً (ذهبية · وحدات ·
     انحدار · خصائص · تحوّل · سباقات · مرجع على المثبّتات والحيّ · إعادة تاريخية)
     ← Playwright (مثبّتات + لقطةٌ حيّة) ← الصحّة
   وبالخيارات: --verify (الرابط المنشور) · --mutation (Stryker) · --quick (بوّابة الدفع).
   المخرَج reports/fortress-report.json، والخروج بغير صفر عند أيّ فشلٍ حرج.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, takeSnapshot, dropSnapshot } from "./lib/snapshot.mjs";

const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const steps = [];

function step(name, cmd, argv, env = {}, { critical = true } = {}) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${name} … `);
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: "utf8", shell: cmd === npx && process.platform === "win32",
    env: { ...process.env, ...env }, timeout: 3600000, maxBuffer: 64 << 20 });
  const out = (r.stdout || "") + (r.stderr || "");
  const ok = r.status === 0;
  const tail = out.trim().split("\n").filter((l) => l.trim()).slice(-3).join(" | ").replace(/\x1b\[[0-9;]*m/g, "");
  steps.push({ name, ok, critical, ms: Date.now() - t0, tail });
  console.log(`${ok ? "✔" : critical ? "✗" : "⚠"} ${Math.round((Date.now() - t0) / 1000)}ث — ${tail.slice(0, 220)}`);
  return ok;
}

const node = process.execPath;
const hasData = fs.existsSync(path.join(ROOT, "data", "summary.json"));
step("الفحوص الذاتية", node, ["scripts/run-checks.mjs", ...(hasData ? [] : ["--fixtures"])]);
if (hasData) step("الطبيب — لقطة data/", node, ["scripts/doctor.mjs"]);
step("الطبيب — المثبّتات", node, ["scripts/doctor.mjs", "--fixtures"]);
if (QUICK) {
  step("vitest (سريع)", npx, ["vitest", "run", "tests/golden", "tests/unit", "tests/regression", "tests/reference", "tests/race/publish.test.mjs"], { FC_RUNS: "200" });
} else {
  step("vitest (كامل)", npx, ["vitest", "run"], { FC_RUNS: process.env.FC_RUNS || "1000",
    WEBTRADE_REF_LIVE: hasData ? "1" : "", WEBTRADE_REPLAY_LIVE: hasData ? "1" : "" });
  step("Playwright — المثبّتات", npx, ["playwright", "test", "--reporter=line"]);
  if (hasData) {
    const snap = await takeSnapshot({ job: "fortress-e2e" });
    try { step("Playwright — لقطةٌ حيّة", npx, ["playwright", "test", "--reporter=line"], { E2E_DATA: snap, E2E_PORT: "8796" }); }
    finally { dropSnapshot(snap); }
  }
  if (args.includes("--verify")) step("التحقّق من المنشور", node, ["scripts/verify.mjs"]);
  if (args.includes("--mutation")) step("اختبار الطفرات", node, ["scripts/mutation.mjs"], {}, { critical: false });
  step("الصحّة", node, ["scripts/health.mjs"], {}, { critical: false });
}

const failed = steps.filter((s) => !s.ok && s.critical);
const report = { at: new Date().toISOString(), quick: QUICK, status: failed.length ? "FAIL" : "PASS", steps };
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", "fortress-report.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.status} — ${steps.length} خطوة · ${failed.length} فشلٌ حرج`);
process.exit(failed.length ? 1 : 0);
