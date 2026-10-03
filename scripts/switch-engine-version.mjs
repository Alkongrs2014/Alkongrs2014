#!/usr/bin/env node
/* =====================================================================
   التبديل بين V3 وV4 — الكود والبيانات والنشر (docs/VERSIONS.md).

   لا يُنفَّذ إلا بطلب المالك. افتراضياً **تشغيلٌ جافّ** يطبع الخطة ولا يغيّر شيئاً.

     node scripts/switch-engine-version.mjs --to v3                     خطةٌ فقط
     node scripts/switch-engine-version.mjs --to v3 --apply --no-merge  يجهّز ويفحص في worktree ولا يمسّ main
     node scripts/switch-engine-version.mjs --to v3 --apply             يجهّز ويفحص ثم يُقدِّم main خطوةً واحدة
     node scripts/switch-engine-version.mjs --to v4 [...]               العودة إلى V4 بنفس الطريقة

   لماذا worktree ثم تقديمٌ واحد: المجدول يشغّل الشجرة الرئيسية كلَّ دقائق، وتعديلُ ملفّاتها واحداً
   واحداً نشر نصفَ نسخةٍ مرّةً (2026-10-03). فالملفّات تُستعاد وتُفحص بعيداً عنه، ثم ينتقل main
   بـ`git merge --ff-only` — تبديلٌ ذرّي تقريباً.

   ما يفعله --apply:
     ١) worktree مؤقّت من HEAD، وفيه: كلُّ ملفٍّ يختلف بين v3-stable وv4.0.0 يُستعاد من الوسم الهدف
        (والمضاف في V4 يُحذف عند الرجوع إلى V3)، إلا أدوات الإصدارات نفسها.
     ٢) عامل الخدمة: `V` يُرفع فوق الحالي دائماً (لا يُعاد رقمٌ قديم) و`SHELL_SHA` يُعاد حسابه —
        وإلا بقيت المتصفّحات على الهيكل المخزَّن للنسخة الأخرى.
     ٣) الفحوص: check-ui · node --check · build-trades --check · اختبارات engine3 — وأيُّ فشلٍ يوقف.
     ٤) التزامٌ على فرع switch-<to>-<وقت>، ثم (بلا --no-merge) تقديم main إليه.
     ٥) الحالة: trades-state.json للدفترين يُنقل (لا يُحذف) إلى data/.archive/، ثم تُبنى trades.json
        بالكود الهدف من مخزن الشموع نفسه.
   لا يدفع شيئاً: يطبع أمر الدفع، والنشر بعده كالعادة (site.yml للواجهة، WebTrade-Publish للبيانات).
   ===================================================================== */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const has = (k) => process.argv.includes(`--${k}`);
const TO = arg("to"), APPLY = has("apply"), NOMERGE = has("no-merge");
const TAG = { v3: "v3-stable", v4: "v4.0.0" }[TO];
if (!TAG) { console.error("الاستعمال: --to v3 | --to v4  [--apply] [--no-merge]"); process.exit(2); }
// أدوات الإصدارات تبقى كما هي في الاتجاهين — لا يمحو الرجوعُ وسيلةَ العودة
const KEEP = new Set(["scripts/switch-engine-version.mjs", "docs/VERSIONS.md"]);
const git = (args, cwd = ROOT) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const step = (m) => console.log("▶ " + m);
/* قبل الـworktree يخرج فوراً؛ وبعده يرمي كي يمرّ بـ`finally` فيُزال رابط node_modules قبل أيّ حذف —
   مجلّدٌ مؤقّت يُحذف بمحتواه وفيه رابطٌ إلى node_modules الحقيقي كان سيفرغه */
let inWt = false;
const die = (m) => { if (inWt) throw new Error(m); console.error("✗ " + m); process.exit(1); };

for (const t of ["v3-stable", "v4.0.0"]) { try { git(["rev-parse", "--verify", t + "^{commit}"]); } catch { die(`الوسم ${t} غير موجود محلياً — git fetch --tags`); } }
const paths = git(["diff", "--name-only", "v3-stable", "v4.0.0"]).split("\n").filter((p) => p && !KEEP.has(p));
const head = git(["rev-parse", "--short", "HEAD"]);
const later = git(["diff", "--name-only", "v4.0.0", "HEAD"]).split("\n").filter((p) => paths.includes(p));
const exists = (ref, p) => { try { git(["cat-file", "-e", `${ref}:${p}`]); return true; } catch { return false; } };

console.log(`\nالتبديل إلى ${TO.toUpperCase()} (${TAG} = ${git(["rev-parse", "--short", TAG + "^{commit}"])}) من HEAD ${head}`);
console.log(`ملفّات الفرق بين الإصدارين: ${paths.length}`);
for (const p of paths) console.log(`   ${exists(TAG, p) ? "استعادة" : "حذف    "}  ${p}`);
if (later.length) console.log(`\n⚠ تعديلاتٌ بعد v4.0.0 على ملفّاتٍ ستُستعاد (تُفقد في الهدف — راجعها):\n   ${later.join("\n   ")}`);
console.log(`\nالبيانات: trades-state.json للدفترين يُنقل إلى data/.archive/، ثم trades.json يُعاد بناؤه بكود ${TO.toUpperCase()}.`);
console.log(`بيانات V3 المنشورة محفوظة في الوسم data-v3-stable وفي data/.archive/v3-stable-2026-10-03/.`);
if (!APPLY) { console.log("\n(تشغيلٌ جافّ — لا تغيير. أضف --apply للتنفيذ، و--no-merge للتجهيز والفحص دون مسّ main)\n"); process.exit(0); }

if (git(["status", "--porcelain", "--untracked-files=no"])) die("الشجرة الرئيسية فيها تعديلاتٌ غير ملتزمة");
if (git(["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") die("ليست على main");

/* ١) worktree مؤقّت واستعادة الملفّات */
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
const branch = `switch-${TO}-${stamp}`;
const wt = fs.mkdtempSync(path.join(os.tmpdir(), "wt-switch-"));
fs.rmSync(wt, { recursive: true, force: true });
step(`worktree ${wt} على فرع ${branch}`);
git(["worktree", "add", "-q", "-b", branch, wt, "HEAD"]);
let nm = null, code = 0;
inWt = true;
const cleanup = () => {
  if (nm) spawnSync("cmd", ["/c", "rmdir", nm], { stdio: "ignore" });     // الرابط وحده لا محتواه
  try { git(["worktree", "remove", "--force", wt]); } catch { /* يدوياً */ }
};
try {
  const present = paths.filter((p) => exists(TAG, p)), gone = paths.filter((p) => !exists(TAG, p));
  if (present.length) git(["checkout", TAG, "--", ...present], wt);
  for (const p of gone) if (fs.existsSync(path.join(wt, p))) git(["rm", "-q", "--", p], wt);

  /* ٢) عامل الخدمة: رقمٌ أعلى من الحالي وبصمةٌ جديدة */
  const swF = path.join(wt, "stocks/sw.js");
  const curV = +(/const V = "webtrade-v(\d+)"/.exec(fs.readFileSync(path.join(ROOT, "stocks/sw.js"), "utf8")) || [])[1];
  if (!Number.isFinite(curV)) die("تعذّرت قراءة V الحالي من sw.js");
  let sw = fs.readFileSync(swF, "utf8").replace(/const V = "webtrade-v\d+";/, `const V = "webtrade-v${curV + 1}";`);
  fs.writeFileSync(swF, sw);
  const ui = spawnSync(process.execPath, ["scripts/check-ui.mjs"], { cwd: wt, encoding: "utf8" });
  const sha = /SHELL_SHA = "([0-9a-f]{12})"/.exec(ui.stdout || "");
  if (sha) { sw = sw.replace(/const SHELL_SHA = "[0-9a-f]+";/, `const SHELL_SHA = "${sha[1]}";`); fs.writeFileSync(swF, sw); }
  step(`عامل الخدمة: V ← webtrade-v${curV + 1}${sha ? " · SHELL_SHA ← " + sha[1] : ""}`);

  /* ٣) الفحوص — أيُّ فشلٍ يوقف قبل الالتزام */
  nm = path.join(wt, "node_modules");
  spawnSync("cmd", ["/c", "mklink", "/J", nm, path.join(ROOT, "node_modules")], { stdio: "ignore" });
  const checks = [
    ["check-ui", process.execPath, ["scripts/check-ui.mjs"]],
    ["build-trades --check", process.execPath, ["scripts/build-trades.mjs", "--check"]],
    ["node --check", process.execPath, ["--check", "stocks/engine3.js"]],
    ["اختبارات engine3", process.execPath, [path.join(ROOT, "node_modules/vitest/vitest.mjs"), "run", "tests/regression/engine3-lifecycle.test.mjs",
      "tests/regression/engine3-fresh-entry.test.mjs", "tests/property/engine3-vs-ref.test.mjs"]]
  ];
  for (const [name, cmd, a] of checks) {
    const r = spawnSync(cmd, a, { cwd: wt, encoding: "utf8", timeout: 900000 });
    if (r.status !== 0) die(`${name} فشل:\n${((r.stdout || "") + (r.stderr || "")).split("\n").slice(-15).join("\n")}`);
    step(`✓ ${name}`);
  }

  /* ٤) الالتزام */
  git(["add", "-A", "--", "stocks", "scripts", "tests", "docs", "schemas", "CLAUDE.md"], wt);
  git(["commit", "-q", "-m", `التبديل إلى ${TO.toUpperCase()} (${TAG}) — الكود من الوسم، وعامل الخدمة webtrade-v${curV + 1} (docs/VERSIONS.md)`], wt);
  const c = git(["rev-parse", "--short", "HEAD"], wt);
  step(`التزام ${c} على ${branch}`);
  if (NOMERGE) {
    console.log(`\n✔ جاهزٌ ومفحوص على الفرع ${branch} (${c}) — main لم يُمَسّ (--no-merge).\n  لحذف التجربة: git branch -D ${branch}\n`);
  } else {
  /* ٥) تقديم main ثم البيانات */
  git(["merge", "--ff-only", "-q", branch]);
  step(`main ← ${c}`);
  const arch = path.join(ROOT, "data", ".archive", `state-before-${TO}-${stamp}`);
  for (const [dir, name] of [["data", "stocks"], ["data/crypto", "crypto"]]) {
    const f = path.join(ROOT, dir, "trades-state.json");
    if (fs.existsSync(f)) { fs.mkdirSync(arch, { recursive: true }); fs.renameSync(f, path.join(arch, name + "-trades-state.json")); }
  }
  for (const a of [[], ["--out", "data/crypto"]]) {
    const r = spawnSync(process.execPath, ["scripts/build-trades.mjs", ...a], { cwd: ROOT, encoding: "utf8" });
    console.log("  " + ((r.stdout || "") + (r.stderr || "")).trim());
  }
  console.log(`\n✔ main على ${TO.toUpperCase()} (${c}). الحالة السابقة في ${path.relative(ROOT, arch) || "—"}.
  التالي:  git push origin main   ثم انتظر site.yml والنشر، ثم:  node scripts/check-live.mjs\n`);
  }
} catch (e) { console.error("✗ " + e.message); code = 1; }
finally { cleanup(); }
process.exit(code);
