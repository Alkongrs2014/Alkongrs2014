/* =====================================================================
   عامل الخدمة — فتحٌ فوري وعملٌ بلا اتصال.

   لماذا: الصفحة تسحب ~480 كيلوبايت في كل زيارة (الترجمات 324، الأخبار
   157)، فأول رسمٍ ينتظر الشبكة كلها. ومع انقطاعٍ في الجوّال لا يُعرض
   شيء — بينما آخر بيانات سليمة كانت في المتصفح قبل ثانية.

   ثلاث استراتيجيات لثلاث طبيعات، ولا واحدة تصلح للأخرى:
   • الهيكل (HTML والشيفرة) — **قديمٌ ثم يُجدَّد**: يُعرض فوراً من الذاكرة
     ويُحدَّث في الخلفية، فالزيارة التالية على الجديد. تخزينه مباشرةً
     يجمّد التطبيق على نسخةٍ قديمة إلى الأبد.
   • البيانات (JSON) — **الشبكة أولاً**: سعرٌ من الذاكرة سعرٌ كاذب. وعند
     السقوط وحده نعود إلى آخر نسخة، ويعرف المستخدم عمرها من ختم الوقت
     المعروض في الترويسة أصلاً.
   • الخطوط — **الذاكرة أولاً**: لا تتغيّر، وطلبها في كل زيارة تأخيرٌ
     خالص.

   ولا يخزّن إلا GET وطلبات النطاقات المعروفة: تخزين استجابةٍ من مصدرٍ
   غير متوقّع يجعل العامل وسيطاً لا يُراجَع.
   ===================================================================== */

/* =====================================================================
   نسخةُ الذاكرة — **تُرفع مع أيّ تغيّرٍ في ملفّات الهيكل، لا مع إضافة
   ملفٍّ جديد فحسب.**

   «قديمٌ ثم يُجدَّد» يحدّث كلَّ ملفٍّ **على حدة** في الخلفية، فبعد نشر
   تعديلٍ يمسّ ملفّين تمرّ الصفحة بحالةٍ مختلطة: `scans.js` جديد و
   `index.html` قديم. قِيس على الموقع المنشور فعلاً — احتاج **ثلاث**
   عمليات تحميل ليكتمل، وفي الثانية منها كان التطبيق يشغّل شيفرةً
   نصفُها قديم فيُعيد العلّة التي أُصلحت. والمستخدم يرى «لم يُصلَح شيء»
   وهو محقٌّ فيما يرى.

   ورفعُ `V` يجعل الانتقال **ذرّياً**: عاملٌ جديد يثبّت الهيكل كلَّه من
   الشبكة دفعةً واحدة ثم يحلّ محلَّ القديم، فالتحميل التالي يقرأ نسخةً
   متّسقة — لا ملفَّ جديدٍ بجانب ملفٍّ قديم.

   و`check-ui` يحرس هذا ببصمة الهيكل أدناه: أيُّ تغيّرٍ في أيّ ملفٍّ منه
   يُسقط الفحص حتى تُرفع النسخة وتُحدَّث البصمة. فالقاعدة تُنفَّذ ولا
   تُترك للتذكّر — وهي نفس مبدأ «حارسٌ يمرّ دون أن تُختبر حالتُه حارسٌ
   مفترَض لا محروس».
   ===================================================================== */
const V = "webtrade-v23";
const SHELL_SHA = "2d4a51721fe8";     // يحسبها `check-ui` من ملفّات CORE
const SHELL = V + "-shell";
const DATA = V + "-data";
const FONT = V + "-font";

// الهيكل: ما لا يعمل التطبيق بدونه
/* الهيكل: ما لا يعمل التطبيق بدونه.
   **يجب أن يطابق وسوم `<script src>` في `index.html` حرفاً بحرف**،
   ويفحص `check-ui` ذلك. نسيانُ ملفٍ جديد هنا لا يعطّل الشبكة (فـ
   `isShell` تخزّن أيّ ‎.js‎ عند أوّل طلب) لكنه يكسر العمل بلا شبكة
   بصمت: الهيكل مخزَّنٌ ناقصاً فتُعرض صفحةٌ بلا نصف شيفرتها.
   وكلُّ إضافةٍ إلى هذه القائمة تستلزم رفع `V`، وإلا بقيت الذاكرة
   القديمة تُقدَّم ("قديمٌ ثم يُجدَّد") فلا يظهر الملف الجديد أبداً
   في الزيارة الأولى — وقع هذا فعلاً وأوهم أن السكربت لا يُحمَّل. */
const CORE = ["./", "./index.html", "./config.js", "./score.js",
              "./session.js",
              "./indicators.js", "./scans.js", "./plan.js", "./direction.js", "./evaluate.js",
  "./strategies.js",
  "./consensus.js",
  "./confluence.js",
  // المنيفست والأيقونة جزءٌ من الهيكل: بدونهما لا يُعرض التطبيق مثبَّتاً
  // بلا شبكة، ويسقط شرطُ التثبيت نفسه عند أوّل زيارةٍ بشبكةٍ ضعيفة
  "./manifest.json", "./icon.svg"];

const isFont = (u) => u.host === "fonts.googleapis.com" || u.host === "fonts.gstatic.com";
const isData = (u) => /\.json($|\?)/.test(u.pathname);
const isShell = (u) => u.origin === self.location.origin && /\.(html|js|css)$|\/$/.test(u.pathname);

self.addEventListener("install", (e) => {
  // لا نُسقط التثبيت لو سقط ملفٌ واحد: العامل بلا بعض الهيكل خيرٌ من
  // لا عامل، وما نقص يأتي من الشبكة
  e.waitUntil(caches.open(SHELL)
    .then(c => Promise.allSettled(CORE.map(u => c.add(u))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // ذاكرات النسخ السابقة تُحذف: بقاؤها يملأ حصّة المتصفح بنسخٍ لا تُقرأ
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => !k.startsWith(V)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* قديمٌ ثم يُجدَّد */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await fresh) || new Response("", { status: 504 });
}

/* مفتاحُ خزنٍ بلا استعلام.

   التطبيق يُلحق `?t=…` بكل طلب بيانات ليتجاوز ذاكرة المتصفح، فكل سحبةٍ
   عنوانٌ جديد. بلا تطبيعٍ للمفتاح تصير النتيجة عكس المقصود تماماً:
   الذاكرة تتضخّم بنسخةٍ لكل دقيقتين، ولا تُطابق واحدةٌ منها أبداً عند
   انقطاع الشبكة — فالعنوان التالي مختلف دائماً. */
const keyOf = (req) => {
  const u = new URL(req.url);
  u.search = "";
  return new Request(u.toString(), { headers: req.headers });
};

// سقفُ ذاكرة البيانات: 510 ملف رمز × عشرات الكيلوبايتات تملأ حصّة
// المتصفح. الحذف بترتيب الإدخال — لا تتيح الواجهة زمن آخر قراءة.
const DATA_MAX = 140;
async function trim(cache, max) {
  const ks = await cache.keys();
  if (ks.length <= max) return;
  await Promise.all(ks.slice(0, ks.length - max).map(k => cache.delete(k)));
}

/* الشبكة أولاً، والذاكرة عند السقوط */
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const key = keyOf(req);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      await cache.put(key, res.clone());
      trim(cache, DATA_MAX);
    }
    return res;
  } catch (e) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw e;
  }
}

/* الذاكرة أولاً */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let u;
  try { u = new URL(req.url); } catch { return; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return;

  if (isFont(u)) return e.respondWith(cacheFirst(req, FONT));
  if (isData(u)) return e.respondWith(networkFirst(req, DATA));
  if (isShell(u)) return e.respondWith(staleWhileRevalidate(req, SHELL));
  // ما عدا ذلك يمرّ كما هو — لا نتوسّط ما لا نعرفه
});
