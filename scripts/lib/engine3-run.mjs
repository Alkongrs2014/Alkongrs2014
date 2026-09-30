/* =====================================================================
   تشغيل المحرّك V3 — **مسارٌ واحد** للحيّ (build-trades) وللتقييم التاريخي
   (validate-engine3). كلاهما يبني المدخلات من مخزن Alpaca SIP بنفس `prep`
   ثم يمشي شموع 15د المغلقة بنفس `advanceSym` — فلا تختلف صفقةٌ معروضة عن
   صفقةٍ مقيسة.

   أدوات التقويم من stocks/session.js (حسابٌ لا قرار). لا استيراد من المحرّكين
   السابقين.
   ===================================================================== */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SES = require("../../stocks/session.js");
const E = require("../../stocks/engine3.js");

const M15 = 15 * 60000, DAY = 86400000;

export const dayKeyOf = (t) => { const p = SES.etParts(t); return p.y * 10000 + p.mo * 100 + p.d; };
export function isoWeek(dk) {
  const y = Math.floor(dk / 10000), m = Math.floor(dk / 100) % 100, d = dk % 100;
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const y0 = t.getUTCFullYear(), f = new Date(Date.UTC(y0, 0, 4));
  return y0 * 100 + 1 + Math.round(((t - f) / DAY - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
}

function fold(arr, keyOf, endOf) {
  const out = [];
  let cur = null, ck = null;
  for (const b of arr) {
    const k = keyOf(b);
    if (cur && k === ck) { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
    else { if (cur) out.push(cur); cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, end: endOf(b, k) }; ck = k; }
  }
  if (cur) out.push(cur);
  return out;
}

/* التحضير مرّةً لكل رمز من شموع المخزن (كل الجلسات) ويوميّه */
export function prep(bars15, bars1d) {
  const r15 = [];
  for (const b of bars15 || []) {
    if (!(b.v > 0 && SES.isRegularBar(b.t))) continue;
    const w = SES.sessionWindows(b.t);
    r15.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, d: dayKeyOf(b.t),
               last: !!(w.regular && b.t + M15 === w.regular.end), end: b.t + M15 });
  }
  const bucket = (H) => {
    const Hms = H * 3600000;
    return fold(r15, b => SES.sessionBucket(b.t, H), (b, k) => {
      const start = k * Hms + SES.REG_OPEN * 60000 - SES.etOffsetMs(b.t);
      const w = SES.sessionWindows(b.t);
      return Math.min(start + Hms, w.regular ? w.regular.end : start + Hms);
    });
  };
  const d1 = (bars1d || []).map(b => { const d = dayKeyOf(b.t + 12 * 3600000); return { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, d, w: isoWeek(d) }; });
  return { r15, h1: bucket(1), h4: bucket(4), d1 };
}

function upto(arr, ok) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ok(arr[m])) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
const WIN = 300;
const cut = (arr, i) => i < 0 ? [] : arr.slice(Math.max(0, i + 1 - WIN), i + 1);

/* المدخلات عند الشمعة r15[i] (مغلقةٌ عند نهايتها T) — كلُّ ما يدخل مغلقٌ عند T */
export function inputAt(S, i) {
  const T = S.r15[i].end, day = S.r15[i].d;
  // تبدأ نافذة 15د من أوّل الأسبوع الجاري على الأقل (أحداث الأسبوع) أو 300 شمعة
  const wkStart = upto(S.r15, b => isoWeek(b.d) < isoWeek(day)) + 1;
  const from = Math.min(Math.max(0, i + 1 - WIN), wkStart);
  const i1 = upto(S.h1, b => b.end <= T);
  return {
    b15: S.r15.slice(from, i + 1),
    h1: cut(S.h1, i1), h4: cut(S.h4, upto(S.h4, b => b.end <= T)),
    d1: cut(S.d1, upto(S.d1, b => b.d < day)),
    wk: isoWeek(day),
    // هل اكتملت شمعة ساعة عند T؟ إن نعم فحالة المتوسطات قبلها (لتحوّل المتوسطات)
    maPrev: (i1 >= 0 && S.h1[i1].end === T) ? E.maOf(cut(S.h1, i1 - 1)).dir : undefined
  };
}
const wkOf = (d) => isoWeek(d);

/* تقييم شمعةٍ واحدة (بلا حالة صفقة) — يستعمله الحيّ لحالة الرمز والتحذيرات */
export function evalAt(S, i) {
  const inp = inputAt(S, i);
  return E.evaluate(inp, wkOf, inp.maPrev);
}
export function stateAtIdx(S, i) { return E.stateAt(inputAt(S, i), wkOf); }

function newTrade(s, sig) {
  return { id: `${s}|${Math.round(sig.t / 1000)}`, s, d: sig.d, status: "confirmed", t: sig.t,
    base: sig.base, evt: sig.evt, weekEvt: sig.weekEvt, el: sig.el, pts: sig.pts, score: sig.score,
    e: sig.e, st: sig.st, stopPivot: sig.stopPivot, risk: sig.risk, tg: sig.tg, rr1: sig.rr1,
    atrD: sig.atrD, ma: sig.ma, trend: sig.trend, trendTf: sig.trendTf, vwap: sig.vwap,
    pdh: sig.pdh, pdl: sig.pdl, pwh: sig.pwh, pwl: sig.pwl };
}

/* =====================================================================
   يمشي شموع رمزٍ من بعد `afterMs` حتى `toMs` (نهاية الشمعة) ضمناً.
   `open` صفقةُ الرمز القائمة (أو null). يعيد { open, closed[], opened[] }.
   ترتيب كل شمعة: (١) الصفقة القائمة تُنفَّذ أو تُدار بها، (٢) إن لم تبقَ صفقة
   يُقيَّم إغلاقُها لإشارةٍ جديدة.
   ===================================================================== */
export function advanceSym(s, S, afterMs, toMs, open, onEval) {
  const closed = [], opened = [];
  const j0 = upto(S.r15, b => b.end <= afterMs) + 1, j1 = upto(S.r15, b => b.end <= toMs);
  for (let j = j0; j <= j1; j++) {
    const bar = S.r15[j];
    if (open) {
      if (open.status === "confirmed") E.fillTrade(open, bar);
      else E.stepTrade(open, bar);
      if (open.status === "closed" || open.status === "cancelled") { closed.push(open); open = null; }
      else continue;
    }
    const r = evalAt(S, j);
    if (onEval) onEval(j, r);
    if (!r.reject) { open = newTrade(s, r.sig); opened.push(open); }
  }
  return { open, closed, opened };
}

export { E as ENGINE };
