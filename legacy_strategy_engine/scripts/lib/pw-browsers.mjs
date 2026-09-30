/* =====================================================================
   مسار متصفّحات Playwright — داخل المشروع لا في AppData.

   تطبيقُ Claude المكتبيّ مُغلَّفٌ (MSIX)، فكتاباتُ عملياته تحت
   `%LOCALAPPDATA%` تُحوَّل إلى مخزنه الخاصّ: المتصفّح المركَّب من جلسةٍ فيه
   موجودٌ لها **وغائبٌ عن المجدول** — قِيس: `exists=false` من مهمّةٍ مجدولة
   والملفّ ظاهرٌ في الجلسة، فسقطت خطوتا Playwright في مهمّة الحصن الليلية،
   وكانت مراقبةُ الكريبتو تفشل بنفس الرسالة منذ أيام. `.pw-browsers/` في
   المشروع مرئيٌّ للجميع. يُضبط على ويندوز وحده وحين يوجد المجلّد — CI على
   لينكس يبقى على تركيبه هو.
   ركّبه: PLAYWRIGHT_BROWSERS_PATH=<المشروع>\.pw-browsers npx playwright install chromium
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PW_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.pw-browsers");
if (process.platform === "win32" && !process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(PW_DIR))
  process.env.PLAYWRIGHT_BROWSERS_PATH = PW_DIR;
