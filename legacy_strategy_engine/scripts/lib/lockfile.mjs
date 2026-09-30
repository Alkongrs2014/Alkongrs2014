/* =====================================================================
   القفل بنفس دلالات `local/run.mjs` — نسخةٌ قابلة للاستيراد.

   الفحوص الدورية (الطبيب، الصحّة، الإعادة) تحتاج أن تقرأ `data/` **بين**
   كتابتين لا في منتصف إحداهما. والكاتب الوحيد هو المجدول وهو يأخذ
   `data/.run.lock` (والكريبتو `data/crypto/.run.lock`)، فمن يأخذ نفس
   القفل لثانيةٍ واحدة ينسخ فيها يقرأ حالةً مكتملة بالضرورة.

   الدلالات نفسها حرفياً: `wx` ذرّية، والحاملُ الميت أو الأقدم من عشرين
   دقيقة يُسقط، والانتظار له سقف. نسختان بدلالتين مختلفتين تجعلان قارئاً
   يأخذ قفلاً يظنّه الكاتبُ ميتاً فيدخلان معاً.
   ===================================================================== */
import fs from "node:fs";

const STALE_MS = 20 * 60000;

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

export function lockHolder(file) {
  try {
    const prev = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - prev.at < STALE_MS && alive(prev.pid)) return prev;
  } catch (e) { /* لا قفل أو تالف */ }
  return null;
}

export function tryLock(file, job) {
  try {
    const fd = fs.openSync(file, "wx");
    fs.writeSync(fd, JSON.stringify({ job, pid: process.pid, at: Date.now() }));
    fs.closeSync(fd);
    return true;
  } catch (e) { return false; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* يعيد true عند الأخذ، وfalse عند استنفاد السقف — ولا يُسقط قفلاً حيّاً. */
export async function acquire(file, job, capMs = 240000, pollMs = 1000) {
  const t0 = Date.now();
  for (;;) {
    if (tryLock(file, job)) return true;
    if (!lockHolder(file)) { try { fs.unlinkSync(file); continue; } catch (e) { /* سباق */ } }
    if (Date.now() - t0 >= capMs) return false;
    await sleep(pollMs);
  }
}

/* يُحرَّر فقط إن كان القفل لنا — حرصاً ألّا نحذف قفل كاتبٍ أخذه بعدنا. */
export function release(file) {
  try {
    const cur = JSON.parse(fs.readFileSync(file, "utf8"));
    if (cur.pid === process.pid) fs.unlinkSync(file);
  } catch (e) { /* لا قفل */ }
}
