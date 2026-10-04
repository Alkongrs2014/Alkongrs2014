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
    else { if (cur) out.push(cur); cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, d: b.d, end: endOf(b, k) }; ck = k; }
  }
  if (cur) out.push(cur);
  return out;
}

/* نافذة بيانات SIP لكل يوم بذاكرة: `sessionWindows` تمرّ بـIntl في كل نداء (~90µs)،
   ومناداتُها لكل شمعة جعلت التحضير ثانيةً لكل رمز. اليوم يُعرف من إزاحة نيويورك
   (مخزَّنة لكل ساعة في session.js) — نفس النتيجة بلا Intl لكل شمعة.

   **النافذة كاملةُ SIP** (قرار المالك 2026-10-01): من بداية ما قبل الافتتاح (04:00)
   إلى نهاية ما بعد الإغلاق (20:00، أو 17:00 في نصف اليوم). الشموع المغلقة في
   الجلسات الثلاث تدخل القرار؛ وقمة/قاع أمس تبقى من اليومي الرسمي (`d1` — Alpaca
   تبني 1Day من الجلسة الرسمية وحدها، مقيسٌ: 120/120 يوماً). */
const winCache = new Map();
function etDayKey(t) {
  const x = new Date(t + SES.etOffsetMs(t));
  return x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate();
}
function winOf(t) {
  const k = etDayKey(t);
  let w = winCache.get(k);
  if (w === undefined) {
    const s = SES.sessionWindows(t);
    w = s.pre ? { start: s.pre.start, end: s.post.end } : null;
    winCache.set(k, w);
  }
  return w;
}

/* التحضير مرّةً لكل رمز من شموع المخزن (كل الجلسات) ويوميّه.
   الساعة و4س دلاءٌ بمرسى بداية نافذة اليوم (04:00): 04:00–05:00 … و04/08/12/16 —
   فأوّلُ ساعةٍ كاملة تُغلق 05:00، والدلوُ الأخير يُقصّ عند نهاية النافذة. */
export function prep(bars15, bars1d) {
  const r15 = [];
  for (const b of bars15 || []) {
    if (!(b.v > 0)) continue;
    const w = winOf(b.t);
    if (!w || b.t < w.start || b.t >= w.end) continue;           // نافذة SIP وحدها
    r15.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, d: etDayKey(b.t),
               last: b.t + M15 === w.end, end: b.t + M15 });
  }
  const bucket = (H) => {
    const Hms = H * 3600000;
    return fold(r15, b => b.d * 100 + Math.floor((b.t - winOf(b.t).start) / Hms), (b) => {
      const w = winOf(b.t), start = w.start + Math.floor((b.t - w.start) / Hms) * Hms;
      return Math.min(start + Hms, w.end);
    });
  };
  /* `end` لليومية = نهاية نافذة SIP ليومها: لحظة «اكتمالها» التي يقرأ بها فريمُ اليومي في
     لقطات §4ج (انقلاب المتوسطات اليومي يُرى في أوّل لقطةٍ بعدها) */
  const d1 = (bars1d || []).map(b => { const d = dayKeyOf(b.t + 12 * 3600000), w = winOf(b.t + 12 * 3600000);
    return { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, d, w: isoWeek(d), end: w ? w.end : b.t + DAY }; });
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

/* =====================================================================
   لقطة الساعة — قرار المالك 2026-10-01: كلُّ ساعة بدايةٌ جديدة بالكامل.
   ===================================================================== */
const HOUR = 3600000;

/* حدُّ لقطة الأسهم: 05:15 نيويورك ثم كلَّ 30 دقيقة حتى نهاية نافذة SIP — الجدول في
   session.js (`scanSlotAt`) مصدرٌ واحد للخادم والواجهة. أحدثُ لقطةٍ ≤ now؛ وقبل أوّل
   لقطةٍ اليوم فآخرُ لقطةٍ في آخر يوم تداول. */
export const stockSlotAt = (now) => SES.scanSlotAt(now);
/* الكريبتو: يومُه 03:00 بتوقيت الرياض = 00:00 UTC (الرياض UTC+3 بلا توقيتٍ صيفي)،
   وكلُّ ساعةٍ UTC حدٌّ جديد. */
export const cryptoHourAt = (now) => Math.floor(now / HOUR) * HOUR;
/* لقطة الكريبتو كلَّ 15 دقيقة على :00/:15/:30/:45 (V4.2، طلب المالك 2026-10-04؛ كانت كلَّ 30 على
   :15/:45 منذ 2026-10-03) — كلُّ إغلاق شمعة 15د لقطة، ونفس دقائق لقطات الأسهم (كلَّ 15 منذ V4.1)
   فيتزامن الدفتران حين يعمل السوقان معاً، ويبقى الكريبتو مستقلاً حين تُغلق الأسهم. والرياض UTC+3
   بلا توقيتٍ صيفي فدقائقُ UTC هي دقائقُ الرياض. أحدثُ حدٍّ ≤ now. */
const Q = 15 * 60000;
export const CRYPTO_STEP = Q;
export const cryptoSlotAt = (now) => Math.floor(now / Q) * Q;

/* تحضير عملةٍ من ملفّها (Binance، شموعٌ بختم UTC): 15د كلّها «رسمية» (سوق 24/7)،
   واليوم يوم UTC = 03:00→03:00 الرياض، والأسبوع أسبوع ISO بتوقيت UTC. */
const utcDay = (t) => { const x = new Date(t); return x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate(); };
export function prepCrypto(rec) {
  const un = (tf) => ((rec && rec.tf && rec.tf[tf] && rec.tf[tf].c) || [])
    .map((a) => Array.isArray(a) ? { t: a[0] * 1000, o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] || 0 } : a);
  const r15 = un("15m").map((b) => ({ ...b, d: utcDay(b.t), last: (b.t + M15) % DAY === 0, end: b.t + M15 }));
  const h1 = un("1h").map((b) => ({ ...b, d: utcDay(b.t), end: b.t + HOUR }));
  const h4 = un("4h").map((b) => ({ ...b, d: utcDay(b.t), end: b.t + 4 * HOUR }));
  const d1 = un("1d").map((b) => { const d = utcDay(b.t); return { ...b, d, w: isoWeek(d), end: b.t + DAY }; });
  return { r15, h1, h4, d1 };
}

/* اللقطة السابقة لحدٍّ H — نافذةُ «الإشارة الجديدة» في §4ج هي (prevSlot, H]: الأسهم من
   جدول session.js (فبعد 19:45 تأتي 05:15 التالية وتضمّ إغلاق اليومي 20:00)، والكريبتو H−15د:
   نوافذُ متّصلة فكلُّ نهاية شمعة تقع في لقطةٍ واحدة بالضبط (لا إشارة تضيع ولا تتكرّر) */
export const prevSlotOf = (book, H) => book === "crypto" ? H - Q : SES.scanSlotAt(H - 1);

/* §4ج: التقييم عند الحدّ H بإشارةٍ جديدة في (prevH, H] — المحرّك يقرّر، وهذا يقطع المدخلات */
export function evalSlot(S, H, prevH) {
  const i = upto(S.r15, (b) => b.end <= H);
  if (i < 0) return { i, r: { reject: "data" } };
  return { i, r: E.evaluateSlot(inputAt(S, i), wkOf, prevH) };
}

/* §6: يمشي صفقةً على شموع 15د المغلقة في (afterMs, toMs] بدوالّ المحرّك نفسها
   (`fillTrade` ثم `stepTrade`) — نفس نمط `advanceSym`. يعدّل الصفقة في مكانها. */
export function stepOver(tr, S, afterMs, toMs) {
  const j0 = upto(S.r15, (b) => b.end <= afterMs) + 1, j1 = upto(S.r15, (b) => b.end <= toMs);
  for (let j = j0; j <= j1; j++) {
    if (tr.status === "confirmed") E.fillTrade(tr, S.r15[j]);
    else if (tr.status === "active") E.stepTrade(tr, S.r15[j]);
    if (tr.status === "closed" || tr.status === "cancelled") break;
  }
  return tr;
}

/* الرمز عند حدّ الساعة H: آخر شمعة 15د مغلقة (نهايتها ≤ H) ثم التقييم من الصفر */
export function evalHour(S, H) {
  const i = upto(S.r15, (b) => b.end <= H);
  if (i < 0) return { i, r: { reject: "data" } };
  return { i, r: E.evaluateHour(inputAt(S, i), wkOf) };
}
