#!/usr/bin/env node
/* =====================================================================
   انتقالات الجلسة على بيانات SIP حقيقية — بساعةٍ افتراضية، بلا شبكة.

   يمشي على يومٍ ماضٍ من مخزن SIP من ‎03:45‎ إلى ‎20:45 ET‎ بخطوة خمس
   دقائق، ويبني في كل خطوة ما كان المزوّد سيعيده لحظتها: كلُّ شمعةٍ بدأت
   قبل «الآن» — **والجاريةُ مشوَّهةٌ عمداً** (إغلاقٌ ‎±7%‎ وحجمٌ مضاعف)،
   ومعها يوميةُ اليوم الجارية بعد الافتتاح. ثم يمرّ بمسار الإنتاج نفسه:
   `applyStore` ← ‎4h‎ ← `candleClock` ← `closedBars` ← `analyze` ←
   `overallScore`. ويشترط:

   ١. `tf` رسميةٌ دائماً، ولا شمعة رسمية جديدة في ما قبل الافتتاح ولا بعد
      الإغلاق — و`tfx` تنمو فيهما.
   ٢. المفتاح رتيبٌ على شبكة ‎15د‎، يتقدّم مرّةً لكل شمعة رسمية مغلقة بلا
      قفزٍ ولا تكرار، وأوّلُه في اليوم ‎09:30‎ (عند ‎09:45‎)، ثم المفتاح
      النهائي بعد الإغلاق + ‎20‎ دقيقة.
   ٣. الحقول المؤكَّدة (`score` و`tfScore` لكل فريم) **لا تتغيّر داخل
      المفتاح** رغم تشويه الجارية — ولا تتغيّر بعد ‎20:00‎ بلا بيانات جديدة.

     node scripts/check-session-replay.mjs                 (أيامٌ افتراضية)
     node scripts/check-session-replay.mjs --date=2026-09-29
   ===================================================================== */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readSeries, storeDir } from "./lib/bars-store.mjs";
import { DATA_DIR } from "./lib/snapshot.mjs";
import { analyze, overallScore, aggregate, TFS, closedBars } from "./lib/indicators.mjs";
import { applyStore, candleClock, finalKeyMs, K4H } from "./fetch-market.mjs";

const req = createRequire(import.meta.url);
const SES = req("../stocks/session.js");
const AN_WIN = req("../stocks/indicators.js").AN_WIN;
const args = process.argv.slice(2);
const opt = (k) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
/* INV-17: الفاحص يقرأ من `DATA_DIR` (اللقطة إن مُرّرت، وإلا الحيّ). والمخزن
   لا يُنسخ في اللقطات (`bars` في `SKIP`)، لكن الإعادة تقرأ أياماً **ماضية** مغلقة
   فلا تتأثّر بكتابةٍ جارية على اليوم الحالي. */
const DIR = storeDir(opt("out") ? path.resolve(opt("out")) : DATA_DIR);
const SYMS = (opt("symbols") || "AAPL,NVDA,MRK,SPY,BRK-B").split(",");
/* يومٌ عادي، ونصفا يوم (بعد عيد الشكر وليلة الميلاد) — من داخل مدى المخزن */
const DATES = opt("date") ? [opt("date")] : ["2026-09-29", "2025-11-28", "2025-12-24"];

const BAR = 15 * 60e3;
const et = (t) => new Date(t).toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(11, 16);
const distort = (b) => ({ ...b, c: b.c * 1.07, h: Math.max(b.h, b.c * 1.07), l: Math.min(b.l, b.c * 0.93), v: b.v * 2 });

/* ما كان المزوّد سيعيده لحظة `vnow`: كلُّ شمعةٍ بدأت قبلها، والجاريةُ
   مشوَّهة. يوميةُ اليوم تظهر بعد الافتتاح (قِيس: لا يومية لليوم قبله). */
function asOf(s15, s1d, vnow, day) {
  const m15 = s15.filter(b => b.t <= vnow).map(b => (b.t + BAR > vnow ? distort(b) : b));
  const open = SES.atEtMinutes(Date.parse(day + "T17:00:00Z"), SES.REG_OPEN);
  const d1 = s1d.filter(b => {
    const d = SES.etParts(b.t + 12 * 3600e3).date;
    return d < day || (d === day && vnow >= open);
  }).map(b => (SES.etParts(b.t + 12 * 3600e3).date === day && vnow < SES.sessionCloseAt(open) + 20 * 60e3 ? distort(b) : b));
  return { "15m": m15, "1d": d1 };
}

function confirmed(sb, vnow) {
  const rec = { tf: {} };
  const full1h = applyStore(rec, sb, vnow);
  rec.tf["4h"] = { c: aggregate(full1h, 4, K4H).slice(-260) };
  const cnow = candleClock(rec, vnow);
  const an = {};
  for (const tf of TFS) {
    const kk = closedBars(rec.tf[tf].c, tf, cnow).slice(-AN_WIN);
    const a = kk.length ? analyze(kk) : null;
    if (a) an[tf] = a;
  }
  const kk15 = closedBars(rec.tf["15m"].c, "15m", cnow);
  const key = finalKeyMs(rec, vnow) ?? kk15[kk15.length - 1]?.t;
  return { rec, key, score: +overallScore(an).toFixed(6),
           tfScore: Object.fromEntries(TFS.filter(t => an[t]).map(t => [t, +an[t].score.toFixed(6)])) };
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

for (const day of DATES) {
  const noon = Date.parse(day + "T17:00:00Z");
  if (!SES.isTradingDay(noon)) { console.log(`⚠ ${day} ليس يوم تداول — يُتخطّى`); continue; }
  const open = SES.atEtMinutes(noon, SES.REG_OPEN), close = SES.sessionCloseAt(noon);
  console.log(`\n▶ ${day}${SES.isHalfDay(SES.etParts(noon)) ? " (نصف يوم)" : ""} — ${SYMS.join(" ")}`);
  for (const sym of SYMS) {
    const s15 = readSeries(DIR, sym, "15m")?.bars || [], s1d = readSeries(DIR, sym, "1d")?.bars || [];
    if (!s15.some(b => SES.etParts(b.t).date === day)) { console.log(`  ⚠ ${sym}: لا شموع لهذا اليوم في المخزن`); continue; }
    let prev = null, keys = [], transitions = [];
    for (let vnow = SES.atEtMinutes(noon, 3 * 60 + 45); vnow <= SES.atEtMinutes(noon, 20 * 60 + 45); vnow += 5 * 60e3) {
      const st = SES.sessionOf(vnow);
      const cur = confirmed(asOf(s15, s1d, vnow, day), vnow);
      ok(cur.rec.tf["15m"].c.every(b => SES.isRegularBar(b.t)), `${sym} ${et(vnow)}: شمعةٌ ممتدة في tf`);
      if (prev) {
        const lastReg = (r) => r.rec.tf["15m"].c[r.rec.tf["15m"].c.length - 1]?.t;
        if (st === "PRE" || (st === "CLOSED" && vnow < open))
          ok(lastReg(cur) === lastReg(prev), `${sym} ${et(vnow)}: شمعة رسمية جديدة قبل الافتتاح`);
        if (st === "PRE" && SES.sessionOf(vnow - 5 * 60e3) === "PRE")
          ok(cur.rec.tfx["15m"].c.length >= prev.rec.tfx["15m"].c.length, `${sym} ${et(vnow)}: tfx لم ينمُ`);
        ok(cur.key >= prev.key, `${sym} ${et(vnow)}: المفتاح نزل`);
        if (cur.key === prev.key) {
          ok(cur.score === prev.score && JSON.stringify(cur.tfScore) === JSON.stringify(prev.tfScore),
             `${sym} ${et(vnow)}: المؤكَّد تغيّر داخل المفتاح ${new Date(cur.key).toISOString()} (${prev.score} → ${cur.score})`);
        } else {
          keys.push(cur.key);
          if (SES.sessionOf(prev.key) !== undefined && cur.key <= close && prev.key >= open)
            ok(cur.key - prev.key === BAR, `${sym} ${et(vnow)}: قفزٌ في المفتاح ${et(prev.key)} → ${et(cur.key)}`);
        }
        if (st !== prev.st) transitions.push(`${prev.st}→${st}@${et(vnow)} key=${et(cur.key)}`);
      }
      ok(cur.key % BAR === 0, `${sym} ${et(vnow)}: المفتاح خارج الشبكة`);
      prev = { ...cur, st };
    }
    const dayKeys = keys.filter(k => SES.etParts(k).date === day && k < close);
    const firstRegKey = dayKeys[0];
    ok(firstRegKey === open, `${sym}: أوّل مفتاح في الجلسة ${firstRegKey && et(firstRegKey)} لا 09:30`);
    ok(new Set(keys).size === keys.length, `${sym}: مفتاحٌ مكرّر`);
    const expected = Math.round((close - open) / BAR);
    ok(dayKeys.length === expected, `${sym}: ${dayKeys.length} مفتاحاً في الجلسة من ${expected}`);
    const fin = keys[keys.length - 1];
    ok(new Date(fin).toISOString().endsWith("T23:45:00.000Z"), `${sym}: المفتاح النهائي ${new Date(fin).toISOString()}`);
    console.log(`  ${sym}: ${dayKeys.length}/${expected} مفتاحاً · نهائي ${new Date(fin).toISOString().slice(11, 16)}Z · ${transitions.join(" · ")}`);
  }
}
console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
