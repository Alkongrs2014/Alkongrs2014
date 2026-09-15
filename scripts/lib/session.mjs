/* =====================================================================
   حالة جلسة السوق للخادم — **غلافٌ رفيع فوق `stocks/session.js`**.

   كان هذا الملفّ يحمل المنطق، وكانت في `index.html` نسخةٌ ثانية منه.
   والنسختان تتباعدان بأول تعديل: أضفتُ العطلات وأنصاف الأيام هنا
   فيبقى المتصفّح يحسب بلا عطلة، فيقول الخادم «مغلق» والترويسة «ما قبل
   الافتتاح» في اللحظة نفسها. فصار المنطق في ملفٍّ مشترك واحد يقرؤه
   الاثنان — نفس علّة `plan.js` و`scans.js` ونفس حلّها.

   ---------------------------------------------------------------------
   **مفردتان لحالةٍ واحدة، وهذا مقصود.** الملفّ المشترك يسمّي ما بعد
   الإغلاق `AFTER`، والشيفرة القائمة (‎`dailyIsLive`‎، والواجهة،
   و`snap.sess`) تسمّيه `POST` منذ شهور. فالترجمة تقع **هنا وحدها**:
   كلُّ من يستورد من هذا الملفّ يرى `POST` كما كان، ومن يستورد
   `stocks/session.js` مباشرةً يرى `AFTER`. ولا موضع ثالث يترجم.
   ===================================================================== */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, "stocks/session.js"));

/* إعادة تصدير النواة كما هي — من يحتاج الجديد يأخذه من هنا أيضاً فلا
   يحتاج أحدٌ إلى `createRequire` مرّةً أخرى */
export const {
  sessionOf, sessionWindows, currentWindow, isExtendedOpen, scannerActive,
  isTradingDay, isHoliday, isHalfDay, etParts, tzParts, atEtMinutes,
  scanStartOf, nextScanStart, barSession, isExtendedBar, isRegularBar,
  minuteOfSession, ksaTime, ksaDate, ksaDateTime, ksaParts,
  SESSION_AR, SESSION_SHORT, SCAN_START_ET, SESSION_TZ, DISPLAY_TZ
} = S;

/* `AFTER` ⇄ `POST` — الترجمة الوحيدة في المشروع */
const legacy = (st) => (st === "AFTER" ? "POST" : st);

/* الحالة الكاملة بالمفردة القديمة. `statusAt` في الملفّ المشترك تحسب
   النوافذ من تقويم نيويورك، فلم تعد تحتاج `period` من ياهو إطلاقاً —
   وهو ما يُسقط مصيدة «الفترات المحفوظة تصف يوم جلبها» من جذرها. */
function statusOf(now, mkt) {
  const st = S.statusAt(now, mkt);
  return {
    state: legacy(st.state),
    ar: st.ar,
    next: st.next,
    nextAr: st.nextAr,
    ...(st.half ? { half: true } : {})
  };
}

/* =====================================================================
   الواجهة القديمة — تبقى بتوقيعها كي لا يتغيّر كلُّ مستدعٍ دفعةً واحدة.

   `period` لم تعد تُقرأ: كانت أدقَّ ما نملك حين كان البديل تقديراً
   بساعات ثابتة بلا عطلات، أمّا الآن فالحساب التقويميّ أدقُّ منها —
   لأنه يصف **اليوم المسؤول عنه** لا يوم جلبه. وتبقى في التوقيع
   لأن نداءاتها منتشرة، وحذفُها تعديلٌ في عشرين موضعاً بلا مقابل.
   ===================================================================== */
export function marketStatus(period, now) { return statusOf(now); }
export function approxMarketStatus(now)   { return statusOf(now); }
export function statusNow(period, now)    { return statusOf(now); }
export function statusFor(mkt, period, now) { return statusOf(now, mkt); }

export const CRYPTO_STATUS = { state: "OPEN24", ar: S.SESSION_AR.OPEN24, next: null, nextAr: "" };

/* هل هذه اللحظة داخل جلسةٍ ممتدة؟ — الشرط الذي يحلّ محلّ
   `state === "REGULAR"` في كل موضعٍ كان يوقف العمل قبل الافتتاح */
export function extendedOpen(now, mkt) { return S.isExtendedOpen(now, mkt); }
