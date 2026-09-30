/* =====================================================================
   عزلُ المزوّدين — `DISABLE_PROVIDERS=yahoo,stooq,finnhub,twelvedata,iex`.

   الغرض إثباتٌ لا ضبط: «Alpaca هو المصدر الأساسي» ادّعاءٌ لا يُصدَّق إلا
   حين يعمل النظام **وكلُّ مصدرٍ سواه مقطوع**. الحارس في طبقة الشبكة
   نفسها (موضع الطلب لا موضع الاختيار)، فلا يمرّ طلبٌ من مسارٍ منسيّ.
   ===================================================================== */
export function disabledProviders() {
  return new Set(String(process.env.DISABLE_PROVIDERS || "").toLowerCase().split(/[,\s]+/).filter(Boolean));
}
export function assertEnabled(name) {
  if (disabledProviders().has(String(name).toLowerCase()))
    throw new Error(`PROVIDER_DISABLED ${name}`);
}
