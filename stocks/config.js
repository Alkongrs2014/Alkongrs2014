/* =====================================================================
   إعدادات مرصد الأسهم — عدّل هذا الملف وحده، لا تلمس index.html
   ===================================================================== */
window.CFG = {

  /* من أين تُقرأ ملفات البيانات التي تكتبها مهمة GitHub Actions.
     الافتراضي: فرع data في مستودعك عبر raw.githubusercontent (يدعم CORS). */
  DATA_BASE: "https://raw.githubusercontent.com/Alkongrs2014/Alkongrs2014/data",

  /* اتركه فارغاً = الوضع المجاني (البيانات من الملفات، تأخير ~15 دقيقة).
     ضع هنا رابط Cloudflare Worker لتفعيل السعر اللحظي — انظر worker/README.md
     مثال: "https://stocks-live.YOURNAME.workers.dev"                        */
  LIVE_ENDPOINT: "",

  /* كل كم ثانية نسحب السعر اللحظي من الـ Worker (أثناء فتح السوق فقط). */
  LIVE_POLL_SECONDS: 10,

  /* كل كم ثانية نعيد قراءة ملفات البيانات في الوضع المجاني. */
  FILE_POLL_SECONDS: 120
};
