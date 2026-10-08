#!/usr/bin/env node
/* =====================================================================
   تصفير الفرص والصفقات والتوصيات القديمة — أمر المالك 2026-10-08 بعد إطلاق
   استراتيجية SMA. مرّةً واحدة، تحت قفلَي الكاتب (الأسهم والكريبتو) فلا تتداخل
   مع دورة مجدولة، وبنسخةٍ احتياطية كاملة قبل أيّ تعديل في data/.archive/
   (لا تُنشر).

   يُصفَّر: صفقات V3 للأسهم والكريبتو والمؤشرات (المنشور والحالة — الجديدة
   والقائمة والمنتهية)، وسجلُّ تتبّع العقود، وسجلُّ إشارات المحرّك الأول
   وإحصاءاته (السجل · التاريخ · الأرشيف · القراءة). اللقطة نفسها تبقى بساعتها
   ونسختها كي يواصل المجدول من حيث هو؛ والدورة التالية تبني من حالةٍ فارغة.
   لا يُمسّ: الأسعار والشموع والملخّص والإعدادات و«صفقاتي» (في المتصفّح).

     node scripts/reset-trades.mjs [--data=DIR] [--dry]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { acquire, release } from "./lib/lockfile.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const DATA = path.resolve(arg("data", path.join(ROOT, "data")));
const DRY = process.argv.includes("--dry");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const BACKUP = path.join(DATA, ".archive", `reset-${STAMP}`);

const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch { return null; } };
const wr = (f, doc) => {
  if (DRY) { console.log("  (جاف) " + f); return; }
  const p = path.join(DATA, f), t = p + ".reset.tmp";
  fs.writeFileSync(t, JSON.stringify(doc));
  fs.renameSync(t, p);
  console.log("  ✓ " + f);
};
/* الأعداد صفرٌ والمصفوفات فارغة مع بقاء المفاتيح — الواجهة تقرأ البنية نفسها */
const zero = (v) => Array.isArray(v) ? [] : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, zero(x)]))
  : typeof v === "number" ? 0 : v;
const hash = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 12);

const FILES = ["trades.json", "trades-state.json", "crypto/trades.json", "crypto/trades-state.json", "idx-trades.json",
  "idx-trades-state.json", "contracts-track.json", "signals.json", "history.json", "archive.json", "learn.json"];

const L1 = path.join(DATA, ".run.lock"), L2 = path.join(DATA, "crypto", ".run.lock");
if (!(await acquire(L1, "reset", 600000))) { console.error("✗ قفل الأسهم مشغول"); process.exit(1); }
if (!(await acquire(L2, "reset", 600000))) { release(L1); console.error("✗ قفل الكريبتو مشغول"); process.exit(1); }
try {
  // ١) النسخة الاحتياطية
  if (!DRY) for (const f of FILES) {
    const src = path.join(DATA, f);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(path.join(BACKUP, f)), { recursive: true });
    fs.copyFileSync(src, path.join(BACKUP, f));
  }
  console.log(`▶ نسخة احتياطية: ${DRY ? "(جاف)" : BACKUP}`);

  // ٢) صفقات V3 — الأسهم والكريبتو والمؤشرات: بلا جديدة ولا قائمة ولا منتهية
  for (const [doc, st] of [["trades.json", "trades-state.json"], ["crypto/trades.json", "crypto/trades-state.json"], ["idx-trades.json", "idx-trades-state.json"]]) {
    const s = rd(st), d = rd(doc);
    if (s) wr(st, { ...s, active: [], closed: [] });
    if (d) {
      const o = { ...d, count: 0, open: [], active: [], closed: [], reset: Date.now() };
      o.rowsHash = hash({ open: [], active: [], bySym: o.bySym || {} });
      wr(doc, o);
    }
  }
  // ٣) سجلُّ تتبّع العقود (اللقطة الحالية contracts.json تُبنى من الصفر كلَّ دورة)
  const ct = rd("contracts-track.json");
  if (ct) wr("contracts-track.json", { ...ct, rows: [], updated: Date.now() });
  // ٤) سجلُّ إشارات المحرّك الأول وإحصاءاته
  for (const f of ["signals.json", "history.json"]) { const j = rd(f); if (j) wr(f, { ...j, count: 0, records: [], updated: Date.now() }); }
  const ar = rd("archive.json");
  if (ar) wr("archive.json", { ...zero(ar), holdDays: ar.holdDays, updated: Date.now() });
  const ln = rd("learn.json");
  if (ln) wr("learn.json", { ...zero(ln), minSample: ln.minSample, authority: ln.authority, appliesChanges: ln.appliesChanges, note: ln.note, updated: Date.now() });
  console.log("✓ صُفّرت الفرص والصفقات والسجلات — الدورة التالية تبدأ سجلّاً جديداً");
} finally {
  release(L2); release(L1);
}
