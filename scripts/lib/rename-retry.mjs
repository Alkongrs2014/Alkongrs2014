/* =====================================================================
   إعادةُ تسميةٍ ذرّية تصمد أمام قفل ويندوز العابر.

   على ويندوز تفشل `rename` فوق ملفٍّ مفتوحٍ للقراءة في تلك اللحظة بـ EPERM/EBUSY/EACCES.
   ومهمّة النشر تنسخ `data/crypto` (لقطتُها تحت قفل الأسهم وحده) في نفس الثانية التي تكتب
   فيها دورة الكريبتو ملفّاتها — فسقطت الدورة كلُّها بخطأٍ عابر (`errors.jsonl`: 2026-10-03
   18:51 · 2026-10-04 07:21 · 2026-10-04 12:51). وفي V4.2 تقع دورة الحدّ (:15/:45) على نفس
   الدقيقة الفردية لمهمّة النشر، فصار العابرُ يُسقط لقطةً بعينها. يكفي انتظارٌ قصير: القارئ
   ينسخ الملفّ في أجزاءٍ من الثانية. والخطأ غير العابر يُرمى كما كان.
   ===================================================================== */
import fs from "node:fs";

const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function renameRetry(from, to, { tries = 10, baseMs = 50, rename = fs.renameSync, sleep = sleepSync } = {}) {
  for (let i = 0; ; i++) {
    try { return rename(from, to); }
    catch (e) {
      if (!TRANSIENT.has(e && e.code) || i >= tries - 1) throw e;
      sleep(baseMs * (i + 1));                                    // 50 · 100 · … حتى ~2.25ث إجمالاً
    }
  }
}
