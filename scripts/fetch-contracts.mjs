#!/usr/bin/env node
/* =====================================================================
   قسم العقود — اكتشافٌ مستقلّ لفرص عقود الخيارات (قرار المالك 2026-10-03).

   **ليس تكراراً لفرص الأسهم**: الاكتشاف من حركة السهم نفسها (بمقياس ATR وجهة
   VWAP اليوم) ومن بيانات العقود (التدفّق والسيولة والسبريد والتذبذب الضمني
   مقابل المحقَّق والإغريقيات) ومن الأحداث المؤرَّخة (الأرباح، الفدرالي، التضخّم،
   الوظائف). وفرصةُ V3 على نفس الرمز والجهة تُعرض **تأكيداً إضافياً لا شرطاً**.

   المصادر (مقيسة 2026-10-03): Alpaca OPRA (عرض/طلب/صفقة/إغريقيات/IV)، و
   /v2/options/contracts (Open Interest يوم أمس)، ولقطات SIP للسهم، وشموعه اليومية،
   و events.json (الفدرالي/BLS) و fundamentals.json (موعد الأرباح ووسم «تقديري»)
   و filings.json (8-K آخر 48 ساعة).

   الإيقاع: لقطة كلَّ 30 دقيقة بنفس حدود الأسهم (`scanSlotAt`)، وتثبت داخلها.
     · ما قبل الافتتاح: قائمة `pre` وحدها — تُجهَّز ولا تُعرض قابلةً للتنفيذ
       (سوق العقود مغلق وأسعارها أسعار الأمس).
     · الجلسة الرسمية: `pre` ∪ الخمسون الأساسية — قابلةٌ للتنفيذ حين يكون سوق العقد
       مفتوحاً (16:00، أو 16:15 لصناديق lateClose) وعروضُ كلِّ أرجلها حديثة.
     · بعد الإغلاق: لا بناء جديد؛ تبقى اللقطة الأخيرة موسومةً «سوق العقود مغلق».

   لا تداول ولا أوامر — قراءة بيانات فقط. ولا ادّعاء تنبؤ: كلُّ سببٍ موسومٌ
   «حدث مؤكَّد» أو «مستنتج من البيانات» أو «إشارة غير حاسمة».

   node scripts/fetch-contracts.mjs [--check] [--out DIR] [--now ISO]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { bs, impliedVol } from "./lib/options.mjs";
import * as AO from "./providers/alpaca-options.mjs";

const require = createRequire(import.meta.url);
const SES = require("../stocks/session.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(argOf("out", path.join(ROOT, "data")));
const DAY = 86400000, MIN = 60000;
/* لقطةُ العقود باقيةٌ كلَّ 30 دقيقة على حدود الأسهم (05:15 · 05:45 …) — V4.1 جعل الأسهم 15 والعقود لم تُطلب */
const CT_STEP = 30;
const R = 0.04;                               // عائدٌ خالٍ من المخاطر تقريبي — أثره على عقود أسابيع ضئيل

/* ---------------- المعايير — معلنةٌ في الواجهة ---------------- */
export const P = {
  moveATR: 0.5,          // حركة السهم اليوم بمضاعف ATR اليومي كي تُعدّ حركة
  liq: { minBid: 0.05, minMid: 0.10, maxSpr: 0.12, maxSpr0: 0.18, minOI: 250, minVol: 100 },
  quoteAgeMs: 5 * MIN,   // عمر العرض/الطلب الأقصى كي يُعدّ العقد «حديثاً»
  legSyncMs: 90 * 1000,  // فارقُ توقيت العروض بين أرجل المركز الواحد
  delta: { lo: 0.35, hi: 0.60, best: 0.45 },
  short: { lo: 0.18, hi: 0.32 },       // الرجل المبيعة في سبريد المدين
  credit: { lo: 0.22, hi: 0.38, ivhv: 1.25, minFrac: 0.2 },
  strangle: { lo: 0.22, hi: 0.38 },
  eventDays: 14,         // الحدث داخل هذه المدّة كي يُبنى عليه سترادل/سترانغل
  cats: [["0dte", 0, 0], ["day", 1, 2], ["weekly", 3, 9], ["swing", 10, 60]],
  maxPicks: 80
};
const CAT_AR = { "0dte": "هيرو زيرو 0DTE", day: "مضاربة يومية", weekly: "أسبوعية", swing: "متوسطة وطويلة" };

/* ---------------- أدوات ---------------- */
const readJ = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const r2 = (x) => Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
const r4 = (x) => Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null;
const etDate = (t) => SES.etParts(t).date;
function writeAtomic(f, doc) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(doc)); fs.renameSync(tmp, f);
}
async function pool(items, n, fn) {
  let i = 0; const errs = [];
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) { errs.push([it, e.message]); } }
  }));
  return errs;
}
export function version() {
  const h = crypto.createHash("sha256");
  for (const f of ["scripts/fetch-contracts.mjs", "scripts/providers/alpaca-options.mjs", "scripts/lib/options.mjs"])
    h.update(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n"));
  return h.digest("hex").slice(0, 12);
}

/* ATR(14) ويلدر و HV20 سنوي من الشموع اليومية المكتملة */
export function volStats(d) {
  if (!d || d.length < 22) return { atr: null, hv: null };
  let a = 0; const tr = (i) => Math.max(d[i].h - d[i].l, Math.abs(d[i].h - d[i - 1].c), Math.abs(d[i].l - d[i - 1].c));
  for (let i = 1; i <= 14; i++) a += tr(i); a /= 14;
  for (let i = 15; i < d.length; i++) a = (a * 13 + tr(i)) / 14;
  const rets = []; for (let i = d.length - 20; i < d.length; i++) rets.push(Math.log(d[i].c / d[i - 1].c));
  const m = rets.reduce((x, y) => x + y, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((x, y) => x + (y - m) ** 2, 0) / (rets.length - 1));
  return { atr: a, hv: sd * Math.sqrt(252) };
}

/* سنواتٌ حتى الانتهاء: العقد يعيش حتى إغلاق نيويورك يوم انتهائه */
const yearsTo = (exp, now) => Math.max(0, (SES.sessionCloseAt(Date.parse(exp + "T16:00:00Z")) - now) / (365 * DAY));
const dteOf = (exp, now) => Math.round((Date.parse(exp + "T12:00:00Z") - Date.parse(etDate(now) + "T12:00:00Z")) / DAY);

/* عقدٌ من اللقطة بحقولٍ موحّدة */
export function contractOf(sym, sn, oi, S, now) {
  const p = AO.parseOcc(sym); if (!p) return null;
  const q = sn.latestQuote || {}, bid = q.bp ?? null, ask = q.ap ?? null;
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
  const T = yearsTo(p.exp, now);
  const today = etDate(now);
  const vol = sn.dailyBar && etDate(Date.parse(sn.dailyBar.t) + 12 * 3600e3) === today ? sn.dailyBar.v : 0;
  let iv = sn.impliedVolatility ?? null, g = sn.greeks || null;
  if ((!iv || !g) && mid && T > 0) {                // إغريقياتٌ محسوبة حين لا يعطيها المصدر — وتُوسَم
    const v = impliedVol(mid, { S, K: p.K, T, r: R, type: p.type });
    if (v) { const b = bs({ S, K: p.K, T, r: R, sigma: v, type: p.type }); iv = iv || v; g = g || { delta: b.delta, gamma: b.gamma, theta: b.thetaDay, vega: b.vega / 100, calc: 1 }; }
  }
  return { sym, ...p, bid, ask, mid, spr: mid ? (ask - bid) / mid : null, qt: q.t ? Date.parse(q.t) : null,
    iv, delta: g ? g.delta : null, gamma: g ? g.gamma : null, theta: g ? g.theta : null, vega: g ? g.vega : null,
    gcalc: g && g.calc ? 1 : 0, vol: vol || 0, pvol: sn.prevDailyBar ? sn.prevDailyBar.v : null,
    oi: oi ? oi.oi : null, T, dte: dteOf(p.exp, now) };
}
export function liquid(c, live, now) {
  const L = P.liq;
  if (!(c.bid >= L.minBid && c.mid >= L.minMid && c.spr !== null)) return false;
  if (c.spr > (c.dte === 0 ? L.maxSpr0 : L.maxSpr)) return false;
  if (!((c.oi || 0) >= L.minOI || c.vol >= L.minVol)) return false;
  if (live && !(c.qt && now - c.qt <= P.quoteAgeMs)) return false;
  return Number.isFinite(c.delta) && Number.isFinite(c.iv) && c.T > 0;
}
/* قيمة العقد بنموذج بلاك–شولز عند سعر سهمٍ وزمنٍ متبقٍّ وتقلّب — للوقف والأهداف */
const valAt = (c, S, T, iv) => { if (T <= 0) return Math.max(0, c.type === "call" ? S - c.K : c.K - S); const b = bs({ S, K: c.K, T, r: R, sigma: iv, type: c.type }); return b ? b.price : null; };

/* ---------------- الإشارات لكل سهم ---------------- */
export function signalsOf(u, chain, live) {
  const out = { move: null, vwapSide: 0, flow: null, ivAtm: null, ivhv: null, unusual: [] };
  if (u.prev > 0 && u.atr > 0) out.move = (u.S - u.prev) / u.atr;
  if (u.vwap) out.vwapSide = Math.sign(u.S - u.vwap);
  if (live) {
    let cp = 0, pp = 0;
    for (const c of chain) {
      if (!c.mid || !c.vol) continue;
      const prem = c.vol * c.mid * 100;
      if (c.type === "call") cp += prem; else pp += prem;
      if (c.vol >= 300 && c.oi && c.vol >= c.oi) out.unusual.push({ sym: c.sym, type: c.type, K: c.K, exp: c.exp, vol: c.vol, oi: c.oi, x: r2(c.vol / c.oi) });
    }
    out.flow = { call: Math.round(cp), put: Math.round(pp), skew: pp > 0 ? r2(cp / pp) : null };
    out.unusual.sort((a, b) => b.x - a.x); out.unusual = out.unusual.slice(0, 3);
  }
  const atm = chain.filter((c) => c.dte >= 7 && c.iv).sort((a, b) => (a.dte - b.dte) || (Math.abs(a.K - u.S) - Math.abs(b.K - u.S)));
  if (atm.length) { const e = atm[0].exp; const near = atm.filter((c) => c.exp === e).slice(0, 4); out.ivAtm = near.reduce((a, c) => a + c.iv, 0) / near.length; }
  if (out.ivAtm && u.hv) out.ivhv = r2(out.ivAtm / u.hv);
  return out;
}

/* الجهة من حركة السهم وحدها، والتدفّق يؤكّد أو يعارض */
export function directionOf(sig, live) {
  if (!Number.isFinite(sig.move) || Math.abs(sig.move) < P.moveATR) return { d: 0, why: "حركة السهم دون نصف ATR" };
  const d = Math.sign(sig.move);
  if (live && sig.vwapSide && sig.vwapSide !== d) return { d: 0, why: "السعر في الجهة الأخرى من VWAP اليوم" };
  let flow = 0;
  if (live && sig.flow && sig.flow.skew !== null && sig.flow.call + sig.flow.put >= 250000)
    flow = sig.flow.skew >= 1.5 ? 1 : sig.flow.skew <= 0.67 ? -1 : 0;
  if (flow === -d) return { d: 0, why: "تدفّق العقود يعاكس حركة السهم" };
  return { d, flow: flow === d ? 1 : 0 };
}

function legOut(c, side) {
  return { sym: c.sym, type: c.type, K: c.K, exp: c.exp, side, bid: r2(c.bid), ask: r2(c.ask), mid: r4(c.mid), spr: r4(c.spr),
    iv: r4(c.iv), delta: r4(c.delta), gamma: r4(c.gamma), theta: r4(c.theta), vega: r4(c.vega), gcalc: c.gcalc,
    vol: c.vol, oi: c.oi, qt: c.qt ? Math.round(c.qt / 1000) : null, dte: c.dte };
}
/* أرجلُ المركز الواحد بعروضٍ متقاربة زمناً (`qt` بالثواني في الأرجل المنشورة) */
const synced = (legs) => { const t = legs.map((l) => l.qt).filter(Boolean); return t.length === legs.length && (Math.max(...t) - Math.min(...t)) * 1000 <= P.legSyncMs; };

/* ---------------- المراكز ---------------- */
function rankByDelta(list, lo, hi, best) {
  return list.filter((c) => Math.abs(c.delta) >= lo && Math.abs(c.delta) <= hi)
    .map((c) => ({ c, sc: -Math.abs(Math.abs(c.delta) - best) * 10 + Math.log10(1 + c.vol + (c.oi || 0)) - c.spr * 10 }))
    .sort((a, b) => b.sc - a.sc).map((x) => x.c);
}
const bestByDelta = (list, lo, hi, best) => rankByDelta(list, lo, hi, best)[0] || null;
/* بدائل للمقارنة: عقودٌ أخرى بنفس الانتهاء والنوع اجتازت السيولة ونطاق الدلتا */
const altOut = (c) => ({ sym: c.sym, K: c.K, delta: r4(c.delta), mid: r4(c.mid), ask: r2(c.ask), spr: r4(c.spr), oi: c.oi, vol: c.vol,
  be: r2(c.type === "call" ? c.K + c.ask : c.K - c.ask), iv: r4(c.iv) });
/* عقدٌ منفرد: وقف العقد من مستوى إبطال حركة السهم (≥ نصف القسط حدّاً للخسارة)،
   والأهداف من حركة السهم بمضاعفات نصف ATR — بلاك–شولز بنفس IV بعد أفقٍ قصير */
export function singlePlan(c, u, d, horizonY) {
  const e = c.ask, inv = (u.vwap ? u.vwap : u.S) - d * 0.25 * u.atr;
  const Tn = Math.max(0, c.T - horizonY);
  const stop = Math.max(valAt(c, inv, Tn, c.iv) ?? 0, e * 0.5);
  const uT = [1, 2, 3].map((k) => u.S + d * k * 0.5 * u.atr);
  const tg = uT.map((x) => valAt(c, x, Tn, c.iv));
  if (!(tg[0] > e * 1.05) || !(stop < e)) return null;
  return { entry: r2(e), mid: r4(c.mid), cost: Math.round(e * 100), stop: r2(stop), inv: r2(inv), uT: uT.map(r2), tg: tg.map(r2),
    rr: r2((tg[0] - e) / (e - stop)), be: [r2(c.type === "call" ? c.K + e : c.K - e)], maxL: Math.round(e * 100), maxP: null };
}
function debitPlan(L, Sh, u, d, horizonY) {
  const debit = L.ask - Sh.bid, w = Math.abs(Sh.K - L.K);
  if (!(debit > 0 && debit < 0.8 * w)) return null;
  const Tn = Math.max(0, L.T - horizonY), val = (S) => Math.min(w, Math.max(0, (valAt(L, S, Tn, L.iv) ?? 0) - (valAt(Sh, S, Tn, Sh.iv) ?? 0)));
  const inv = (u.vwap ? u.vwap : u.S) - d * 0.25 * u.atr, stop = Math.max(val(inv), debit * 0.5);
  const uT = [1, 2, 3].map((k) => u.S + d * k * 0.5 * u.atr), tg = uT.map(val);
  if (!(tg[0] > debit * 1.05) || !(stop < debit)) return null;
  return { entry: r2(debit), mid: r4(L.mid - Sh.mid), cost: Math.round(debit * 100), stop: r2(stop), inv: r2(inv), uT: uT.map(r2), tg: tg.map(r2),
    rr: r2((tg[0] - debit) / (debit - stop)), be: [r2(L.type === "call" ? L.K + debit : L.K - debit)],
    maxP: Math.round((w - debit) * 100), maxL: Math.round(debit * 100), width: w };
}
function creditPlan(Sh, Lg, u) {
  const credit = Sh.bid - Lg.ask, w = Math.abs(Sh.K - Lg.K);
  if (!(credit >= P.credit.minFrac * w - 1e-9 && credit < w)) return null;
  return { entry: r2(credit), mid: r4(Sh.mid - Lg.mid), cost: Math.round((w - credit) * 100), credit: Math.round(credit * 100),
    stop: r2(Math.min(w, credit * 2)), tg: [r2(credit * 0.5)], inv: r2(Sh.K), uT: [], rr: r2((credit * 0.5) / (Math.min(w, credit * 2) - credit)),
    be: [r2(Sh.type === "put" ? Sh.K - credit : Sh.K + credit)], maxP: Math.round(credit * 100), maxL: Math.round((w - credit) * 100),
    pop: r2(1 - Math.abs(Sh.delta)), width: w };
}
/* سترادل/سترانغل: الحركة اللازمة للتعادل مقابل التذبذب، والأهداف بقيمة المركز بعد
   الحدث على **تذبذبٍ منخفض** (أثر انهيار IV) — افتراضٌ معلن لا تنبؤ */
function volPlan(C, Pt, u, eventT, now) {
  const cost = C.ask + Pt.ask;
  if (!(cost > 0)) return null;
  const be = [r2(C.K + cost), r2(Pt.K - cost)];
  const need = Math.max(be[0] - u.S, u.S - be[1]) / u.S;
  const ivAfter = Math.max(u.hv || 0, 0.7 * ((C.iv + Pt.iv) / 2));
  const Tn = Math.max(0, C.T - Math.max(0, (eventT - now)) / (365 * DAY) - 1 / 365);
  const valAtS = (S) => (valAt(C, S, Tn, ivAfter) ?? 0) + (valAt(Pt, S, Tn, ivAfter) ?? 0);
  const moveFor = (target) => { for (let m = 0; m <= 0.6; m += 0.0025) { if (Math.max(valAtS(u.S * (1 + m)), valAtS(u.S * (1 - m))) >= target) return m; } return null; };
  const tg = [1.25, 1.5, 2].map((k) => r2(cost * k));
  const hvMove = u.hv ? u.hv * Math.sqrt(Math.max(1, C.dte) / 365) : null;
  return { entry: r2(cost), mid: r4(C.mid + Pt.mid), cost: Math.round(cost * 100), stop: r2(cost * 0.5), tg,
    uMove: tg.map((t) => { const m = moveFor(t); return m === null ? null : r4(m); }), be, need: r4(need),
    implied: r4((C.mid + Pt.mid) / u.S), hvMove: r4(hvMove), ivAfter: r4(ivAfter), maxL: Math.round(cost * 100), maxP: null,
    rr: null };
}

/* ---------------- المعالجة لكل سهم ---------------- */
export function picksFor(u, chain, ctx) {
  const { now, live, v3, events } = ctx;
  const sig = signalsOf(u, chain, live);
  const okC = chain.filter((c) => liquid(c, live, now));
  const why = [], picks = [];
  const dir = directionOf(sig, live);
  const exps = [...new Set(okC.map((c) => c.exp))].sort();
  const reasonsDir = (d) => {
    const r = [{ k: "inferred", t: `السهم ${d > 0 ? "صاعد" : "هابط"} ${r2(Math.abs(sig.move))}×ATR اليوم${live && sig.vwapSide === d ? " وفي جهته من VWAP" : ""}` }];
    if (dir.flow) r.push({ k: "inferred", t: `تدفّق العقود يؤيّد: أقساط ${d > 0 ? "الكول" : "البوت"} ${r2(d > 0 ? sig.flow.skew : 1 / sig.flow.skew)}× المقابل` });
    if (sig.unusual.length) r.push({ k: "weak", t: `نشاط غير معتاد: ${sig.unusual.map((x) => `${x.type === "call" ? "C" : "P"}${x.K} ${x.exp.slice(5)} حجم ${x.x}× OI`).join(" · ")}` });
    if (sig.ivhv) r.push({ k: sig.ivhv >= 1.3 ? "weak" : "weak", t: `IV/HV ${sig.ivhv}${sig.ivhv >= 1.3 ? " — العقود غالية نسبياً" : ""}` });
    return r;
  };
  const v3c = (d) => v3 && v3.d === d ? { d: v3.d, score: v3.score } : null;
  const base = { s: u.s, etf: !!u.etf, S: r2(u.S), chg: r2(u.prev ? (u.S / u.prev - 1) * 100 : null), atr: r2(u.atr), hv: r4(u.hv), ivhv: sig.ivhv,
                 vwap: r2(u.vwap), flow: sig.flow, sess: u.sess };
  if (dir.d) {
    const d = dir.d, type = d > 0 ? "call" : "put";
    for (const [cat, lo, hi] of P.cats) {
      const e = exps.find((x) => { const t = dteOf(x, now); return t >= lo && t <= hi; });
      if (!e) continue;
      const inExp = okC.filter((c) => c.exp === e && c.type === type);
      const ranked = rankByDelta(inExp, P.delta.lo, P.delta.hi, P.delta.best), L = ranked[0];
      if (!L) continue;
      const horizon = cat === "0dte" ? 1 / (365 * 24) : cat === "day" ? 3 / (365 * 24) : 1 / 365;
      const pl = singlePlan(L, u, d, horizon);
      if (pl) picks.push({ ...base, kind: "single", cat, d, legs: [legOut(L, "buy")], ...pl, why: reasonsDir(d), v3: v3c(d),
                           alts: ranked.slice(1, 3).map(altOut),
                           score: r2(Math.abs(sig.move) + dir.flow + Math.log10(1 + L.vol + (L.oi || 0)) / 2 - L.spr * 5) });
      // سبريد مدين بنفس الانتهاء: رجلٌ مبيعة أبعد بدلتا أصغر
      const Sh = bestByDelta(inExp.filter((c) => (c.K - L.K) * d > 0), P.short.lo, P.short.hi, (P.short.lo + P.short.hi) / 2);
      if (Sh) {
        const legs = [legOut(L, "buy"), legOut(Sh, "sell")];
        const dp = debitPlan(L, Sh, u, d, horizon);
        if (dp && (!live || synced(legs))) picks.push({ ...base, kind: "debit", cat, d, legs, ...dp, why: reasonsDir(d), v3: v3c(d),
          score: r2(Math.abs(sig.move) + dir.flow) });
      }
      // سبريد دائن حين تكون العقود غالية: نبيع الجهة المعاكسة لحركة السهم
      if (sig.ivhv >= P.credit.ivhv && cat !== "0dte") {
        const otype = d > 0 ? "put" : "call";
        const opp = okC.filter((c) => c.exp === e && c.type === otype);
        const S2 = bestByDelta(opp, P.credit.lo, P.credit.hi, 0.30);
        if (S2) {
          const Lg = opp.filter((c) => (S2.K - c.K) * d > 0).sort((a, b) => Math.abs(a.K - S2.K) - Math.abs(b.K - S2.K))[0];
          const legs = Lg ? [legOut(S2, "sell"), legOut(Lg, "buy")] : null;
          const cp = Lg && creditPlan(S2, Lg, u);
          if (cp && (!live || synced(legs))) picks.push({ ...base, kind: "credit", cat, d, legs, ...cp,
            why: [...reasonsDir(d), { k: "inferred", t: `IV/HV ${sig.ivhv} — بيع قسطٍ غالٍ في الجهة المعاكسة` }], v3: v3c(d), score: r2(Math.abs(sig.move)) });
        }
      }
    }
  } else why.push(dir.why);
  // الحدث: أرباحٌ أو (للصناديق) حدثٌ اقتصادي قوي قبل الانتهاء
  for (const ev of events) {
    if (ev.at <= now || ev.at - now > P.eventDays * DAY) continue;
    if (ev.kind === "macro" && !u.etf) continue;
    const e = exps.find((x) => SES.sessionCloseAt(Date.parse(x + "T16:00:00Z")) > ev.at + (ev.kind === "earn" ? DAY : 0));
    if (!e) continue;
    const calls = okC.filter((c) => c.exp === e && c.type === "call"), puts = okC.filter((c) => c.exp === e && c.type === "put");
    const cat = (() => { const t = dteOf(e, now); return (P.cats.find(([, lo, hi]) => t >= lo && t <= hi) || ["swing"])[0]; })();
    const evWhy = { k: ev.estimated ? "inferred" : "event", t: `${ev.ar} ${ev.estimated ? "(موعد تقديري)" : "(موعد مؤكَّد)"} ${new Date(ev.at).toISOString().slice(0, 10)} قبل انتهاء ${e}` };
    // سترادل: نفس السترايك للجهتين وأقربه إلى السعر
    const ks = calls.map((c) => c.K).filter((k) => puts.some((p) => p.K === k)).sort((a, b) => Math.abs(a - u.S) - Math.abs(b - u.S));
    if (ks.length) {
      const C = calls.find((c) => c.K === ks[0]), Pt = puts.find((p) => p.K === ks[0]);
      const legs = [legOut(C, "buy"), legOut(Pt, "buy")], vp = volPlan(C, Pt, u, ev.at, now);
      if (vp && (!live || synced(legs))) picks.push({ ...base, kind: "straddle", cat, d: 0, legs, ...vp,
        why: [evWhy, { k: "weak", t: `يلزم تحرّك ${r2(vp.need * 100)}% للتعادل · الضمني ${r2(vp.implied * 100)}% · التاريخي ${r2((vp.hvMove || 0) * 100)}%` },
              { k: "weak", t: "خطر انهيار IV بعد الحدث وتآكل القيمة الزمنية — ربحُ رجلٍ لا يعني ربح المركز" }],
        v3: null, ev: { at: Math.round(ev.at / 1000), ar: ev.ar, est: !!ev.estimated }, score: r2(vp.hvMove && vp.need ? vp.hvMove / vp.need : 0) });
    }
    const C2 = bestByDelta(calls, P.strangle.lo, P.strangle.hi, 0.30), P2 = bestByDelta(puts, P.strangle.lo, P.strangle.hi, 0.30);
    if (C2 && P2 && C2.K > P2.K) {
      const legs = [legOut(C2, "buy"), legOut(P2, "buy")], vp = volPlan(C2, P2, u, ev.at, now);
      if (vp && (!live || synced(legs))) picks.push({ ...base, kind: "strangle", cat, d: 0, legs, ...vp,
        why: [evWhy, { k: "weak", t: `يلزم تحرّك ${r2(vp.need * 100)}% للتعادل · الضمني ${r2(vp.implied * 100)}% · التاريخي ${r2((vp.hvMove || 0) * 100)}%` },
              { k: "weak", t: "خطر انهيار IV بعد الحدث وتآكل القيمة الزمنية — ربحُ رجلٍ لا يعني ربح المركز" }],
        v3: null, ev: { at: Math.round(ev.at / 1000), ar: ev.ar, est: !!ev.estimated }, score: r2(vp.hvMove && vp.need ? vp.hvMove / vp.need : 0) });
    }
    break;                                                // أقرب حدثٍ واحد لكل سهم
  }
  return { picks, sig, why, liquid: okC.length, total: chain.length };
}

/* ---------------- التشغيل ---------------- */
/* آخرُ لقطةٍ في جلسةٍ رسمية ≤ now (لعطلة الأسبوع أو بعد عطلة بلا لقطةٍ سابقة) */
function lastRegularSlot(now) {
  for (let i = 0; i < 10; i++) {
    const w = SES.sessionWindows(now - i * DAY);
    if (!w.regular) continue;
    const ok = SES.scanSlotsOf(now - i * DAY, CT_STEP).filter((h) => h >= w.regular.start && h <= w.regular.end && h <= now);
    if (ok.length) return ok[ok.length - 1];
  }
  return null;
}
function ensureTrack(out) {
  const f = path.join(out, "contracts-track.json");
  if (!fs.existsSync(f)) writeAtomic(f, { v: 1, rows: [], updated: Date.now() });
}
/* عقدٌ انتهى (بعد إغلاق نيويورك يوم انتهائه) لا يُعرض في اللقطة المغلقة — كان عقد 0DTE يوم الجمعة
   يبقى معروضاً طوال العطلة وقد زال من OPRA (مقيس 2026-10-03: AVGO 2026-10-02 355C) */
const expired = (p, now) => p.legs.some((l) => SES.sessionCloseAt(Date.parse(l.exp + "T16:00:00Z")) <= now);
const closeDoc = (doc, now = Date.now()) => {
  const picks = (doc.picks || []).filter((p) => !expired(p, now))
    .map((p) => ({ ...p, exec: false, execWhy: "سوق العقود مغلق — آخر لقطة من الجلسة" }));
  return { ...doc, phase: "post", marketOpen: false, note: "سوق العقود مغلق — آخر لقطة من الجلسة", picks, count: picks.length };
};

export async function run({ now = Date.now(), out = OUT, _closed = false } = {}) {
  ensureTrack(out);
  const H = SES.scanSlotAt(now, CT_STEP);
  if (!H) return { ok: false, why: "لا حدّ لقطة" };
  const ver = version();
  const file = path.join(out, "contracts.json");
  const prev = readJ(file);
  if (prev && prev.version === ver && prev.hour === Math.round(H / 1000)) return { ok: true, same: true, doc: prev };
  const w = SES.sessionWindows(H);
  const phase = !w.regular ? "closed" : H < w.regular.start ? "pre" : H <= w.regular.end ? "regular" : "post";
  if (phase === "post" || phase === "closed") {
    /* بعد الإغلاق تبقى آخر لقطة للاطّلاع، وكلُّ عقدٍ فيها **غير قابلٍ للتنفيذ** — لا الترويسة وحدها */
    if (prev && (prev.phase !== "post" || (prev.picks || []).some((p) => expired(p, now)))) {
      const doc = closeDoc(prev, now); writeAtomic(file, doc); return { ok: true, doc, closed: true };
    }
    /* لا لقطةَ سابقة (أوّل تشغيل، أو بعد عطلة): تُبنى من آخر لقطةٍ في جلسةٍ رسمية وتُوسَم مغلقة —
       كي لا تبقى الشاشة على ملفٍّ غائب، ولا يُعرض عقدٌ قابلاً للتنفيذ والسوق مغلق */
    if (!prev && !_closed) { const Hr = lastRegularSlot(now); if (Hr) return run({ now: Hr + MIN, out, _closed: true }); }
    return { ok: true, same: true, doc: prev, why: "سوق العقود مغلق" };
  }
  const live = phase === "regular";
  const U = readJ(path.join(ROOT, "stocks/contracts-universe.json"));
  const core = readJ(path.join(ROOT, "stocks/symbols.json")).symbols.map((x) => x.s).slice(0, 50);
  const syms = live ? [...new Set([...U.pre, ...core])] : U.pre;
  const etf = new Set(U.etf), late = new Set(U.lateClose);

  // السهم: لقطة SIP وشموع يومية (مخزّنة لليوم)
  const cacheDir = path.join(out, "contracts-cache"); fs.mkdirSync(cacheDir, { recursive: true });
  const today = etDate(H);
  const dKey = path.join(cacheDir, `daily-${today}.json`);
  let daily = readJ(dKey) || {};
  const needD = syms.filter((s) => !daily[s]);
  if (needD.length) { Object.assign(daily, await AO.dailyBars(needD, new Date(H - 120 * DAY).toISOString())); writeAtomic(dKey, daily); }
  const snaps = await AO.stockSnapshots(syms);
  const fund = (readJ(path.join(out, "fundamentals.json")) || {}).f || {};
  const evs = ((readJ(path.join(out, "events.json")) || {}).events || []).filter((e) => e.w >= 3).map((e) => ({ at: e.at, ar: e.ar, kind: "macro" }));
  /* صفقات V3 الجديدة والقائمة (§4ج — القائمة تُحمَل بخطتها، والتوافق الحالي في `now`) */
  const TR = readJ(path.join(out, "trades.json")) || {};
  /* SPY وQQQ خارج كون الأسهم: صفقاتُهما في idx-trades.json (نفس المحرّك — build-idx.mjs) */
  const TI = readJ(path.join(out, "idx-trades.json")) || {};
  const v3 = Object.fromEntries([...(TR.active || []), ...(TI.active || [])].map((t) => ({ ...t, score: t.now && Number.isFinite(t.now.score) ? t.now.score : t.score }))
    .concat(TR.open || [], TI.open || []).map((t) => [t.s, t]));
  /* أحداث الشركة الموثّقة: إيداعات 8-K في 48 ساعة (SEC، موجودة في filings.json)، وعناوين
     الأخبار في 24 ساعة (Benzinga عبر Alpaca) — الأولى حدثٌ مؤكَّد، والثانية إشارةٌ غير حاسمة */
  const k8 = {};
  for (const f of ((readJ(path.join(out, "filings.json")) || {}).rows || []))
    if (f.form === "8-K" && f.at > H - 2 * DAY && f.at <= H) (k8[f.s] ||= []).push(f);
  let newsBy = {};
  try { newsBy = await AO.news(syms, new Date(H - DAY).toISOString()); } catch (e) { console.warn(`  ⚠ الأخبار: ${e.message}`); }
  const oiKey = path.join(cacheDir, `oi-${today}.json`);
  const oiCache = readJ(oiKey) || {};

  const all = [], skip = {}, sigs = {};
  const expLte = new Date(H + 60 * DAY).toISOString().slice(0, 10), expGte = today;
  const errs = await pool(syms, 6, async (s) => {
    const sn = snaps[s];
    if (!sn || !sn.latestTrade) { skip[s] = "لا لقطة للسهم"; return; }
    const dd = (daily[s] || []).filter((b) => etDate(b.t + 12 * 3600e3) < today);
    const { atr, hv } = volStats(dd);
    const dayIsToday = sn.dailyBar && etDate(Date.parse(sn.dailyBar.t) + 12 * 3600e3) === today;
    const prevC = dayIsToday ? sn.prevDailyBar?.c : sn.dailyBar?.c;
    const S = sn.latestTrade.p;
    const u = { s, S, prev: prevC, atr, hv, etf: etf.has(s), vwap: live && dayIsToday ? sn.dailyBar.vw : null,
                sess: live ? "REGULAR" : "PRE", tradeAt: Date.parse(sn.latestTrade.t) };
    if (!(S > 0 && atr > 0)) { skip[s] = "بلا سعر أو ATR"; return; }
    const kLo = Math.floor(S * 0.8), kHi = Math.ceil(S * 1.2);
    const { snaps: ch } = await AO.chainSnapshots(s, { expGte, expLte, kLo, kHi });
    if (!oiCache[s]) oiCache[s] = await AO.contractsOI(s, { expGte, expLte, kLo, kHi });
    const chain = Object.entries(ch).map(([k, v]) => contractOf(k, v, oiCache[s][k], S, H)).filter(Boolean);
    const earn = fund[s] && fund[s].earnings && fund[s].earnings.at ? [{ at: fund[s].earnings.at, ar: "إعلان الأرباح", kind: "earn", estimated: !!fund[s].earnings.estimated }] : [];
    const res = picksFor(u, chain, { now: H, live, v3: v3[s] ? { d: v3[s].d, score: v3[s].score } : null, events: [...earn, ...evs].sort((a, b) => a.at - b.at) });
    sigs[s] = { S: r2(S), chg: r2(prevC ? (S / prevC - 1) * 100 : null), move: r2(res.sig.move), ivhv: res.sig.ivhv, flow: res.sig.flow,
                liquid: res.liquid, total: res.total, why: res.why };
    const corp = [
      ...(k8[s] || []).slice(0, 2).map((f) => ({ k: "event", t: `إفصاح 8-K ${f.items && f.items.length ? "(بند " + f.items.join("، ") + ") " : ""}${new Date(f.at).toISOString().slice(0, 16).replace("T", " ")} UTC` })),
      ...((newsBy[s] || []).filter((n) => n.at * 1000 <= H).slice(0, 2).map((n) => ({ k: "weak", t: `خبر: ${n.h.slice(0, 140)}` })))];
    for (const p of res.picks) {
      if (corp.length) p.why = [...p.why, ...corp];
      // قابلٌ للتنفيذ: سوق العقود مفتوح لهذا الرمز الآن، وكلُّ أرجله حديثة
      const closeAt = w.regular.end + (late.has(s) ? 15 * MIN : 0);
      const fresh = p.legs.every((l) => l.qt && H - l.qt * 1000 <= P.quoteAgeMs);
      p.exec = live && H < closeAt && fresh;
      p.execWhy = !live ? "سوق العقود يفتح 09:30 نيويورك — مُجهَّز بأسعار آخر جلسة" : !fresh ? "عرض/طلب قديم" : H >= closeAt ? "سوق العقود مغلق" : null;
      p.at = Math.round(H / 1000);
      p.id = `${p.s}|${p.kind}|${p.legs.map((l) => l.sym).join("+")}|${p.at}`;
      all.push(p);
    }
  });
  writeAtomic(oiKey, oiCache);
  for (const [s, m] of errs) skip[s] = m;
  all.sort((a, b) => (b.score || 0) - (a.score || 0));
  const picks = all.slice(0, P.maxPicks);
  /* سلوك العقد تاريخياً: آخر عشر جلسات لكل رجل (إغلاق وحجم) — منها تغيّرُ سعره
     بالأيام، ويُعرض بجانبه التآكل الزمني اليومي (θ ÷ القسط) */
  try {
    const legSyms = [...new Set(picks.flatMap((p) => p.legs.map((l) => l.sym)))];
    const hb = legSyms.length ? await AO.optionBars(legSyms, "1Day", new Date(H - 16 * DAY).toISOString()) : {};
    for (const p of picks) for (const l of p.legs) {
      const b = (hb[l.sym] || []).filter((x) => x.t < H).slice(-10);
      if (b.length) l.hist = b.map((x) => [Math.round(x.t / 1000), r4(x.c), x.v]);
      if (Number.isFinite(l.theta) && l.mid > 0) l.decay = r4(l.theta / l.mid);
    }
  } catch (e) { console.warn(`  ⚠ تاريخ العقود: ${e.message}`); }
  if (!picks.length && Object.keys(skip).length > syms.length / 2) return { ok: false, why: `فشل أكثر من نصف الرموز: ${JSON.stringify(skip).slice(0, 300)}` };
  const doc = { v: 1, version: ver, generatedAt: new Date().toISOString(), hour: Math.round(H / 1000), phase, marketOpen: live,
    universe: { n: syms.length, pre: U.pre.length, core: live ? core.length : 0 }, params: P, cats: CAT_AR,
    count: picks.length, picks, sigs, skip, stats: { requests: AO.optStats.requests, failures: AO.optStats.failures } };
  doc.rowsHash = crypto.createHash("sha256").update(JSON.stringify(picks)).digest("hex").slice(0, 12);
  const final = _closed ? closeDoc(doc) : doc;   // Date.now(): الانتهاء يُقاس بالآن لا بلحظة اللقطة
  writeAtomic(file, final);
  return { ok: true, doc: final };
}

/* =====================================================================
   التتبّع — وقتُ بلوغ الأهداف الذي **وقع فعلاً** (لا موعدٌ متوقَّع).

   كلُّ فرصةٍ ظهرت قابلةً للتنفيذ تُتتبَّع بمفتاح أرجلها (لا بلقطتها): ظهورُ نفس
   المركز في لقطةٍ تالية لا يكرّره. وقيمة المركز من شموع الدقيقة لأرجله (OPRA):
   المنفرد بقمّة/قاع الدقيقة، والمتعدّد بإغلاقات الدقائق التي تتداول فيها أرجلُه
   كلُّها معاً — تقريبٌ معلن. الشراء: هدفٌ حين ترتفع القيمة إليه ووقفٌ حين تنزل؛
   والدائن بالعكس (كلفة الإغلاق تنزل إلى الهدف أو ترتفع إلى الوقف).
   ===================================================================== */
const keyOf = (p) => `${p.s}|${p.kind}|${p.legs.map((l) => l.sym).join("+")}`;
export function walkHits(tr, series) {
  const credit = tr.kind === "credit";
  for (const [t, hi, lo] of series) {
    if (t * 1000 < tr.at * 1000) continue;
    if (tr.status !== "open") break;
    const adv = credit ? hi : lo, fav = credit ? lo : hi;          // الأسوأ ثم الأفضل داخل الدقيقة
    if (credit ? adv >= tr.stop : adv <= tr.stop) { tr.status = "stop"; tr.end = t; break; }
    while (tr.hits.length < tr.tg.length && (credit ? fav <= tr.tg[tr.hits.length] : fav >= tr.tg[tr.hits.length])) tr.hits.push(t);
    if (tr.hits.length === tr.tg.length) { tr.status = "done"; tr.end = t; break; }
  }
  return tr;
}
function positionSeries(tr, bars) {
  if (tr.legs.length === 1) return (bars[tr.legs[0].sym] || []).map((b) => [Math.round(b.t / 1000), b.h, b.l]);
  const maps = tr.legs.map((l) => new Map((bars[l.sym] || []).map((b) => [b.t, b.c])));
  const ts = [...maps[0].keys()].filter((t) => maps.every((m) => m.has(t))).sort((a, b) => a - b);
  return ts.map((t) => { const v = tr.legs.reduce((a, l, i) => a + (l.side === "buy" ? 1 : -1) * maps[i].get(t), 0) * (tr.kind === "credit" ? -1 : 1);
    return [Math.round(t / 1000), v, v]; });
}
export async function track({ now = Date.now(), out = OUT, picks = [] } = {}) {
  const f = path.join(out, "contracts-track.json");
  const T = readJ(f) || { v: 1, rows: [] };
  const known = new Set(T.rows.map((r) => r.key));
  for (const p of picks) {
    if (!p.exec || known.has(keyOf(p))) continue;
    T.rows.push({ key: keyOf(p), id: p.id, s: p.s, kind: p.kind, cat: p.cat, d: p.d, at: p.at, legs: p.legs.map((l) => ({ sym: l.sym, side: l.side })),
                  exp: p.legs[0].exp, entry: p.entry, stop: p.stop, tg: p.tg, hits: [], status: "open" });
    known.add(keyOf(p));
  }
  const today = etDate(now);
  for (const r of T.rows) if (r.status === "open" && r.exp < today) { r.status = "expired"; r.end = Math.round(SES.sessionCloseAt(Date.parse(r.exp + "T16:00:00Z")) / 1000); }
  const open = T.rows.filter((r) => r.status === "open");
  if (open.length) {
    const syms = [...new Set(open.flatMap((r) => r.legs.map((l) => l.sym)))];
    const from = new Date(Math.min(...open.map((r) => r.at)) * 1000).toISOString();
    const bars = await AO.optionBars(syms, "1Min", from);
    for (const r of open) walkHits(r, positionSeries(r, bars));
  }
  T.rows = T.rows.filter((r) => now / 1000 - r.at < 10 * 86400).slice(-400);   // عشرة أيام
  T.updated = now;
  writeAtomic(f, T);
  return T;
}

/* ---------------- الفحص الذاتي (بلا شبكة) ---------------- */
function selfCheck() {
  let n = 0; const ok = (c, m) => { if (!c) throw new Error(m); n++; };
  const now = Date.parse("2026-10-05T15:00:00Z");
  const mk = (type, K, exp, bid, ask, delta, iv, extra = {}) => ({ sym: `X${exp.replace(/-/g, "").slice(2)}${type[0].toUpperCase()}${String(K * 1000).padStart(8, "0")}`,
    type, K, exp, bid, ask, mid: (bid + ask) / 2, spr: (ask - bid) / ((bid + ask) / 2), qt: now - 30000, iv, delta, gamma: 0.05, theta: -0.1, vega: 0.1,
    gcalc: 0, vol: 500, pvol: 100, oi: 1000, T: yearsTo(exp, now), dte: dteOf(exp, now), ...extra });
  // السيولة
  ok(liquid(mk("call", 100, "2026-10-09", 2, 2.1, 0.5, 0.3), true, now), "عقدٌ سائل رُفض");
  ok(!liquid(mk("call", 100, "2026-10-09", 2, 2.6, 0.5, 0.3), true, now), "سبريد واسع قُبل");
  ok(!liquid(mk("call", 100, "2026-10-09", 2, 2.1, 0.5, 0.3, { qt: now - 10 * MIN }), true, now), "عرضٌ قديم قُبل في الجلسة");
  ok(!liquid(mk("call", 100, "2026-10-09", 2, 2.1, 0.5, 0.3, { oi: 10, vol: 5 }), true, now), "بلا OI ولا حجم قُبل");
  // الجهة: الحركة وحدها لا تكفي إن عاكسها VWAP أو التدفّق
  ok(directionOf({ move: 0.3 }, true).d === 0, "حركة صغيرة أعطت جهة");
  ok(directionOf({ move: 0.8, vwapSide: 1, flow: { call: 9e5, put: 1e5, skew: 9 } }, true).d === 1, "صعودٌ مؤيَّد لم يُعطَ جهة");
  ok(directionOf({ move: 0.8, vwapSide: -1 }, true).d === 0, "VWAP معاكس قُبل");
  ok(directionOf({ move: 0.8, vwapSide: 1, flow: { call: 1e5, put: 9e5, skew: 0.11 } }, true).d === 0, "تدفّقٌ معاكس قُبل");
  // خطة عقدٍ منفرد: الوقف تحت الدخول والأهداف فوقه وتصاعدية
  const u = { s: "X", S: 100, prev: 98, atr: 3, hv: 0.3, vwap: 99.5 };
  const c = mk("call", 100, "2026-10-16", 2.4, 2.5, 0.5, 0.35);
  const pl = singlePlan(c, u, 1, 1 / 365);
  ok(pl && pl.stop < pl.entry && pl.tg[0] > pl.entry && pl.tg[1] > pl.tg[0] && pl.tg[2] > pl.tg[1], "خطة منفردة: " + JSON.stringify(pl));
  ok(pl.stop >= pl.entry * 0.5 - 1e-9, "وقف العقد تجاوز نصف القسط");
  ok(Math.abs(pl.be[0] - (100 + 2.5)) < 1e-9, "نقطة تعادل الكول");
  // البوت بالعكس
  const pp = singlePlan(mk("put", 100, "2026-10-16", 2.4, 2.5, -0.5, 0.35), u, -1, 1 / 365);
  ok(pp && pp.uT[0] < u.S && pp.be[0] === 97.5, "البوت");
  // سترادل: نقطتا تعادل حول السترايك بمقدار التكلفة كاملة، والحركة اللازمة موجبة
  const C = mk("call", 100, "2026-10-16", 2.4, 2.5, 0.5, 0.4), Pt = mk("put", 100, "2026-10-16", 2.3, 2.4, -0.5, 0.4);
  const vp = volPlan(C, Pt, u, now + 2 * DAY, now);
  ok(vp && vp.be[0] === 104.9 && vp.be[1] === 95.1 && vp.need > 0.04, "سترادل: " + JSON.stringify(vp && vp.be));
  ok(vp.stop === r2(4.9 * 0.5) && vp.tg[0] > vp.entry, "وقف/أهداف السترادل للمركز كاملاً");
  // سبريد مدين: أقصى ربح = العرض − المدين، وأقصى خسارة = المدين
  const Lc = mk("call", 100, "2026-10-16", 2.4, 2.5, 0.5, 0.35), Sc = mk("call", 105, "2026-10-16", 0.8, 0.9, 0.25, 0.35);
  const dp = debitPlan(Lc, Sc, u, 1, 1 / 365);
  ok(dp && dp.maxL === 170 && dp.maxP === 330 && dp.be[0] === 101.7, "سبريد مدين: " + JSON.stringify(dp));
  // سبريد دائن: الخسارة القصوى = العرض − الائتمان
  const Sp = mk("put", 95, "2026-10-16", 1.2, 1.3, -0.3, 0.45), Lp = mk("put", 92, "2026-10-16", 0.5, 0.6, -0.18, 0.45);
  const cp = creditPlan(Sp, Lp, u);
  ok(cp && cp.maxP === 60 && cp.maxL === 240 && cp.be[0] === 94.4, "سبريد دائن: " + JSON.stringify(cp));
  // أرجلٌ غير متزامنة تُرفض
  ok(!synced([{ qt: 1000 }, { qt: 1200 }]) && synced([{ qt: 1000 }, { qt: 1030 }]), "تزامن الأرجل");
  // التتبّع: الوقف يسبق الهدف في نفس الدقيقة، والأهداف بترتيبها، والدائن بالعكس
  const tr = (o) => ({ kind: "single", at: 100, entry: 2, stop: 1, tg: [2.5, 3, 4], hits: [], status: "open", ...o });
  let x = walkHits(tr(), [[110, 2.6, 1.9], [120, 3.1, 2.4], [130, 3.5, 0.9]]);
  ok(x.hits.join() === "110,120" && x.status === "stop" && x.end === 130, "تتبّع الشراء: " + JSON.stringify(x));
  x = walkHits(tr(), [[90, 9, 0.1], [110, 2.4, 0.95]]);
  ok(x.hits.length === 0 && x.status === "stop", "دقيقةٌ قبل الظهور تُحتسب أو الهدف قبل الوقف");
  x = walkHits(tr({ kind: "credit", entry: 2, stop: 4, tg: [1] }), [[110, 2.5, 0.9]]);
  ok(x.hits.join() === "110" && x.status === "done", "تتبّع الدائن");
  // اللقطة المغلقة: لا عقد قابلاً للتنفيذ، ولا عقد انتهى (0DTE بعد إغلاق يومه)
  const fri = Date.parse("2026-10-02T21:00:00Z");      // الجمعة بعد الإغلاق
  const cd = closeDoc({ picks: [{ s: "A", exec: true, legs: [{ exp: "2026-10-02" }] }, { s: "B", exec: true, legs: [{ exp: "2026-10-09" }] }] }, fri);
  ok(cd.picks.length === 1 && cd.picks[0].s === "B" && cd.picks[0].exec === false && cd.phase === "post", "اللقطة المغلقة: " + JSON.stringify(cd.picks));
  // رمز OCC
  const o = AO.parseOcc("NVDA261009C00235000");
  ok(o && o.root === "NVDA" && o.exp === "2026-10-09" && o.type === "call" && o.K === 235, "OCC");
  console.log(`✓ fetch-contracts --check · ${n} فحصاً`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (argv.includes("--check")) { selfCheck(); process.exit(0); }
  if (!AO.available()) { console.error("✗ fetch-contracts: مفاتيح Alpaca غائبة"); process.exit(1); }
  const now = argOf("now") ? Date.parse(argOf("now")) : Date.now();
  const t0 = Date.now();
  const r = await run({ now });
  if (!r.ok) { console.error("✗ fetch-contracts: " + r.why); process.exit(1); }
  if (r.same) console.log(`= contracts.json: ${r.why || "نفس اللقطة — ثابتة حتى الحدّ التالي"}`);
  else { const d = r.doc;
    console.log(`✓ contracts.json · ${d.phase} · لقطة ${new Date(d.hour * 1000).toISOString()} · ${d.count} فرصة · ${d.universe.n} رمزاً · ${d.stats.requests} طلباً · ${Object.keys(d.skip || {}).length} متخطّى · ${((Date.now() - t0) / 1000).toFixed(1)}ث`); }
  // التتبّع في الجلسة الرسمية وبعدها بنصف ساعة (كي تُقرأ دقائق الإغلاق) — كلَّ تشغيل لا كلَّ لقطة
  const w = SES.sessionWindows(now);
  if (w.regular && now >= w.regular.start && now <= w.regular.end + 45 * MIN) {
    try { const T = await track({ now, picks: r.doc && r.doc.phase === "regular" ? r.doc.picks : [] });
      console.log(`  ✓ تتبّع: ${T.rows.length} مركزاً · مفتوح ${T.rows.filter((x) => x.status === "open").length} · أهدافٌ بُلغت ${T.rows.reduce((a, x) => a + x.hits.length, 0)}`); }
    catch (e) { console.warn(`  ⚠ التتبّع: ${e.message}`); }
  }
}
