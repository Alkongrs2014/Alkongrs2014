#!/usr/bin/env node
/* =====================================================================
   الصحّة — `npm run health`. فحصٌ خفيف دوريّ يكتب reports/health.json.

   يقرأ **المنشور** (بالتزامه المحدَّد، ملفّاتٌ صغيرة وحدها) وتقارير الفحوص
   المحلية ويجمعها في صورةٍ واحدة. وإن كان المنشور معطوباً تقنياً (مخالفة
   مخطّط، تلوّث دفترين، فريمٌ ممنوع) يُستدعى الطبيب الكامل على الالتزام
   المنشور للتأكيد، ثم **يُرجَع إلى آخر نسخة سليمة** — مرّةً، وبإيجار.
   تغيّرُ السوق ليس عطباً ولا يُرجَع بسببه أبداً.

     --ci       في السحابة: قراءةٌ وحدها، بلا رجوع ولا تقارير محلية
     --no-rollback
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "./lib/snapshot.mjs";
import { validateDoc } from "./lib/validate-schemas.mjs";
import { BOOK_SCHEMAS } from "../schemas/index.mjs";
import { rollbackData } from "./lib/publish.mjs";
import { captureFailure } from "./lib/failures.mjs";

const args = process.argv.slice(2);
const CI = args.includes("--ci");
const REPO = "Alkongrs2014/Alkongrs2014";
const rj = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); } catch { return null; } };
const git = (a) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { return null; } };
const lsr = (ref) => { const o = git(["ls-remote", "origin", ref]); return o ? o.split(/\s+/)[0] || null : null; };
const get = async (u) => { const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };

const h = { at: new Date().toISOString(), status: "PASS", problems: [] };
const problem = (sev, what) => { h.problems.push({ sev, what }); if (sev === "CRITICAL") h.status = "FAIL"; else if (h.status === "PASS") h.status = "WARN"; };

/* الإصدار */
h.build = { commit: git(["rev-parse", "HEAD"]), dirty: !!git(["status", "--porcelain"]),
            sw: (fs.readFileSync(path.join(ROOT, "stocks/sw.js"), "utf8").match(/const V = "([^"]+)"/) || [])[1] || null };

/* المنشور */
const dataSha = lsr("refs/heads/data"), lkgSha = lsr("refs/heads/data-lkg"), pagesLkg = lsr("refs/tags/pages-lkg");
h.published = { dataSha, dataLkg: lkgSha, pagesLkg };
if (!lkgSha) problem("WARNING", "لا data-lkg بعد — لا هدف رجوعٍ للبيانات");
let technical = [];
if (dataSha) {
  const base = `https://raw.githubusercontent.com/${REPO}/${dataSha}/`;
  for (const [book, sub] of [["stocks", ""], ["crypto", "crypto/"]]) {
    try {
      const opp = await get(base + sub + "opportunities.json");
      const sum = await get(base + sub + "summary.json");
      const e = [...validateDoc(BOOK_SCHEMAS[book]["opportunities.json"], opp), ...validateDoc(BOOK_SCHEMAS[book]["summary.json"], sum)];
      if (e.length) technical.push(`${book}: ${e.slice(0, 2).join(" · ")}`);
      const age = Math.round((Date.now() - opp.generatedAt) / 60000);
      h.published[book] = { candleKey: opp.candleKey, rowsHash: opp.rowsHash, ageMin: age, rows: sum.rows.length };
      /* توقّفُ الكاتب المحلي: الكريبتو 24/7 فعمرُه مقياسُ حياة الجهاز */
      if (book === "crypto" && age > 180) problem("CRITICAL", `المولِّد متوقّف: لقطة الكريبتو عمرها ${age} دقيقة (الجهاز مطفأ أو المجدول معطّل) — قيد بنيةٍ تحتية`);
      else if (book === "crypto" && age > 30) problem("WARNING", `لقطة الكريبتو عمرها ${age} دقيقة`);
    } catch (e) { technical.push(`${book}: تعذّرت القراءة — ${e.message}`); }
  }
} else problem("CRITICAL", "لا فرع data منشور");

/* عطبٌ تقنيّ في المنشور ⇒ تأكيدٌ بالطبيب الكامل ثم رجوع */
if (technical.length) {
  problem("CRITICAL", "المنشور معطوب: " + technical.join(" | "));
  captureFailure({ source: "health", check: { id: "published.schema", inv: "INV-19", detail: technical.join(" | ") } });
  if (!CI && !args.includes("--no-rollback")) {
    const doc = spawnSync(process.execPath, [path.join(ROOT, "scripts/doctor.mjs"), "--remote", "--no-determinism"], { encoding: "utf8", timeout: 600000 });
    if (doc.status === 1) {
      const rb = await rollbackData({ root: ROOT, reason: technical.join(" | ") });
      h.rollback = rb;
      problem(rb.ok ? "WARNING" : "CRITICAL", rb.ok ? `رُجِع إلى آخر نسخة سليمة ${rb.to.slice(0, 10)}` : "تعذّر الرجوع: " + rb.why);
    } else h.rollback = { ok: false, why: "الطبيب الكامل لم يؤكّد العطب — لا رجوع" };
  }
}

/* التقارير المحلية — أعمارها وحالاتها */
if (!CI) {
  const rep = (f, pick) => { const j = rj("reports/" + f); return j ? pick(j) : null; };
  h.reports = {
    checks: rep("checks-report.json", (j) => ({ at: j.at, pass: j.pass, fail: j.fail })),
    doctor: rep("doctor-report.json", (j) => ({ at: j.at, status: j.status, critical: j.critical })),
    tests: rep("vitest-report.json", (j) => ({ at: new Date(j.startTime).toISOString(), passed: j.numPassedTests, failed: j.numFailedTests })),
    e2e: rep("playwright-report.json", (j) => ({ passed: j.stats && j.stats.expected, failed: j.stats && j.stats.unexpected })),
    verify: rep("verify-report.json", (j) => ({ at: j.at, status: j.status })),
    replay: rep("replay-report.json", (j) => ({ at: j.at, status: j.status })),
    mutation: rep("mutation-summary.json", (j) => ({ at: j.at, score: j.score })),
    lastPublish: rj("reports/publish-last.json")
  };
  if (h.reports.doctor && h.reports.doctor.status === "FAIL") problem("CRITICAL", "آخر طبيبٍ محلي فشل");
  if (h.reports.lastPublish && !h.reports.lastPublish.ok && !["locked", "lease"].includes(h.reports.lastPublish.code))
    problem("WARNING", "آخر نشر لم يمرّ: " + h.reports.lastPublish.why);
  const fails = fs.existsSync(path.join(ROOT, "reports/failures")) ? fs.readdirSync(path.join(ROOT, "reports/failures")).sort() : [];
  h.lastCriticalFailure = fails.length ? fails[fails.length - 1] : null;
}

fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", "health.json"), JSON.stringify(h, null, 2));
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## الصحّة: ${h.status}\n\n` + h.problems.map((p) => `- **${p.sev}** ${p.what}`).join("\n") + "\n");
console.log(`${h.status} — ${h.problems.map((p) => p.sev + ": " + p.what).join(" | ") || "لا مشكلة"}`);
process.exit(h.status === "FAIL" ? 1 : 0);
