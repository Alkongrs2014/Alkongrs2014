#!/usr/bin/env node
/* =====================================================================
   مقارنة V3 قبل §4ج وبعده على نفس البيانات التاريخية — قراءةٌ فقط، لا يكتب في data/.

   قديم: لقطةٌ كلَّ 30 دقيقة من الصفر (`evaluateHour`) — «فرصةٌ» = ظهورُ رمزٍ في القائمة.
   جديد: إشارةٌ جديدة على الفريمات الأربعة في (اللقطة السابقة، H] ثم دورة حياة §6
         (`build` نفسه متسلسلاً بحالةٍ في الذاكرة).
   والمقاييس لكلٍّ: عدد الفرص يومياً · تكرار نفس الرمز في اليوم · عمر الإشارة عند النشر ·
   الاختفاء قبل الوقف/الهدف · T1 قبل الوقف · R بعد التكلفة (`tradeR`) · ومقابلها خطّ أساسٍ
   عشوائي: نفس اللقطة ونفس الجهة ونفس قواعد الوقف والأهداف على رمزٍ آخر عشوائي.

   node scripts/audit/compare-v3-frames.mjs --book stocks --days 60 --data D:/…/data
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readSeries } from "../lib/bars-store.mjs";
import { prep, prepCrypto, inputAt, isoWeek, evalSlot, stepOver, prevSlotOf } from "../lib/engine3-run.mjs";
import { build } from "../build-trades.mjs";

const require = createRequire(import.meta.url);
const E = require("../../stocks/engine3.js");
const SES = require("../../stocks/session.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BOOK = arg("book", "stocks"), DAYS = +arg("days", BOOK === "crypto" ? 4 : 60);
const DATA = path.resolve(arg("data", path.join(ROOT, "data")));
const OUTF = arg("out", null);
const wkOf = (d) => isoWeek(d);
const H30 = 1800000, M15 = 900000;

/* ---------------- البيانات ---------------- */
const S = {};
if (BOOK === "crypto") {
  const sum = JSON.parse(fs.readFileSync(path.join(DATA, "crypto/summary.json"), "utf8"));
  for (const r of sum.rows) { try { S[r.s] = prepCrypto(JSON.parse(fs.readFileSync(path.join(DATA, "crypto/sym", r.s + ".json"), "utf8"))); } catch { /* رمزٌ بلا ملف */ } }
} else {
  const U = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
  const bars = path.join(DATA, "bars", "alpaca_sip"), from = Date.now() - (DAYS + 40) * 86400000;
  for (const s of U.symbols.map((x) => x.s).slice(0, U.top || 50)) {
    const a = readSeries(bars, s, "15m"), b = readSeries(bars, s, "1d");
    if (a && b) S[s] = prep(a.bars.filter((x) => x.t >= from), b.bars.filter((x) => x.t >= from - 420 * 86400000));
  }
}
const syms = Object.keys(S).sort();
const lastEnd = Math.min(...syms.map((s) => S[s].r15.length ? S[s].r15[S[s].r15.length - 1].end : Infinity).filter(Number.isFinite));
/* اللقطات في الفترة */
const slots = [];
if (BOOK === "crypto") { for (let H = Math.floor((lastEnd - DAYS * 86400000 - M15) / H30) * H30 + M15; H <= lastEnd; H += H30) slots.push(H); }
else { for (let t = lastEnd - DAYS * 1.45 * 86400000; t <= lastEnd + 86400000; t += 86400000) for (const H of SES.scanSlotsOf(t)) if (H <= lastEnd && !slots.includes(H)) slots.push(H); slots.sort((a, b) => a - b); }
const dayOf = (H) => new Date(H - (BOOK === "crypto" ? 0 : 4 * 3600000)).toISOString().slice(0, 10);
const days = [...new Set(slots.map(dayOf))];
const keepDays = new Set(days.slice(-DAYS));
const useSlots = slots.filter((H) => keepDays.has(dayOf(H)));
console.error(`${BOOK}: ${syms.length} رمزاً · ${useSlots.length} لقطة · ${keepDays.size} يوماً · حتى ${new Date(lastEnd).toISOString()}`);

/* ---------------- محاكاة صفقة من إشارة حتى نهايتها (بحدٍّ أقصى نهاية البيانات) ---------------- */
function simulate(s, sig, H) {
  const tr = { d: sig.d, e: sig.e, st: sig.st, tg: sig.tg, atrD: sig.atrD, risk: sig.risk, status: "confirmed" };
  stepOver(tr, S[s], H, lastEnd);
  return tr;
}
function outcome(tr) {
  const done = tr.status === "closed" || tr.status === "cancelled";
  return { done, k: tr.end ? tr.end.k : null, t1: (tr.hit || 0) >= 1, stopFirst: tr.end && tr.end.k === "stop",
           R: done && tr.fill ? E.tradeR(tr, true) : null, endT: tr.end ? tr.end.t : null };
}
/* خطّ الأساس العشوائي: نفس اللقطة والجهة وقواعد الوقف/الأهداف على رمزٍ آخر (بذرةٌ ثابتة) */
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function randomTwin(s0, d, H) {
  for (let k = 0; k < 20; k++) {
    const s = syms[Math.floor(rnd() * syms.length)];
    if (s === s0) continue;
    const S1 = S[s], i = S1.r15.findLastIndex((b) => b.end <= H);
    if (i < 0 || S1.r15[i].end !== H) continue;
    const inp = inputAt(S1, i), st = E.stateAt(inp, wkOf);
    if (!st || !(st.atrD > 0 && st.atr15 > 0)) continue;
    const stop = E.stopOf(st.px, d, inp.h1, st.atr15);
    if (!stop) continue;
    const risk = (st.px - stop.p) * d;
    if (!(risk > 0) || risk > E.E3.MAX_RISK_ATR * st.atrD) continue;
    const tg = E.targetsOf(st.px, d, risk, st, inp.h1);
    return outcome(simulate(s, { d, e: st.px, st: stop.p, tg, atrD: st.atrD, risk }, H));
  }
  return null;
}
function summarize(list) {
  const done = list.filter((x) => x && x.done && x.R !== null);
  const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const R = done.map((x) => x.R);
  return { n: list.length, closed: done.length,
    t1BeforeStop: done.length ? +(done.filter((x) => x.t1).length / done.length * 100).toFixed(1) : null,
    stopPct: done.length ? +(done.filter((x) => x.stopFirst).length / done.length * 100).toFixed(1) : null,
    avgR: R.length ? +(R.reduce((a, b) => a + b, 0) / R.length).toFixed(3) : null,
    medR: R.length ? +med(R).toFixed(3) : null,
    winPct: R.length ? +(R.filter((x) => x > 0).length / R.length * 100).toFixed(1) : null };
}

/* ---------------- قديم: لقطةٌ من الصفر ---------------- */
const old = { opps: [], perDay: {}, appear: 0, repeatSameDay: 0, vanishEarly: 0, ages: [] };
{
  let prevSet = new Map(); const seenDay = new Map();
  for (const H of useSlots) {
    const cur = new Map();
    for (const s of syms) {
      const S1 = S[s], i = S1.r15.findLastIndex((b) => b.end <= H);
      if (i < 0 || S1.r15[i].t !== H - M15) continue;                       // INV-67 كما في الحيّ
      const r = E.evaluateHour(inputAt(S1, i), wkOf);
      if (r.reject) continue;
      cur.set(s, r.sig);
      if (!prevSet.has(s)) {                                                 // ظهورٌ جديد في القائمة
        old.appear++;
        const k = s + "|" + dayOf(H);
        if (seenDay.has(k)) old.repeatSameDay++; else seenDay.set(k, 1);
        old.perDay[dayOf(H)] = (old.perDay[dayOf(H)] || 0) + 1;
        const age = r.sig.base === "day" && r.st.day ? H - r.st.day.end : null;
        if (age !== null) old.ages.push(age / 60000);
        const tr = simulate(s, r.sig, H);
        old.opps.push({ s, H, d: r.sig.d, ...outcome(tr), twin: randomTwin(s, r.sig.d, H), sc: r.sig.score });
      }
    }
    for (const [s] of prevSet) if (!cur.has(s)) {                            // اختفى — هل قبل نهايته؟
      const o = [...old.opps].reverse().find((x) => x.s === s);
      if (o && (!o.endT || o.endT > H)) old.vanishEarly++;
    }
    prevSet = cur;
  }
}

/* ---------------- جديد: إشارةٌ جديدة + دورة حياة (build نفسه) ---------------- */
const neu = { opps: [], perDay: {}, appear: 0, repeatSameDay: 0, vanishEarly: 0, ages: [], baseTf: {}, base: {} };
{
  let state = null; const seenDay = new Map(), byId = new Map();
  for (const H of useSlots) {
    const r = build({ now: H + 60000, book: BOOK, out: "/nonexistent", S, state });
    if (!r.ok) { console.error("✗", new Date(H).toISOString(), r.why); continue; }
    state = r.state;
    for (const t of r.doc.open) {
      neu.appear++;
      const k = t.s + "|" + dayOf(H);
      if (seenDay.has(k)) neu.repeatSameDay++; else seenDay.set(k, 1);
      neu.perDay[dayOf(H)] = (neu.perDay[dayOf(H)] || 0) + 1;
      neu.ages.push((H - t.evAt * 1000) / 60000);
      neu.baseTf[t.baseTf] = (neu.baseTf[t.baseTf] || 0) + 1;
      neu.base[t.base] = (neu.base[t.base] || 0) + 1;
      byId.set(t.id, { s: t.s, H, d: t.d, sc: t.score, twin: randomTwin(t.s, t.d, H) });
    }
  }
  // النتائج من محاكاةٍ مستقلّة حتى نهاية البيانات (الحالة تحمل المنتهية 48 ساعة فقط)
  for (const [id, o] of byId) {
    const H = o.H, S1 = S[o.s], i = S1.r15.findLastIndex((b) => b.end <= H);
    const rr = evalSlot(S1, H, prevSlotOf(BOOK, H)).r;
    if (rr.reject) continue;
    neu.opps.push({ ...o, ...outcome(simulate(o.s, rr.sig, H)) });
  }
}

const twinsOf = (L) => L.map((x) => x.twin).filter(Boolean);
const perDayAvg = (m) => { const v = Object.values(m); return v.length ? +(v.reduce((a, b) => a + b, 0) / keepDays.size).toFixed(1) : 0; };
const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return +b[Math.floor(b.length / 2)].toFixed(0); };
const rep = {
  book: BOOK, days: keepDays.size, slots: useSlots.length, symbols: syms.length, to: new Date(lastEnd).toISOString(),
  old: { oppsPerDay: perDayAvg(old.perDay), appearances: old.appear, repeatSameDay: old.repeatSameDay, vanishBeforeEnd: old.vanishEarly,
         medEventAgeMin_dayBase: med(old.ages), result: summarize(old.opps), randomBaseline: summarize(twinsOf(old.opps)) },
  new: { oppsPerDay: perDayAvg(neu.perDay), appearances: neu.appear, repeatSameDay: neu.repeatSameDay, vanishBeforeEnd: 0,
         medEventAgeMin: med(neu.ages), byBase: neu.base, byBaseTf: neu.baseTf,
         result: summarize(neu.opps), randomBaseline: summarize(twinsOf(neu.opps)) }
};
const txt = JSON.stringify(rep, null, 2);
if (OUTF) fs.writeFileSync(OUTF, txt);
console.log(txt);
