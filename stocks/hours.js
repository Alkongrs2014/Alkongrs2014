/* =====================================================================
   ساعات تداول الأدوات — مشتركةٌ بين المتصفح والخادم (طلب المالك 2026-10-05).

   كلُّ نافذةٍ معرَّفةٌ بتوقيت نيويورك كما تعلنها البورصة، وتُحسب لحظتُها
   بـ`atEtMinutes` من session.js — فيتبع التوقيت الصيفي والشتوي الأمريكي
   تلقائياً، والرياض (بلا توقيت صيفي) تُشتقّ عرضاً وحده. ولا يُكتب هنا
   رقمٌ بتوقيت الرياض: «03:00 الرياض» صيفاً تصير 04:00 شتاءً من تلقاء نفسها.

   النوافذ تُنسب إلى **يوم التداول** الذي تخدمه: الجلسة الليلية التي تبدأ
   مساء الأحد هي جلسة يوم الإثنين — فعطلةُ الإثنين تُلغيها، ومساءُ الجمعة
   بلا جلسة لأن السبت ليس يوم تداول.

   المصادر (مقيسة/مراجَعة 2026-10-05):
     · الأسهم والصناديق: ما قبل الافتتاح 04:00 · الرسمية 09:30–16:00 · ما بعد الإغلاق حتى 20:00 (SIP)
     · الليلي BOATS (Blue Ocean): 20:00 → 04:00 — Alpaca `feed=boats` (مقيس: صفقات 00:00–07:59 UTC)
     · خيارات SPX وXSP (Cboe): GTH 20:15 → 09:15 · RTH 09:30–16:15 · Curb 16:15–17:00
     · خيارات NDX (Nasdaq PHLX): 09:30–16:15 فقط — جلسة 07:30 مقترحةٌ لا مطبَّقة
     · خيارات SPY وQQQ: 09:30–16:15 (سمة options_late_close عند Alpaca)
     · عقود المؤشرات الآجلة (CME ES/NQ): 18:00 → 17:00 بتوقّفٍ يومي ساعة — للاطّلاع فقط،
       ولا مصدر لها في الاشتراك
   أنصاف الأيام: الإغلاق 13:00 والصناديق/المؤشرات 13:15، ولا Curb.
   ===================================================================== */
(function (root) {
  var SES = (typeof module !== "undefined" && module.exports) ? require("./session.js") : root;
  var DAY = 86400000;
  var H = function (h, m) { return h * 60 + (m || 0); };

  /* تعريف الجلسات لكل نوع أداة — [المفتاح، البداية، النهاية، اليوم السابق؟] بدقائق نيويورك.
     `prev` = تبدأ مساء اليوم السابق. `close` = تُستبدل بإغلاق اليوم (نصف يوم) + إزاحة. */
  var KINDS = {
    fut:    [["fut", H(18), H(17), 1]],
    boats:  [["night", H(20), H(4), 1]],
    stock:  [["pre", H(4), H(9, 30)], ["regular", H(9, 30), "close"], ["post", "close", "postEnd"]],
    spxopt: [["gth", H(20, 15), H(9, 15), 1], ["rth", H(9, 30), "close+15"], ["curb", "close+15", "close+60"]],
    ndxopt: [["rth", H(9, 30), "close+15"]],
    eqopt:  [["rth", H(9, 30), "close+15"]]
  };
  var LABEL = { fut: "العقود الآجلة (CME)", night: "التداول الليلي BOATS", pre: "ما قبل الافتتاح", regular: "الجلسة الرسمية",
    post: "ما بعد الإغلاق", gth: "الجلسة الليلية GTH", rth: "الجلسة الرسمية", curb: "جلسة Curb" };

  function closeOf(p) { return SES.isHalfDay(p) ? H(13) : H(16); }
  function postEndOf(p) { return SES.isHalfDay(p) ? H(17) : H(20); }
  function resolve(x, p) {
    if (typeof x === "number") return x;
    var c = closeOf(p);
    if (x === "close") return c;
    if (x === "postEnd") return postEndOf(p);
    if (x === "close+15") return c + 15;
    if (x === "close+60") return c + 60;
    return null;
  }
  /* منتصف نهار يوم نيويورك (لحظةٌ آمنة داخل اليوم مهما كان التوقيت الصيفي) */
  function noonOf(t) { return SES.atEtMinutes(t, H(12)); }

  /* نوافذ يوم تداولٍ واحد (`t` أيُّ لحظةٍ فيه) لنوع أداة — [] إن لم يكن يوم تداول */
  function dayWindows(kind, t) {
    var p = SES.etParts(t);
    if (!SES.isTradingDay(p)) return [];
    var noon = noonOf(t), prevNoon = noon - DAY, out = [];
    (KINDS[kind] || []).forEach(function (d) {
      if (d[0] === "curb" && SES.isHalfDay(p)) return;     // لا Curb في نصف اليوم
      var s = resolve(d[1], p), e = resolve(d[2], p);
      var start = SES.atEtMinutes(d[3] ? prevNoon : noon, s), end = SES.atEtMinutes(noon, e);
      out.push({ k: d[0], start: start, end: end, day: p.date });
    });
    return out;
  }
  /* كلُّ النوافذ حول `t`: من أمس إلى أسبوعٍ قادم (يكفي لعطلة نهاية أسبوعٍ طويلة) */
  function windowsAround(kind, t) {
    var noon = noonOf(t), out = [];
    for (var i = -1; i <= 7; i++) out = out.concat(dayWindows(kind, noon + i * DAY));
    return out.sort(function (a, b) { return a.start - b.start; });
  }
  /* الحالة الآن: النافذة المفتوحة (أو null) والقادمة */
  function stateAt(kind, t) {
    var w = windowsAround(kind, t), cur = null, next = null;
    for (var i = 0; i < w.length; i++) {
      if (t >= w[i].start && t < w[i].end) { cur = w[i]; continue; }
      if (w[i].start > t && !next) next = w[i];
    }
    return { open: !!cur, cur: cur, next: next };
  }
  /* جدول اليوم للعرض: لكل أداة نوافذُ يوم التداول الجاري (أو القادم إن انتهى) */
  function scheduleOf(kind, t) {
    var w = windowsAround(kind, t), days = {};
    w.forEach(function (x) { (days[x.day] = days[x.day] || []).push(x); });
    var keys = Object.keys(days).sort();
    for (var i = 0; i < keys.length; i++) {
      var ws = days[keys[i]];
      if (ws[ws.length - 1].end > t) return ws;
    }
    return [];
  }

  /* الأدوات الخمس الأساسية (طلب المالك) وما تحتاجه كلٌّ منها */
  var CORE5 = [
    { s: "SPX", ar: "مؤشر S&P 500", type: "index", opt: "spxopt", roots: ["SPXW", "SPX"], note: "مؤشرٌ نقدي — تسوية نقدية وعقود أوروبية" },
    { s: "SPY", ar: "صندوق SPY", type: "etf", opt: "eqopt", roots: ["SPY"], note: "صندوقٌ متداول يتبع S&P 500 — ليس سعر المؤشر" },
    { s: "QQQ", ar: "صندوق QQQ", type: "etf", opt: "eqopt", roots: ["QQQ"], note: "صندوقٌ متداول يتبع Nasdaq-100 — ليس سعر NDX" },
    { s: "XSP", ar: "مؤشر Mini-SPX", type: "index", opt: "spxopt", roots: ["XSP"], note: "عُشر SPX بعقودٍ وأسعارٍ مستقلّة" },
    { s: "NDX", ar: "مؤشر Nasdaq-100", type: "index", opt: "ndxopt", roots: ["NDXP", "NDX"], note: "مؤشرٌ مستقلّ عن QQQ — لا تداول له عبر Alpaca" }
  ];

  var api = { KINDS: KINDS, LABEL: LABEL, CORE5: CORE5, dayWindows: dayWindows, windowsAround: windowsAround,
    stateAt: stateAt, scheduleOf: scheduleOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HRS = api;
})(typeof window !== "undefined" ? window : this);
