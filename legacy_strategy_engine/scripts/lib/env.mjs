/* =====================================================================
   تحميل `.env` — بلا أيّ تبعية، ومن أيّ مدخل.

   كان التحميل في `local/run.mjs` وحده، فأيُّ سكربتٍ يُشغَّل مباشرةً
   (`node scripts/fetch-market.mjs`) يعمل بلا مفاتيح. والأثر ليس خطأً
   بل **تدهوراً صامتاً**: طبقة المزوّد لا ترى مفتاح Alpaca فتسقط إلى
   ياهو وتطبع «لا حجم للجلسة الممتدة» — سطرٌ صحيح لسببٍ خاطئ، ويُقرأ
   «المزوّد لا يدعم» بينما الحقيقة «المفتاح لم يُقرأ».

   ولذلك يُستورَد من `providers/index.mjs` نفسه: المكان الذي تُقرأ فيه
   المفاتيح هو المكان الذي يضمن تحميلها، لا كلُّ مستدعٍ على حدة.

   ولا يدوس ما هو مضبوط أصلاً في البيئة: متغيّرُ بيئةٍ صريح (من
   المجدول أو من سطر الأوامر) أقوى من الملفّ.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let loaded = 0;
let done = false;

export function loadEnv() {
  if (done) return loaded;
  done = true;
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return 0;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;                                   // تعليقٌ أو سطرٌ فارغ
    const k = m[1];
    let v = m[2].trim();
    /* اقتباسٌ محيط يُزال: مفتاحٌ بين علامتين يدخل بعلامتيه فيُرفض من
       الخادم برسالةٍ لا تشير إلى السبب */
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!(k in process.env)) { process.env[k] = v; loaded++; }
  }
  return loaded;
}

loadEnv();
