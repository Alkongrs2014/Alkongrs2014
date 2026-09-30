/* =====================================================================
   لقطةٌ ثابتة من `data/` — القراءة المتّسقة لكل فاحص.

   المجدول يكتب `data/` كل دقيقتين، وفاحصٌ يقرأ أربعين ملفاً في ثوانٍ قد
   يقرأ نصفَها قبل كتابةٍ ونصفَها بعدها — فيعطي FAIL لحالةٍ لم توجد قط أو
   PASS لحالةٍ مزيَّفة. والحلّ: نأخذ قفل الكاتب، ننسخ، ونحرّر. النسخ
   ~ثلث ثانية، فلا تكاد مهمّةٌ تنتظر.

   المستثنى: السجلّات والأرشيف والإعادة ولقطات المراقبة — ملفّاتٌ تُلحق
   ولا تُعاد كتابتها، أو لا يقرؤها فاحص. ومن احتاج لقطات المراقبة يقرؤها
   من مكانها: كلُّ ملفٍّ منها يُكتب مرّةً ولا يُلمس.
   ===================================================================== */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquire, release } from "./lockfile.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LIVE_DATA = path.join(ROOT, "data");

/* `bars` مخزنُ شموع SIP الخام (~40 م.ب): الفاحص يقرأ ما بُني منه في `sym/`،
   ونسخُه في كل لقطةٍ يُطيل القفل عشرات المرّات بلا قارئ. */
const SKIP = new Set(["logs", ".archive", "replay", ".monitor", "audit", "bars"]);
const SKIP_FILE = /^\.(run\.lock|publish\.lock)$|\.tmp(\.json)?$/;

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name) || SKIP_FILE.test(e.name)) continue;
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(a, b);
    else if (e.isFile()) fs.copyFileSync(a, b);
  }
}

/* يعيد مسار لقطةٍ في مجلّد مؤقّت، أو يرمي إن تعذّر أخذ القفل.
   `src` للاختبار: مجلّد بيانات بديل بنفس البنية. */
export async function takeSnapshot({ src = LIVE_DATA, dest, capMs = 180000, job = "snapshot" } = {}) {
  if (!fs.existsSync(src)) throw new Error("لا مجلّد بيانات: " + src);
  const out = dest || fs.mkdtempSync(path.join(os.tmpdir(), "webtrade-snap-"));
  /* قفلٌ واحد: `local/run.mjs` يأخذ `data/.run.lock` لكل مهمّة كاتبة —
     الكريبتو وغيرُه — فهو الذي يفصل بين الكتابات. */
  const locks = [path.join(src, ".run.lock")];
  const held = [];
  try {
    for (const f of locks) {
      if (!(await acquire(f, job, capMs))) throw new Error("تعذّر أخذ القفل خلال السقف: " + f);
      held.push(f);
    }
    copyTree(src, out);
  } finally {
    for (const f of held.reverse()) release(f);
  }
  return out;
}

export function dropSnapshot(dir) {
  if (dir && dir.startsWith(os.tmpdir())) fs.rmSync(dir, { recursive: true, force: true });
}

/* مجلّد البيانات لأيّ فاحص: متغيّر البيئة أوّلاً (اللقطة)، ثم الحيّ. */
export const DATA_DIR = process.env.WEBTRADE_DATA
  ? path.resolve(process.env.WEBTRADE_DATA) : LIVE_DATA;
