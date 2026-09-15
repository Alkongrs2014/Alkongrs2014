/* =====================================================================
   الزمن والجلسة — نسخةٌ واحدة يقرأها المتصفح والخادم معاً.

   لماذا ملفٌّ مستقل: كانت حالةُ الجلسة محسوبةً في ثلاثة مواضع —
   `scripts/lib/session.mjs` للخادم، ودالّةٌ مكرّرة في `index.html`
   للمتصفح، وشرطُ `sess === "REGULAR"` داخل `strategies.js`. وثلاث نسخٍ
   من تعريفٍ زمنيّ تعني أن الماسح قد يرى «ما قبل الافتتاح» والترويسة
   ترى «مغلق» في اللحظة نفسها، بلا أيّ خطأ يقول ذلك.

   ---------------------------------------------------------------------
   **المرساة: ‎04:00‎ بتوقيت نيويورك، لا ‎11:00‎ بتوقيت الرياض.**

   الطلب كان «يبدأ النظام ‎11:00‎ صباحاً بتوقيت السعودية»، وهو يساوي
   ‎04:00‎ نيويورك — بدءَ جلسة ما قبل الافتتاح — **في التوقيت الصيفي
   وحده**. وأمريكا تنتقل إلى التوقيت الشتوي في أوّل أحدٍ من نوفمبر
   فيصير ‎11:00‎ الرياض = ‎03:00‎ نيويورك: ساعةٌ كاملة قبل أن توجد
   شمعةٌ واحدة، يدور فيها الماسح على لا شيء ثم يُظنّ أنه معطّل.
   والسعودية لا تطبّق التوقيت الصيفي أصلاً، فالفارق يتحرّك من جهةٍ
   واحدة.

   فالمرساة هي **الحدث** (بدء ما قبل الافتتاح) لا **رقم الساعة**،
   وتُحسب بـ`Intl` بتوقيت `America/New_York` فتتبع الانتقال تلقائياً
   بلا جدولٍ يدويّ. والعرض كلُّه `Asia/Riyadh` كما طُلب: ‎11:00‎ صيفاً
   و‎12:00‎ شتاءً — نفس اللحظة بوجهين.

   ---------------------------------------------------------------------
   والجلسة تُشتقّ من الزمن ولا تُخزَّن في الشمعة. لأن:
     · البيانات التاريخية (الأرشيف وReplay) بلا حقلٍ كهذا، واشتقاقُه
       يعمل عليها وعلى الحيّة بنفس الدالّة.
     · الشمعة المضغوطة ‎[t,o,h,l,c,v]‎ لا تحتاج حقلاً سابعاً ولا هجرة.
     · ويحلّ مصيدةً موثّقة: «الفترات المحفوظة تصف يوم جلبها» — فحسابُ
       النوافذ من تقويم نيويورك لا من `rec.period` يصحّ في أيّ يوم.
   ===================================================================== */

var SESSION_TZ = "America/New_York";
var DISPLAY_TZ = "Asia/Riyadh";

/* دقائق الجلسات بتوقيت نيويورك. ‎04:00–09:30‎ ما قبل الافتتاح،
   ‎09:30–16:00‎ الرسمية، ‎16:00–20:00‎ ما بعد الإغلاق — وهي نوافذ
   البورصات الأمريكية المعلنة لا اصطلاحٌ عندنا. */
var PRE_OPEN   = 4 * 60;          /* 04:00 */
var REG_OPEN   = 9 * 60 + 30;     /* 09:30 */
var REG_CLOSE  = 16 * 60;         /* 16:00 */
var POST_CLOSE = 20 * 60;         /* 20:00 */

/* نصفُ اليوم يُغلق ‎13:00‎ وتنتهي جلسته الممتدة ‎17:00‎ */
var HALF_CLOSE = 13 * 60;
var HALF_POST  = 17 * 60;

/* **المرساة الوحيدة في المشروع.** من يحتاج «متى يبدأ الماسح؟» يقرأ
   هذه ولا يكتب رقماً. */
var SCAN_START_ET = PRE_OPEN;

/* =====================================================================
   عطلات بورصة نيويورك. جدولٌ صريح لا اشتقاق: قواعدها ليست منتظمة
   (الجمعة العظيمة تتبع تقويماً قمرياً، وما يقع في السبت يُعطَّل الجمعة
   وما يقع في الأحد يُعطَّل الاثنين). وغيابُ الجدول لا يظهر خطأً — يظهر
   ماسحاً يدور على سوقٍ مغلق ويكتب «لا فرص اليوم».

   ⚠ يُمدَّد سنوياً. `check-session` يسقط حين تقترب آخرُ سنةٍ مغطّاة
   فلا يتقادم الجدول بصمت.
   ===================================================================== */
var HOLIDAYS = {
  2025: ["01-01","01-09","01-20","02-17","04-18","05-26","06-19","07-04","09-01","11-27","12-25"],
  2026: ["01-01","01-19","02-16","04-03","05-25","06-19","07-03","09-07","11-26","12-25"],
  2027: ["01-01","01-18","02-15","03-26","05-31","06-18","07-05","09-06","11-25","12-24"],
  2028: ["01-17","02-21","04-14","05-29","06-19","07-04","09-04","11-23","12-25"]
};
/* أنصافُ الأيام: إغلاقٌ ‎13:00‎. عشيّةُ الاستقلال وما بعد الشكر وعشيّة
   الميلاد. وهي ليست تفصيلاً: ماسحٌ يحسب «بعد الإغلاق» من ‎16:00‎ في
   يومٍ أُغلق ‎13:00‎ يقرأ ثلاث ساعاتٍ من الجلسة الممتدة على أنها
   الجلسة الرسمية. */
var HALF_DAYS = {
  2025: ["07-03","11-28","12-24"],
  2026: ["11-27","12-24"],
  2027: ["11-26"],
  2028: ["07-03","11-24","12-26"]
};

var _fmtCache = {};
function fmtFor(tz) {
  if (!_fmtCache[tz]) {
    _fmtCache[tz] = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  }
  return _fmtCache[tz];
}

/* أجزاءُ لحظةٍ بمنطقةٍ زمنية. كلُّ ما بعدها يُبنى عليها، فلا يتسرّب
   حسابُ منطقةٍ زمنية إلى موضعٍ آخر. */
function tzParts(t, tz) {
  var p = fmtFor(tz).formatToParts(new Date(t));
  var g = function (k) {
    var f = p.find(function (x) { return x.type === k; });
    return f ? f.value : "";
  };
  var hh = Number(g("hour"));
  /* `hour12:false` يعطي ‎24‎ عند منتصف الليل في بعض المحرّكات لا ‎0‎ —
     فرقٌ يجعل منتصف الليل يُقرأ «بعد نهاية اليوم» فيسقط من كل نافذة. */
  if (hh === 24) hh = 0;
  return {
    y: Number(g("year")), mo: Number(g("month")), d: Number(g("day")),
    wd: g("weekday"), h: hh, mi: Number(g("minute")), s: Number(g("second")),
    mins: hh * 60 + Number(g("minute")),
    date: g("year") + "-" + g("month") + "-" + g("day"),
    md: g("month") + "-" + g("day")
  };
}
function etParts(t) { return tzParts(t, SESSION_TZ); }

function isWeekend(p) { return p.wd === "Sat" || p.wd === "Sun"; }
function isHoliday(p) {
  var list = HOLIDAYS[p.y];
  return !!(list && list.indexOf(p.md) >= 0);
}
function isHalfDay(p) {
  var list = HALF_DAYS[p.y];
  return !!(list && list.indexOf(p.md) >= 0);
}
/* «يوم تداول» = ليس عطلة نهاية أسبوع ولا عطلة رسمية. وسنةٌ خارج الجدول
   تُعامَل يومَ تداولٍ عادي: فقدانُ عطلةٍ يجعلنا نمسح سوقاً مغلقاً
   (مزعج)، وافتراضُ عطلةٍ يجعلنا نصمت في يومٍ مفتوح (أسوأ). */
function isTradingDay(t) {
  var p = (t && typeof t === "object" && t.mins !== undefined) ? t : etParts(t);
  return !isWeekend(p) && !isHoliday(p);
}

/* نهايةُ الجلسة الرسمية لهذا اليوم بالدقائق — نصفُ اليوم أو كامله */
function closeMins(p) { return isHalfDay(p) ? HALF_CLOSE : REG_CLOSE; }
function postEndMins(p) { return isHalfDay(p) ? HALF_POST : POST_CLOSE; }

/* =====================================================================
   حالةُ الجلسة.

   القيم الأربع مقصودة: `PRE` و`REGULAR` و`AFTER` و`CLOSED`. و`AFTER`
   لا `POST` لأن `POST` مستعملةٌ في الشيفرة القديمة بمعنىً مطابق —
   ترجمةٌ واحدة في `lib/session.mjs` تُبقي المستهلكين القدامى يعملون.

   والكريبتو `OPEN24`: تمريرُه على منطق نيويورك يجعله «مغلقاً» ليل
   السبت وهو يتداول — مصيدةٌ موثّقة.
   ===================================================================== */
function sessionOf(t, mkt) {
  if (mkt === "crypto") return "OPEN24";
  var p = etParts(t);
  if (!isTradingDay(p)) return "CLOSED";
  var m = p.mins;
  if (m < PRE_OPEN) return "CLOSED";
  if (m < REG_OPEN) return "PRE";
  if (m < closeMins(p)) return "REGULAR";
  if (m < postEndMins(p)) return "AFTER";
  return "CLOSED";
}

/* هل هذه اللحظة داخل الجلسة الممتدة بأيّ معنى (ما قبل + الرسمية + ما
   بعد)؟ هذا هو شرطُ عمل الماسح — لا `REGULAR` وحدها. */
function isExtendedOpen(t, mkt) {
  var s = sessionOf(t, mkt);
  return s === "PRE" || s === "REGULAR" || s === "AFTER" || s === "OPEN24";
}
/* وهل يعمل الماسح الآن؟ سؤالٌ واحد له اسمٌ واحد */
function scannerActive(t, mkt) { return isExtendedOpen(t, mkt); }

/* =====================================================================
   نوافذُ جلسات اليوم الذي تقع فيه `t` — محسوبةً من تقويم نيويورك.

   البديل كان `rec.period` المحفوظ من ياهو، وهو **يصف يوم جلبه**:
   استعمالُه في اليوم التالي يعطي نطاق افتتاحٍ من الأمس تحت عنوان
   اليوم. وهذه تُحسب لأيّ لحظةٍ في الماضي أو الحاضر بنفس الدقّة —
   وهو ما يحتاجه Replay بالضبط.
   ===================================================================== */
function atEtMinutes(t, mins) {
  /* نبني اللحظة بالتقريب المتكرّر على الإزاحة: لا نعرف إزاحة نيويورك
     عن UTC في تاريخٍ بعينه بلا `Intl`، وطرحُ ثابتٍ يكسر يومَي الانتقال
     — وهما اليومان اللذان يُفترض أن يحلّهما هذا الملفّ. */
  var p = etParts(t);
  var guess = Date.UTC(p.y, p.mo - 1, p.d, 0, 0, 0) + mins * 60000;
  for (var i = 0; i < 4; i++) {
    var q = etParts(guess);
    var dayShift = (q.date === p.date) ? 0 : (q.date < p.date ? -1440 : 1440);
    var diff = (q.mins - mins) + dayShift;
    if (diff === 0) return guess;
    guess -= diff * 60000;
  }
  return guess;
}

function sessionWindows(t, mkt) {
  if (mkt === "crypto") {
    var d = new Date(t);
    var day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return { crypto: true, pre: null, regular: { start: day0, end: day0 + 86400000 }, post: null };
  }
  var p = etParts(t);
  if (!isTradingDay(p)) return { pre: null, regular: null, post: null, closed: true, half: false };
  var close = closeMins(p), postEnd = postEndMins(p);
  return {
    half: isHalfDay(p),
    pre:     { start: atEtMinutes(t, PRE_OPEN), end: atEtMinutes(t, REG_OPEN) },
    regular: { start: atEtMinutes(t, REG_OPEN), end: atEtMinutes(t, close) },
    post:    { start: atEtMinutes(t, close),    end: atEtMinutes(t, postEnd) }
  };
}

/* نافذةُ الجلسة الجارية — يحتاجها نطاقُ الافتتاح وVWAP لأيّ جلسة لا
   للرسمية وحدها. تعيد `null` خارج ساعات التداول. */
function currentWindow(t, mkt) {
  var s = sessionOf(t, mkt);
  var w = sessionWindows(t, mkt);
  if (s === "OPEN24") return w.regular;
  if (s === "PRE") return w.pre;
  if (s === "REGULAR") return w.regular;
  if (s === "AFTER") return w.post;
  return null;
}

/* مرساةُ بدء الماسح لليوم الذي تقع فيه `t` (‎04:00 ET‎) */
function scanStartOf(t) { return atEtMinutes(t, SCAN_START_ET); }

/* أقربُ ‎04:00 ET‎ قادمة في يوم تداول. تمسح عشرة أيام: أطولُ إغلاقٍ
   متّصل في التقويم الأمريكي أربعةُ أيام، والعشرة هامشٌ يحتمل جدولاً
   ناقصاً بلا حلقةٍ لا تنتهي. */
function nextScanStart(t) {
  for (var i = 0; i < 10; i++) {
    var day = t + i * 86400000;
    if (!isTradingDay(day)) continue;
    var start = scanStartOf(day);
    if (start > t) return start;
  }
  return null;
}

/* =====================================================================
   العرض — بتوقيت الرياض دائماً.

   كانت الواجهة تستعمل `toLocaleTimeString` بلا `timeZone` فتتبع منطقة
   المتصفّح. وهي تصادف الرياض على جهاز المستخدم، وتكذب على أيّ جهازٍ
   آخر — ومستخدمٌ مسافر يرى «ظهرت ‎08:42‎» لإشارةٍ ظهرت ‎11:42‎ بلا أن
   يعرف أنه يقرأ منطقةً أخرى.
   ===================================================================== */
var _ksaCache = {};
function ksaFmt(opt) {
  var key = JSON.stringify(opt);
  if (!_ksaCache[key]) {
    _ksaCache[key] = new Intl.DateTimeFormat("ar-SA-u-nu-latn",
      Object.assign({ timeZone: DISPLAY_TZ }, opt));
  }
  return _ksaCache[key];
}
function ksaTime(t)     { return ksaFmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t)); }
function ksaDateTime(t) { return ksaFmt({ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t)); }
function ksaDate(t)     { return ksaFmt({ year: "numeric", month: "long", day: "numeric" }).format(new Date(t)); }
function ksaParts(t)    { return tzParts(t, DISPLAY_TZ); }

/* أسماء الجلسات — مكانٌ واحد لها فلا تُترجَم في كل بطاقة على حدة */
var SESSION_AR = {
  PRE: "ما قبل الافتتاح", REGULAR: "السوق مفتوح",
  AFTER: "بعد الإغلاق", CLOSED: "السوق مغلق", OPEN24: "مفتوح ٢٤/٧"
};
var SESSION_SHORT = { PRE: "قبل", REGULAR: "جلسة", AFTER: "بعد", CLOSED: "مغلق", OPEN24: "٢٤/٧" };

/* الحالةُ الكاملة كما تعرضها الترويسة: الوسم والعدّاد إلى الحدث التالي */
function statusAt(t, mkt) {
  var st = sessionOf(t, mkt);
  if (st === "OPEN24") return { state: st, ar: SESSION_AR[st], next: null, nextAr: "", half: false };
  var w = sessionWindows(t, mkt);
  var next = null, nextAr = "";
  if (st === "PRE")          { next = w.pre.end;     nextAr = "يفتتح بعد"; }
  else if (st === "REGULAR") { next = w.regular.end; nextAr = "يغلق بعد"; }
  else if (st === "AFTER")   { next = w.post.end;    nextAr = "تنتهي الجلسة بعد"; }
  else {
    /* مغلق: الحدث التالي هو بدءُ ما قبل الافتتاح في أقرب يوم تداول —
       وهو نفسه لحظةُ بدء الماسح، فالعدّاد يقول متى يستيقظ النظام. */
    next = nextScanStart(t); nextAr = "تبدأ الجلسة بعد";
  }
  return { state: st, ar: SESSION_AR[st], next: next, nextAr: nextAr, half: !!w.half };
}

/* =====================================================================
   وسمُ شمعةٍ بجلستها. يُستعمل في الترشيح والعرض والقاعدة — ولا يُخزَّن.
   ===================================================================== */
function barSession(t, mkt) { return sessionOf(t, mkt); }
function isExtendedBar(t, mkt) {
  var s = sessionOf(t, mkt);
  return s === "PRE" || s === "AFTER";
}
function isRegularBar(t, mkt) {
  var s = sessionOf(t, mkt);
  return s === "REGULAR" || s === "OPEN24";
}

/* دقيقةُ الشمعة داخل جلستها — مفتاحُ خطّ أساس الحجم: حجمُ ‎06:10‎
   يُقارَن بحجم ‎06:10‎ في الأيام السابقة لا بمتوسّط اليوم كلّه. فأولُ
   ساعةٍ من ما قبل الافتتاح أهدأ بمراتب من آخرها، ومقارنتُها بالمتوسّط
   تقول «حجمٌ ضعيف» كل صباح ثم «غير معتاد» كل ‎09:00‎ — تذبذبٌ مصدرُه
   المقياس لا السوق. */
function minuteOfSession(t, mkt) {
  var w = currentWindow(t, mkt);
  if (!w) return null;
  return Math.floor((t - w.start) / 60000);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SESSION_TZ: SESSION_TZ, DISPLAY_TZ: DISPLAY_TZ,
    PRE_OPEN: PRE_OPEN, REG_OPEN: REG_OPEN, REG_CLOSE: REG_CLOSE, POST_CLOSE: POST_CLOSE,
    HALF_CLOSE: HALF_CLOSE, HALF_POST: HALF_POST,
    SCAN_START_ET: SCAN_START_ET, HOLIDAYS: HOLIDAYS, HALF_DAYS: HALF_DAYS,
    SESSION_AR: SESSION_AR, SESSION_SHORT: SESSION_SHORT,
    etParts: etParts, tzParts: tzParts, isTradingDay: isTradingDay,
    isHoliday: isHoliday, isHalfDay: isHalfDay,
    sessionOf: sessionOf, isExtendedOpen: isExtendedOpen, scannerActive: scannerActive,
    sessionWindows: sessionWindows, currentWindow: currentWindow,
    scanStartOf: scanStartOf, nextScanStart: nextScanStart, atEtMinutes: atEtMinutes,
    statusAt: statusAt, barSession: barSession,
    isExtendedBar: isExtendedBar, isRegularBar: isRegularBar,
    minuteOfSession: minuteOfSession,
    ksaTime: ksaTime, ksaDate: ksaDate, ksaDateTime: ksaDateTime, ksaParts: ksaParts
  };
}
