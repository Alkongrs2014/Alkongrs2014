#!/usr/bin/env node
/* =====================================================================
   طبيب الموقع — `npm run doctor`. بلا شبكة (عدا `--remote`)، وبلا أيّ نموذج لغوي.

   يفحص كلَّ ثابتٍ في `docs/INVARIANTS.md` على **لقطةٍ ثابتة**:
     الافتراضي    نسخةٌ من data/ تحت قفل الكاتب
     --fixtures   مثبّتات الاختبار المجمَّدة (CI)
     --remote     الالتزام المنشور على فرع data (ما يراه المستخدم فعلاً)
     --dir=PATH   مجلّدٌ بعينه
   ويكتب reports/doctor-report.json، ويخرج PASS/FAIL بسببٍ دقيق.
   ويحفظ كلَّ فشلٍ حرج في reports/failures/ بمدخلاته (قابلٌ لإعادة الإنتاج).
   ===================================================================== */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { ROOT, takeSnapshot, dropSnapshot } from "./lib/snapshot.mjs";
import { structuralChecks, referenceChecks } from "./lib/doctor-core.mjs";
import { captureFailure } from "./lib/failures.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (k) => { const a = args.find((x) => x.startsWith(k + "=")); return a ? a.slice(k.length + 1) : null; };

async function source() {
  if (opt("--dir")) return { dir: path.resolve(opt("--dir")), kind: "dir", drop: false };
  /* نسخةٌ من المثبّتات لا المثبّتات نفسها: فحصُ الحتمية يشغّل المحرّك فيكتب سجلَّ
     تشغيله في مجلّده — وقع فعلاً (crypto/logs داخل المثبّتات الملتزمة) */
  if (has("--fixtures")) return { dir: await takeSnapshot({ src: path.join(ROOT, "tests", "fixtures", "data"), job: "doctor" }), kind: "fixtures", drop: true };
  if (has("--remote")) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "webtrade-doc-remote-"));
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).trim();
    execFileSync("git", ["init", "-q"], { cwd: work });
    execFileSync("git", ["fetch", "-q", "--depth", "1", url, "refs/heads/data"], { cwd: work });
    execFileSync("git", ["checkout", "-q", "FETCH_HEAD"], { cwd: work });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: work, encoding: "utf8" }).trim();
    return { dir: work, kind: "remote@" + sha.slice(0, 10), drop: true };
  }
  return { dir: await takeSnapshot({ job: "doctor" }), kind: "snapshot", drop: true };
}

function determinism(dir) {
  /* INV-20/24 للمحرّك V3: بناءان مستقلّان من نفس مخزن SIP بنفس الساعة ⇒ نفس
     البصمة حرفياً. المخزن خارج اللقطة (40 م.ب)، فيُقرأ من data/bars للقراءة
     وحدها؛ وغيابُه (المثبّتات · المنشور) يُتخطّى ويُقال. */
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/lib/determinism-v3.mjs"), dir],
    { encoding: "utf8", timeout: 300000, maxBuffer: 16 << 20 });
  try {
    const j = JSON.parse((r.stdout || "").trim().split("\n").pop());
    return j.checks.map((c) => ({ ...c, sev: c.sev || "CRITICAL" }));
  } catch {
    return [{ id: "determinism.v3", inv: "INV-20", sev: "CRITICAL", ok: false,
              detail: "تعذّر التشغيل: " + (r.stderr || "").trim().split("\n").slice(-2).join(" ") }];
  }
}

/* الطزاجة — WARNING: توقّفُ المجدول قيدُ بنيةٍ تحتية لا خللُ حساب */
function freshness(dir, kind) {
  const out = [];
  const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")); } catch { return null; } })();
  if (!meta || kind === "fixtures") return out;
  const now = Date.now();
  for (const [k, cycMin] of [["marketUpdated", 30], ["optionsUpdated", 30], ["dailyUpdated", 26 * 60]]) {
    const v = meta[k]; if (!Number.isFinite(v)) continue;
    const age = (now - v) / 60000;
    out.push({ id: "fresh." + k, inv: "INFO", sev: "WARNING", ok: age <= cycMin * 3, detail: `عمره ${Math.round(age)} دقيقة (الدورة ${cycMin})` });
  }
  return out;
}

const t0 = Date.now();
const src = await source();
let results = [];
try {
  results = [
    ...structuralChecks(src.dir),
    ...referenceChecks(src.dir),
    ...(has("--no-determinism") ? [] : determinism(src.dir)),
    ...freshness(src.dir, src.kind)
  ];
} finally {
  /* الفشل الحرج يُحفظ بمدخلاته قبل حذف اللقطة — وإلا ضاع ما يعيد إنتاجه */
  const crit = results.filter((r) => !r.ok && r.sev === "CRITICAL");
  for (const c of crit) captureFailure({ source: "doctor", check: c, dataDir: src.dir });
  if (src.drop) (src.kind === "snapshot" || src.kind === "fixtures" ? dropSnapshot(src.dir) : fs.rmSync(src.dir, { recursive: true, force: true }));
}

const crit = results.filter((r) => !r.ok && r.sev === "CRITICAL");
const warn = results.filter((r) => !r.ok && r.sev === "WARNING");
const report = { at: new Date().toISOString(), source: src.kind, ms: Date.now() - t0,
  status: crit.length ? "FAIL" : "PASS", critical: crit.length, warnings: warn.length,
  checks: results.length, results };
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", has("--remote") ? "doctor-remote-report.json" : "doctor-report.json"),
  JSON.stringify(report, null, 2));

for (const r of results) {
  const tag = r.ok ? (r.sev === "INFO" ? "ℹ" : "✔") : (r.sev === "CRITICAL" ? "✗" : "⚠");
  if (!r.ok || has("--verbose") || r.sev === "INFO") console.log(`${tag} ${r.inv.padEnd(9)} ${r.id}${r.detail ? " — " + r.detail : ""}`);
}
console.log(`\n${report.status} — ${results.length} فحصاً · ${crit.length} حرج · ${warn.length} تحذير · ${src.kind} · ${report.ms}ms`);
process.exit(crit.length ? 1 : 0);
