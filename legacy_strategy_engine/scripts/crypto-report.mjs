#!/usr/bin/env node
/* =====================================================================
   تقرير اختبار الكريبتو — من السجلّات لا من الذاكرة. بلا شبكة.

   المصادر (كلُّها محلّية):
     · `.monitor/live.jsonl`   ما نُشر فعلاً كل خمس دقائق + فحص الصفحة
     · `opp-history.json`      الفرص المعروضة التي انتهت (أهداف · وقف · سبب)
     · `opportunities.json`    المفتوحة الآن (دورة الحياة)
     · `.monitor/snaps/*.json` قائمة كل شمعة كما نُشرت — للعائد اللاحق
     · `sym/*.json`            شموع ‎15د‎ المغلقة للعائد اللاحق والمتحرّكين

   الأسئلة كما طرحها المالك، كلٌّ برقم:
     ١ الثبات داخل الشمعة       ٥ هل الأعلى أفضل من البقية
     ٢ قبل الحركة أم بعدها       ٦ هل توافق البيتكوين يحسّن الاختيار
     ٣ كم بلغ T1/T2/T3           ٧ متحرّكون أقوياء لم تلتقطهم القائمة
     ٤ كم فشل                    ٨ أثر الكريبتو على الأسهم
   يُشغَّل:  node scripts/crypto-report.mjs [--since=ISO] [--json]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = path.join(ROOT, "data", "crypto");
const rdj = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const arg = (k) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : null; };
const SINCE = arg("since") ? Date.parse(arg("since")) : 0;
const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); if (!v.length) return null;
  const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const avg = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const pct = (x, d = 2) => x == null ? "—" : (x > 0 ? "+" : "") + x.toFixed(d) + "%";
const iso = (s) => new Date(s * 1000).toISOString().slice(5, 16).replace("T", " ");

/* ---------- الشموع: ‎15د‎ المغلقة لكل عملة ---------- */
const barsCache = {};
function bars(s) {
  if (s in barsCache) return barsCache[s];
  const r = rdj(path.join(C, "sym", s + ".json"));
  const c = (r && r.tf && r.tf["15m"] && r.tf["15m"].c) || [];
  return (barsCache[s] = c.map(a => ({ t: a[0], h: a[2], l: a[3], c: a[4] })));
}
/* العائد في جهة الفرصة بعد `hours` من لحظة `t` (ثوانٍ) — من أوّل إغلاقٍ
   بعدها. `null` إن لم تكتمل النافذة بعد. */
function fwd(s, t, hours, d = 1) {
  const b = bars(s);
  const i = b.findIndex(x => x.t >= t);
  if (i < 0) return null;
  const j = b.findIndex(x => x.t >= t + hours * 3600);
  if (j < 0) return null;
  return (b[j].c / b[i].c - 1) * 100 * d;
}
/* الحركة **قبل** الظهور بساعة — في جهة الفرصة */
function pre(s, t, hours, d = 1) {
  const b = bars(s);
  const i = b.findIndex(x => x.t >= t);
  const j = b.findIndex(x => x.t >= t - hours * 3600);
  if (i < 0 || j < 0 || j >= i) return null;
  return (b[i].c / b[j].c - 1) * 100 * d;
}

function main() {
  const out = {};
  const live = (fs.existsSync(path.join(C, ".monitor", "live.jsonl"))
    ? fs.readFileSync(path.join(C, ".monitor", "live.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l)) : [])
    .filter(e => e.t >= SINCE);

  /* ١ + ٨ — الثبات والعزل من المراقبة على المنشور */
  const withC = live.filter(e => e.c);
  const keys = new Set(withC.map(e => e.c.k));
  const dom = live.filter(e => e.dom && e.dom.c);
  out.stability = {
    samples: live.length, errors: live.filter(e => e.err).length,
    cryptoCandles: keys.size, intraCandleChanges: live.filter(e => e.cv === 1).length,
    backwards: live.filter(e => e.cv === 2).length,
    localMatch: live.filter(e => e.lm === 1).length, localMismatch: live.filter(e => e.lm === 0).length,
    domChecks: dom.length, domMismatch: live.filter(e => e.dv).length,
    stocksHashes: [...new Set(live.filter(e => e.s).map(e => e.s.h))],
    stocksIntraChanges: live.filter(e => e.sv).length,
    stocksKeyMoves: live.filter(e => e.sk).map(e => e.sk),
    from: live.length ? new Date(live[0].t).toISOString() : null,
    to: live.length ? new Date(live[live.length - 1].t).toISOString() : null
  };

  /* ٣ + ٤ — نتائج الفرص المعروضة (منتهية + مفتوحة) */
  const H = (rdj(path.join(C, "opp-history.json"), {}).rows || []).filter(h => h.shown * 1000 >= SINCE);
  const O = rdj(path.join(C, "opportunities.json"), {});
  const openShown = Object.entries(O.life || {}).filter(([, L]) => L.shown && !L.logged && L.shown * 1000 >= SINCE)
    .map(([k, L]) => { const [s, scan, d] = k.split("|"); return { s, scan, d: +d, ...L, open: 1 }; });
  const all = [...H, ...openShown];
  const withT = (n) => all.filter(x => (x.t || []).length >= n);
  const ex = (x) => { const d = x.d, p0 = x.px0; if (!(p0 > 0)) return {};
    return { mfe: x.mfe != null ? (x.mfe / p0 - 1) * 100 * d : null, mae: x.mae != null ? (x.mae / p0 - 1) * 100 * d : null }; };
  out.outcomes = {
    shown: all.length, ended: H.length, open: openShown.length,
    entered: all.filter(x => x.in).length,
    t1: all.filter(x => x.hit >= 1).length, t2: all.filter(x => x.hit >= 2).length, t3: all.filter(x => x.hit >= 3).length,
    t2Den: withT(2).length, t3Den: withT(3).length,
    stop: all.filter(x => x.end && x.end.k === "stop").length,
    stopAfterT1: all.filter(x => x.end && x.end.k === "stop" && x.hit >= 1).length,
    gone: all.filter(x => x.end && x.end.k === "gone").length,
    old: all.filter(x => x.end && x.end.k === "old").length,
    medMfe: med(all.map(x => ex(x).mfe)), medMae: med(all.map(x => ex(x).mae)),
    byScan: Object.fromEntries([...new Set(all.map(x => x.scan))].map(sc => {
      const g = all.filter(x => x.scan === sc);
      return [sc, { n: g.length, t1: g.filter(x => x.hit >= 1).length, stop: g.filter(x => x.end && x.end.k === "stop").length }];
    }))
  };

  /* ٢ — قبل الحركة أم بعدها: الحركة في جهة الفرصة خلال الساعة السابقة
     للظهور، مقابل أقصى ما تحرّك بعده (MFE). */
  const timing = all.map(x => ({ pre1: pre(x.s, x.shown, 1, x.d), pre4: pre(x.s, x.shown, 4, x.d), mfe: ex(x).mfe }))
    .filter(x => x.pre1 != null && x.mfe != null);
  out.timing = { n: timing.length, medPre1h: med(timing.map(x => x.pre1)), medPre4h: med(timing.map(x => x.pre4)),
                 medAfterMfe: med(timing.map(x => x.mfe)),
                 earlyShare: timing.length ? timing.filter(x => x.mfe > x.pre1).length / timing.length : null };

  /* ٥ — هل الأعلى أفضل؟ لكل شمعةٍ منشورة: العائد بعد ‎1h/4h‎ في جهة
     الفرصة لأعلى خمسة في «الأقوى الآن» مقابل بقيّتها مقابل الكون (شراء). */
  const sd = path.join(C, ".monitor", "snaps");
  const snaps = fs.existsSync(sd) ? fs.readdirSync(sd).sort().map(f => rdj(path.join(sd, f))).filter(s => s && s.k * 1000 >= SINCE) : [];
  const U = (rdj(path.join(C, "universe.json"), {}).rows || []).map(r => r.s);
  const R = { top5: { 1: [], 4: [] }, rest: { 1: [], 4: [] }, uni: { 1: [], 4: [] }, aligned: { 1: [], 4: [] }, counter: { 1: [], 4: [] } };
  // كلّ شمعةٍ ثالثة: عيّنةٌ كل ربع ساعة تكفي وتقلّل ترابط العيّنات المتجاورة
  for (const s of snaps.filter((_, i) => i % 3 === 0)) {
    const t0 = s.k + 300;
    for (const h of [1, 4]) {
      (s.best || []).forEach((r, i) => {
        const v = fwd(r.s, t0, h, r.sd);
        if (v == null) return;
        (i < 5 ? R.top5 : R.rest)[h].push(v);
        if (r.ba >= 0.15) R.aligned[h].push(v); else if (r.ba <= -0.15) R.counter[h].push(v);
      });
      const u = U.map(x => fwd(x, t0, h, 1)).filter(Number.isFinite);
      if (u.length) R.uni[h].push(avg(u));
    }
  }
  const summ = (a) => ({ n: a.length, avg: avg(a), med: med(a), win: a.length ? a.filter(x => x > 0).length / a.length : null });
  out.ranking = Object.fromEntries(Object.entries(R).map(([k, v]) => [k, { h1: summ(v[1]), h4: summ(v[4]) }]));
  out.snapshots = snaps.length;
  /* الارتعاش: فرصةٌ (عملة|إعداد|جهة) غابت عن قائمتها ثم عادت خلال ساعة —
     المشكلة التي بلّغ عنها المالك بـPUMP. وكذلك في «الأقوى الآن». */
  const flick = (get) => {
    const pres = new Map();
    snaps.forEach((s, i) => { for (const key of get(s)) { if (!pres.has(key)) pres.set(key, []); pres.get(key).push(i); } });
    let gaps = 0, back = 0;
    for (const idx of pres.values()) for (let j = 1; j < idx.length; j++) {
      const g = idx[j] - idx[j - 1] - 1; if (g > 0) { gaps++; if (g <= 12) back++; }
    }
    return { keys: pres.size, gaps, backWithin1h: back };
  };
  out.flicker = {
    lists: flick(s => Object.entries(s.scans || {}).flatMap(([id, rows]) => rows.map(r => `${r.s}|${id}|${r.sd}`))),
    best: flick(s => (s.best || []).map(r => `${r.s}|${r.sd}`))
  };

  /* ٦ — توافق البيتكوين على الفرص المعروضة نفسها */
  const grp = (f) => { const g = all.filter(f); return { n: g.length, t1: g.filter(x => x.hit >= 1).length,
    stop: g.filter(x => x.end && x.end.k === "stop").length, medMfe: med(g.map(x => ex(x).mfe)), medMae: med(g.map(x => ex(x).mae)) }; };
  out.btc = { aligned: grp(x => x.ba0 >= 0.15), neutral: grp(x => x.ba0 > -0.15 && x.ba0 < 0.15), counter: grp(x => x.ba0 <= -0.15) };

  /* ٧ — متحرّكون أقوياء: أكبر حركة ‎4‎ ساعات لكل عملة في النافذة. التُقط
     إن ظهرت في أيّ قائمةٍ منشورة **في جهة الحركة** قبل ذروتها. */
  const t0 = snaps.length ? snaps[0].k : 0, t1 = snaps.length ? snaps[snaps.length - 1].k : 0;
  const shownAt = {};
  for (const s of snaps) for (const rows of Object.values(s.scans || {})) for (const r of rows)
    (shownAt[r.s] ||= []).push({ t: s.k, d: r.sd });
  const movers = [];
  for (const s of U) {
    const b = bars(s).filter(x => x.t >= t0 && x.t <= t1 + 4 * 3600);
    let best = null;
    for (let i = 0; i < b.length; i++) {
      const j = b.findIndex((x, k) => k > i && x.t >= b[i].t + 4 * 3600);
      if (j < 0) break;
      const m = (b[j].c / b[i].c - 1) * 100;
      if (!best || Math.abs(m) > Math.abs(best.m)) best = { m, from: b[i].t, to: b[j].t };
    }
    if (best) movers.push({ s, ...best });
  }
  movers.sort((a, b) => Math.abs(b.m) - Math.abs(a.m));
  out.movers = movers.slice(0, 20).map(m => {
    const d = m.m > 0 ? 1 : -1;
    const hits = (shownAt[m.s] || []).filter(x => x.d === d && x.t <= m.to);
    const early = hits.filter(x => x.t <= m.from + 3600);
    return { s: m.s, move: +m.m.toFixed(2), from: iso(m.from), caught: hits.length ? 1 : 0, early: early.length ? 1 : 0,
             firstShown: hits.length ? iso(hits[0].t) : null };
  });
  return out;
}

const o = main();
if (process.argv.includes("--json")) { console.log(JSON.stringify(o, null, 1)); process.exit(0); }
const S = o.stability, X = o.outcomes, T = o.timing, B = o.btc;
console.log(`\n▶ تقرير اختبار الكريبتو · ${S.from || "—"} → ${S.to || "—"}\n`);
console.log(`١ الثبات: ${S.samples} عيّنة منشورة · ${S.cryptoCandles} شمعة · تغيّرٌ داخل الشمعة ${S.intraCandleChanges} · رجوع ${S.backwards} · صفحة ${S.domChecks} فحصاً (${S.domMismatch} مخالفة) · أخطاء ${S.errors}`);
console.log(`   الارتعاش: القوائم ${o.flicker.lists.gaps} غياباً (عاد خلال ساعة ${o.flicker.lists.backWithin1h}) من ${o.flicker.lists.keys} فرصة · «الأقوى الآن» ${o.flicker.best.gaps} (عاد ${o.flicker.best.backWithin1h})`);
console.log(`٨ الأسهم: بصمات ${S.stocksHashes.join("، ")} · تغيّرٌ داخل شمعتها ${S.stocksIntraChanges} · تقدّمُ مفتاحها ${S.stocksKeyMoves.length}`);
console.log(`٣/٤ الفرص المعروضة ${X.shown} (منتهية ${X.ended} · مفتوحة ${X.open}) · دخلت ${X.entered} · T1 ${X.t1} · T2 ${X.t2}/${X.t2Den} · T3 ${X.t3}/${X.t3Den} · وقف ${X.stop} (بعد T1: ${X.stopAfterT1}) · زال السبب ${X.gone} · قديمة ${X.old}`);
console.log(`   وسيط أقصى ربح ${pct(X.medMfe)} · وسيط أقصى تراجع ${pct(X.medMae)} · حسب الإعداد ${JSON.stringify(X.byScan)}`);
console.log(`٢ التوقيت (${T.n}): حركةٌ قبل الظهور ساعة ${pct(T.medPre1h)} · ‎4س ${pct(T.medPre4h)} · بعده (أقصى) ${pct(T.medAfterMfe)} · حصّة «قبل الحركة» ${T.earlyShare == null ? "—" : Math.round(T.earlyShare * 100) + "%"}`);
for (const [k, v] of Object.entries(o.ranking))
  console.log(`٥ ${k.padEnd(8)} ساعة: ${pct(v.h1.avg)} (وسيط ${pct(v.h1.med)} · رابحة ${v.h1.win == null ? "—" : Math.round(v.h1.win * 100) + "%"} · ن=${v.h1.n}) · ‎4س: ${pct(v.h4.avg)} (رابحة ${v.h4.win == null ? "—" : Math.round(v.h4.win * 100) + "%"} · ن=${v.h4.n})`);
for (const [k, v] of Object.entries(B)) console.log(`٦ ${k.padEnd(8)} ن=${v.n} · T1 ${v.t1} · وقف ${v.stop} · أقصى ربح ${pct(v.medMfe)} · أقصى تراجع ${pct(v.medMae)}`);
console.log(`٧ أكبر المتحرّكين (‎4س):`);
for (const m of o.movers) console.log(`   ${m.s.padEnd(14)} ${pct(m.move)} من ${m.from} · ${m.caught ? (m.early ? "التُقطت مبكراً" : "التُقطت") + " " + m.firstShown : "لم تظهر"}`);
