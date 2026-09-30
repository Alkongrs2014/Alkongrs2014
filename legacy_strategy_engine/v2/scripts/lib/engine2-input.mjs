/* =====================================================================
   باني مدخلات المحرّك V2 — **مسارٌ واحد** للحيّ وللإعادة التاريخية.

   الحيّ (`build-trades.mjs`) والإعادة (`validate-engine2.mjs`) يقرآن نفس
   مخزن Alpaca SIP ويمرّان بنفس `prep` ثم `inputAt(T)`، فلا تختلف شموع
   القرار بين ما يُعرض وما يُقاس. كلُّ ما يدخل مغلقٌ عند T:
     · 15د: الرسمية بحجمٍ موجب، ‎t + 15m ≤ T‎
     · ساعة/4س: دلاءٌ بمرسى 09:30 نهايتُها ≤ T (نصفُ الدلو الأخير يُغلق بالجلسة)
     · يومي: جلساتٌ تاريخها أقدم من جلسة T
   أدوات التقويم من session.js — حسابٌ لا قرار.
   ===================================================================== */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SES = require("../../stocks/session.js");

const M15 = 15 * 60000, DAY = 86400000;

export const dayKeyOf = (t, mkt) => {
  if (mkt === "crypto") { const x = new Date(t); return x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate(); }
  const p = SES.etParts(t); return p.y * 10000 + p.mo * 100 + p.d;
};
/* مفتاح أسبوع ISO من تاريخٍ YYYYMMDD */
export function isoWeek(dk) {
  const y = Math.floor(dk / 10000), m = Math.floor(dk / 100) % 100, d = dk % 100;
  const t = new Date(Date.UTC(y, m - 1, d));
  const wd = (t.getUTCDay() + 6) % 7;            // الاثنين = 0
  t.setUTCDate(t.getUTCDate() - wd + 3);         // خميس الأسبوع يحدّد سنته
  const y0 = t.getUTCFullYear();
  const f = new Date(Date.UTC(y0, 0, 4));
  const w = 1 + Math.round(((t - f) / DAY - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
  return y0 * 100 + w;
}

function fold(arr, keyOf, endOf) {
  const out = [];
  let cur = null, ck = null;
  for (const b of arr) {
    const k = keyOf(b);
    if (cur && k === ck) {
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v;
    } else {
      if (cur) out.push(cur);
      cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, end: endOf(b, k) }; ck = k;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* =====================================================================
   التحضير مرّةً لكل رمز: سلاسل كاملة مع «لحظة الاكتمال» لكل شمعة.
   `bars15` كل الجلسات (يُرشَّح هنا)، و`bars1d` يومي المخزن.
   ===================================================================== */
export function prep(bars15, bars1d, mkt = "us") {
  const crypto = mkt === "crypto";
  const r15 = [];
  for (const b of bars15 || []) {
    if (!crypto && !(b.v > 0 && SES.isRegularBar(b.t))) continue;
    const d = dayKeyOf(b.t, mkt);
    let last;
    if (crypto) last = (b.t + M15) % DAY === 0;
    else { const w = SES.sessionWindows(b.t); last = !!(w.regular && b.t + M15 === w.regular.end); }
    r15.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0, d, last, end: b.t + M15 });
  }
  const bucket = (H) => {
    const Hms = H * 3600000;
    if (crypto) return fold(r15, b => Math.floor(b.t / Hms), (b, k) => k * Hms + Hms);
    return fold(r15, b => SES.sessionBucket(b.t, H), (b, k) => {
      const start = k * Hms + SES.REG_OPEN * 60000 - SES.etOffsetMs(b.t);
      const w = SES.sessionWindows(b.t);
      return Math.min(start + Hms, w.regular ? w.regular.end : start + Hms);
    });
  };
  const h1 = bucket(1), h4 = bucket(4);
  let d1;
  if (crypto) {
    d1 = fold(r15, b => b.d, () => 0).map(x => { const d = dayKeyOf(x.t, mkt); return { ...x, d, w: isoWeek(d) }; });
  } else {
    d1 = (bars1d || []).map(b => { const d = dayKeyOf(b.t + 12 * 3600000, mkt); return { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, d, w: isoWeek(d) }; });
  }
  return { r15, h1, h4, d1, mkt };
}

/* آخر فهرسٍ يحقّق الشرط في مصفوفةٍ مرتّبة */
function upto(arr, ok) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ok(arr[m])) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
const W = 300;                                  // أطول نافذة يقرؤها المحرّك 259
const slice = (arr, i) => i < 0 ? [] : arr.slice(Math.max(0, i + 1 - W), i + 1);

/* الفهارس عند T — تُحسب مرّةً وتُمرَّر للرمز والسوق */
export function idxAt(S, T) {
  const i15 = upto(S.r15, b => b.end <= T);
  if (i15 < 0) return null;
  const day = S.r15[i15].d;
  return {
    i15, day,
    i1: upto(S.h1, b => b.end <= T),
    i4: upto(S.h4, b => b.end <= T),
    iD: upto(S.d1, b => b.d < day)
  };
}
export function framesAt(S, T) {
  const ix = idxAt(S, T);
  if (!ix) return null;
  return { b15: slice(S.r15, ix.i15), h1: slice(S.h1, ix.i1), h4: slice(S.h4, ix.i4),
           d1: slice(S.d1, ix.iD), day: ix.day, wk: isoWeek(ix.day) };
}
/* مدخلُ `evaluateAt` لرمزٍ عند T، والسوق بإطاره عند نفس T */
export function inputAt(S, M, T) {
  const f = framesAt(S, T), m = framesAt(M, T);
  if (!f || !m) return null;
  return { ...f, mkt: { h1: m.h1, h4: m.h4, d1: m.d1 } };
}
