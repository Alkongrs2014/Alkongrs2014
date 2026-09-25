#!/usr/bin/env node
/* =====================================================================
   فحصُ نقاء اللقطة — **البصمة المحسوبة لا تتغيّر بما لم يُغلق.**

   البوّابة في `build-opportunities` ترفض كتابة بصمةٍ متغيّرة داخل الشمعة،
   وهذا يحمي المنشور ويُخفي المصدر. هذا الفحص يسأل السؤال الجذري: هل
   **الحساب نفسه** يتأثّر بأيّ حقلٍ لحظي؟ يأخذ نسخةً من البيانات الحيّة،
   ثم نسخةً ثانية شُوِّه فيها كلُّ ما هو لحظيّ بطبيعته:

     • السعر والتغيّر والحجم الجاري والسعر الممتد في صفّ الملخّص
     • حقول LIVE في `strategies.json` (`ldir`/`lsc`/`lband`)
     • شمعةٌ جارية مُلحقة بكل فريم في ملفّات الرموز (ومنها يومُ اليوم)
     • ساعة الحائط: من دقيقة إلى أربع عشرة دقيقة بعد الإغلاق

   ويشترط **بصمةً متطابقة** في كل الحالات. ثم يُثبت أنه ليس فحصاً يمرّ
   دائماً: تغييرُ إغلاقٍ **مغلق** واحد يجب أن يغيّر البصمة.

   node scripts/check-snapshot-purity.mjs [dataDir]
   ===================================================================== */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.resolve(process.argv[2] || path.join(ROOT, "data"));
const FILES = ["summary.json", "strategies.json", "fundamentals.json", "strategy-edge.json", "signals.json"];

function copyData(dst) {
  fs.mkdirSync(path.join(dst, "sym"), { recursive: true });
  for (const f of FILES) if (fs.existsSync(path.join(SRC, f))) fs.copyFileSync(path.join(SRC, f), path.join(dst, f));
  for (const f of fs.readdirSync(path.join(SRC, "sym"))) fs.copyFileSync(path.join(SRC, "sym", f), path.join(dst, "sym", f));
  // حالة دورة الحياة السابقة جزءٌ من المدخلات — تُنسخ كما هي
  if (fs.existsSync(path.join(SRC, "opportunities.json")))
    fs.copyFileSync(path.join(SRC, "opportunities.json"), path.join(dst, "opportunities.json"));
}

function hashOf(dir, nowMs) {
  const code = `import(${JSON.stringify("file:///" + path.join(ROOT, "scripts", "build-opportunities.mjs").replace(/\\/g, "/"))})` +
    `.then(m => { const r = m.buildSnapshot(${nowMs}); console.log(JSON.stringify({ ok: r.ok, why: r.why, h: r.rowsHash, k: r.candleKey, n: r.count })); })`;
  const out = execFileSync(process.execPath, ["-e", code], { env: { ...process.env, OPP_OUT: dir }, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").pop());
}

const rdj = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const wrj = (p, j) => fs.writeFileSync(p, JSON.stringify(j));

let pass = 0, fail = 0;
const ok = (m, d) => { pass++; console.log(`  ✓ ${m}${d ? " — " + d : ""}`); };
const no = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? " — " + d : ""}`); };

console.log(`\n▶ نقاء لقطة الفرص — ${SRC}\n`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opp-purity-"));
const A = path.join(tmp, "a"), B = path.join(tmp, "b"), C = path.join(tmp, "c");
copyData(A); copyData(B); copyData(C);

const sumA = rdj(path.join(A, "summary.json"));
let cbar = 0; for (const r of sumA.rows) if (Number.isFinite(r.cbar)) cbar = Math.max(cbar, r.cbar);
const close = (cbar + 900) * 1000;                 // لحظةُ إغلاق شمعة المفتاح

const base = hashOf(A, close + 60e3);
if (!base.ok) { no("بناء اللقطة الأصلية", base.why); process.exit(1); }
ok("اللقطة الأصلية تُبنى", `شمعة ${new Date(base.k * 1000).toISOString().slice(0, 16)}Z · ${base.n} صفّاً · ${base.h}`);

/* ── التشويه اللحظي في B ── */
const sumB = rdj(path.join(B, "summary.json"));
let k = 0;
for (const r of sumB.rows) {
  k++;
  if (Number.isFinite(r.p)) r.p = r.p * (1 + (k % 2 ? 0.012 : -0.009));
  if (Number.isFinite(r.chg)) r.chg = r.chg + (k % 2 ? 1.7 : -2.3);
  if (Number.isFinite(r.vol)) r.vol = Math.round(r.vol * 1.4);
  r.ext = { k: "PRE", p: (r.p || 1) * 1.01, c: 1 };
  if (Array.isArray(r.spark)) r.spark = r.spark.map(x => x * 1.01);
}
wrj(path.join(B, "summary.json"), sumB);
const stB = rdj(path.join(B, "strategies.json"));
for (const r of stB.rows || []) { r.ldir = -(r.dir || 1); r.lsc = 99; r.lband = 3; }
wrj(path.join(B, "strategies.json"), stB);
let appended = 0;
for (const f of fs.readdirSync(path.join(B, "sym"))) {
  const p = path.join(B, "sym", f);
  const rec = rdj(p);
  for (const tf of ["15m", "1h", "4h", "1d"]) {
    const c = rec.tf && rec.tf[tf] && rec.tf[tf].c;
    if (!c || !c.length) continue;
    const last = c[c.length - 1];
    // شمعةٌ جارية: ختمُها بداية الشمعة التي تلي المفتاح (لم تُغلق عند الساعة)
    const t = tf === "1d" ? Math.floor(close / 86400000) * 86400 + 13.5 * 3600 : cbar + 900;
    if (t <= last[0]) continue;
    c.push([t, last[4], last[4] * 1.05, last[4] * 0.93, last[4] * 1.04, 9e9]);
    appended++;
  }
  wrj(p, rec);
}
for (const m of [1, 5, 9, 14]) {
  const h = hashOf(B, close + m * 60e3);
  h.ok && h.h === base.h
    ? ok(`تشويهٌ لحظيّ كامل + الساعة بعد الإغلاق بـ${m} د ⇒ البصمة نفسها`, `${appended} شمعةً جارية مُلحقة`)
    : no(`تشويهٌ لحظيّ + ${m} د ⇒ البصمة نفسها`, `${base.h} ≠ ${h.h} ${h.why || ""}`);
}

/* ── وليس فحصاً يمرّ دائماً: إغلاقٌ **مغلق** يتغيّر ⇒ البصمة تتغيّر ── */
const sumC = rdj(path.join(C, "summary.json"));
const top = sumC.rows.find(r => Number.isFinite(r.pc));
if (top) { top.pc = top.pc * 1.2; top.score = -(top.score || 0); }
wrj(path.join(C, "summary.json"), sumC);
const hc = hashOf(C, close + 60e3);
hc.h !== base.h
  ? ok("تغييرُ بيانٍ مغلق يغيّر البصمة — الفحص ليس أعمى", top ? top.s : "")
  : no("تغييرُ بيانٍ مغلق يغيّر البصمة", "البصمة لم تتغيّر — الفحص أعمى");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
process.exit(fail ? 1 : 0);
