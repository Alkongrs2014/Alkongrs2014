/* =====================================================================
   سجلّ التشغيل — «لماذا لم تظهر هذه الفرصة؟» سؤالٌ يُجاب في سطر.

   هذا ليس تجميلاً للمخرجات. المشروع مليءٌ بأعطالٍ **لا تبدو أعطالاً**:
   مهمّةٌ تنسحب أمام قفلٍ فتخرج بـ‎rc=0‎ ويسجّل المجدول «نجح»، وشمعاتٌ
   ممتدة تُحذف بصمت، وبوابةٌ حجمٍ تصمت لأن المزوّد لا يعطي حجماً.
   وفي كلٍّ منها كان الدليل الوحيد فجوةً في البيانات يكتشفها أحدٌ
   بالمصادفة بعد أيام.

   فالسطر يحمل **اللحظة بتوقيت الرياض** (وهو التوقيت الذي يقرأ به
   المستخدم)، والمرحلة، والرمز، والسبب. و`.run.skips.json` أثبت قيمة
   هذا النمط: صار «لماذا تقادمت العقود؟» يُجاب من ملفٍّ بدل تشخيصٍ
   كامل.

   والكتابة **بالإلحاق وبملفٍّ لكل يوم**: ملفٌّ واحد متضخّم لا يُقرأ،
   وقراءةُ يومٍ بعينه هي ما يُحتاج فعلاً عند التشخيص.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ksaTime, ksaParts, sessionOf } from "./session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/* مستوياتٌ أربعة. `sig` منفصلٌ عن `info` عمداً: ظهورُ إشارةٍ هو الحدث
   الذي يُبحث عنه في السجلّ، وخلطُه بسطور التقدّم يدفنه. */
const LEVELS = { dbg: 10, info: 20, sig: 25, warn: 30, err: 40 };
const MIN = LEVELS[process.env.LOG_LEVEL || "info"] || LEVELS.info;

/* الاحتفاظ: أربعة عشر يوماً. سجلُّ تشخيصٍ لا أرشيف — والأرشيف عندنا
   ملفّاته الخاصة (`replay/` و`audit/`). */
const KEEP_DAYS = 14;

let dir = null, stream = null, day = null;

function fileFor(now) {
  const p = ksaParts(now);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function initLog(outDir) {
  dir = path.join(outDir || path.join(ROOT, "data"), "logs");
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  prune();
}

function prune() {
  if (!dir) return;
  try {
    const cut = Date.now() - KEEP_DAYS * 86400e3;
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const t = Date.parse(f.slice(0, 10) + "T00:00:00Z");
      if (Number.isFinite(t) && t < cut) fs.unlinkSync(path.join(dir, f));
    }
  } catch {}
}

function write(line, now) {
  if (!dir) return;
  const d = fileFor(now);
  if (d !== day) { day = d; try { stream?.end(); } catch {} stream = null; }
  if (!stream) {
    try { stream = fs.createWriteStream(path.join(dir, `${d}.log`), { flags: "a" }); }
    catch { return; }
  }
  stream.write(line + "\n");
}

/* =====================================================================
   السطر: `11:14 KSA · PRE · scanner · MSFT · حجمٌ غير معتاد ‎3.2×‎`

   الجلسة في السطر لأنها **تفسّر** ما بعدها: نفس الرقم قبل الافتتاح
   وبعده حدثان مختلفان، وقارئُ السجلّ بعد أسبوع لا يتذكّر أيُّ ساعةٍ
   كانت أيَّ جلسة.
   ===================================================================== */
export function log(level, stage, msg, extra) {
  if ((LEVELS[level] || 0) < MIN) return;
  const now = Date.now();
  const sess = sessionOf(now);
  const sym = extra && extra.sym ? ` · ${extra.sym}` : "";
  const tail = extra && extra.data !== undefined ? ` · ${JSON.stringify(extra.data)}` : "";
  const line = `${ksaTime(now)} KSA · ${sess.padEnd(7)} · ${String(stage).padEnd(10)}${sym} · ${msg}${tail}`;
  write(line, now);
  /* الطباعة على الشاشة للتحذيرات والأخطاء وحدها: مهمّةُ الدقيقتين
     تكتب آلاف السطور ولا يقرؤها أحدٌ حيّاً، والملفّ يحتفظ بها كلِّها. */
  if (level === "warn") console.warn(`  ⚠ ${msg}`);
  else if (level === "err") console.error(`  ✗ ${msg}`);
}

export const dbg  = (stage, msg, extra) => log("dbg", stage, msg, extra);
export const info = (stage, msg, extra) => log("info", stage, msg, extra);
export const warn = (stage, msg, extra) => log("warn", stage, msg, extra);
export const err  = (stage, msg, extra) => log("err", stage, msg, extra);

/* ظهورُ إشارة — السطر الذي يُبحث عنه فعلاً */
export function signal(sym, strat, dir, sc, why) {
  log("sig", "signal", `${strat} ${dir > 0 ? "▲" : "▼"} ${sc}${why ? " · " + why : ""}`, { sym });
}
/* ولماذا **لم** تظهر — أنفعُ من ظهورها حين يسأل المستخدم عن فرصةٍ فاتت */
export function rejected(sym, strat, why) {
  log("dbg", "rejected", `${strat} · ${why}`, { sym });
}
