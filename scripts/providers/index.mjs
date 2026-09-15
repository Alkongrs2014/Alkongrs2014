/* =====================================================================
   سجلّ المزوّدين — الاختيار **بالقدرة لا بالاسم**.

   الشيفرة التي تسأل «هل أشغّل بوابة الحجم قبل الافتتاح؟» تسأل
   `caps.extendedVolume`، لا `src === "alpaca"`. الفرق ليس أسلوبياً:
   اسمُ المزوّد المتناثر في عشرين شرطاً يجعل استبدالَه إعادةَ كتابة،
   ويجعل إضافة مزوّدٍ ثالث تعديلاً في كل موضعٍ نُسي منه واحد — والنسيان
   هنا لا يظهر خطأً، يظهر بوابةً تصمت أو رقماً يُختلق.

   ---------------------------------------------------------------------
   والسقوط **مرتَّبٌ ومُعلَن**: `pick()` تعيد المزوّد ومعه قائمةُ ما
   تنازلنا عنه. فحين لا يوجد مفتاح Alpaca يعمل كلُّ شيء بياهو،
   و`caps.extendedVolume` تصير `false`، فتُعلن البوابات المعتمِدة على
   الحجم سببَ توقّفها بنصّه بدل أن تختفي بصمت.

   ولا يستورد هذا الملفّ — ولا أيٌّ من المزوّدين — شيئاً من
   `strategies.js` أو `scans.js` أو `plan.js`. الاتجاه واحد: المنطق
   يقرأ البيانات، والبيانات لا تعرف المنطق.
   ===================================================================== */
/* **قبل أيّ محوّل**: المحوّلات تقرأ `process.env` عند التحميل
   (`FEED`، و`available()`)، فتحميلُ `.env` بعدها يأتي متأخّراً. */
import "../lib/env.mjs";
import * as alpaca from "./alpaca.mjs";
import * as yahoo from "./yahoo.mjs";
import * as binance from "./binance.mjs";
import * as finnhub from "./finnhub.mjs";

const ALL = [alpaca, yahoo, binance, finnhub];

/* ترتيب الأفضلية لكل سوق. الكريبتو Binance حصراً (موثَّق: طلبٌ واحد
   لكل الأسعار، وبلا مصيدتَي ياهو). والأسهم: Alpaca حين يتوفّر مفتاحه
   لأنه وحده يعطي حجم الجلسة الممتدة، وإلا ياهو. */
const ORDER = {
  equity: ["alpaca", "yahoo", "finnhub"],
  crypto: ["binance"],
  index: ["yahoo"]
};

const byId = Object.fromEntries(ALL.map(p => [p.id, p]));

export function providers() { return ALL.map(p => ({ id: p.id, caps: p.caps, available: p.available() })); }

/* المزوّد المختار لسوقٍ ما، مع ما تنازلنا عنه ولماذا */
export function pick(market = "equity", need = []) {
  const order = ORDER[market] || ORDER.equity;
  const skipped = [];
  for (const pid of order) {
    const p = byId[pid];
    if (!p) continue;
    if (!p.available()) { skipped.push({ id: pid, why: "بلا مفتاح" }); continue; }
    const missing = need.filter(k => !p.caps[k]);
    if (missing.length) { skipped.push({ id: pid, why: `ينقصه: ${missing.join("، ")}` }); continue; }
    return { provider: p, caps: p.caps, skipped };
  }
  /* لا مزوّد يملك ما طُلب. نعيد الأفضل المتاح **بقدراته الحقيقية** بدل
     رمي استثناء: النقص يُعلَن ويُتعايش معه، والانهيار يُفقد كلَّ شيء
     لأجل ميزةٍ واحدة. */
  for (const pid of order) {
    const p = byId[pid];
    if (p?.available()) return { provider: p, caps: p.caps, skipped, degraded: need.filter(k => !p.caps[k]) };
  }
  throw new Error(`لا مزوّد متاح لسوق ${market}`);
}

export function get(pid) {
  const p = byId[pid];
  if (!p) throw new Error(`مزوّد غير معروف: ${pid}`);
  return p;
}

/* هل القدرة متاحة فعلاً الآن؟ الاستعلام الذي يحلّ محلّ اسم المزوّد */
export function has(cap, market = "equity") {
  try { return !!pick(market).caps[cap]; } catch { return false; }
}

/* سطرٌ واحد يصف الحالة — يُطبع في بداية كل تشغيل وفي `meta.json`.
   «لماذا لا تظهر بوابة الحجم؟» سؤالٌ يُجاب من سجلّ التشغيل بلا تشخيص. */
export function describe() {
  const out = [];
  for (const m of Object.keys(ORDER)) {
    try {
      const { provider, caps, degraded } = pick(m);
      out.push(`${m}: ${provider.id}` +
        (caps.extendedVolume ? " (حجم ممتد ✓)" : " (بلا حجم ممتد)") +
        (degraded?.length ? ` — ناقص: ${degraded.join("، ")}` : ""));
    } catch (e) { out.push(`${m}: — (${e.message})`); }
  }
  return out.join(" · ");
}

export { alpaca, yahoo, binance, finnhub };
