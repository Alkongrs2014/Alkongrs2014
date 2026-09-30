#!/usr/bin/env node
/* =====================================================================
   التقييم التاريخي للمحرّك V3 — **للمعلومية فقط** (docs/ENGINE_V3_SPEC.md §8).

   يمشي نفس `advanceSym` التي يمشيها المسار الحيّ على تاريخ مخزن Alpaca SIP
   لكل سهم، فالصفقة المقيسة هي نفسها الصفقة التي كانت ستُعرض. لا يغيّر شيئاً في
   المحرّك ولا في أوزانه — قرار المالك.

   لكل صفقة: R بعد التكلفة وقبلها، بلوغ T1 قبل الوقف، المدّة، ودخولٌ عشوائي مطابق
   (20 شمعة من نفس السهم ±10 جلسات، نفس الجهة ونفس مسافات الوقف والأهداف بوحدة
   ATR اليومي، نفس الإدارة والتكلفة).

   --from=YYYY-MM-DD --to=YYYY-MM-DD   (افتراضياً 2025-01-02 → آخر ما في المخزن)
   --bars=DIR   --out=FILE
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readSeries } from "./lib/bars-store.mjs";
import { prep, advanceSym, evalAt } from "./lib/engine3-run.mjs";

const require = createRequire(import.meta.url);
const E = require("../stocks/engine3.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function rng(seed) {
  let a = parseInt(crypto.createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function bootCI(a, seed) {
  if (a.length < 2) return [null, null];
  const r = rng(seed), ms = [];
  for (let k = 0; k < 2000; k++) { let s = 0; for (let i = 0; i < a.length; i++) s += a[Math.floor(r() * a.length)]; ms.push(s / a.length); }
  ms.sort((x, y) => x - y);
  return [ms[50], ms[1949]];
}

/* يدير صفقةً اصطناعية من الشمعة i بنفس قواعد المحرّك (للأساس العشوائي) */
function simFrom(S, i, d, stopA, tgA, atrD) {
  const e = S.r15[i].c;
  const tr = { d, e, st: e - d * stopA * atrD, tg: tgA.map(x => ({ p: e + d * x * atrD })), atrD,
               risk: stopA * atrD, status: "confirmed" };
  for (let j = i + 1; j < S.r15.length; j++) {
    const b = S.r15[j];
    if (tr.status === "confirmed") E.fillTrade(tr, b); else E.stepTrade(tr, b);
    if (tr.status === "closed" || tr.status === "cancelled") return tr;
  }
  return null;
}

export function run({ from, to, barsDir }) {
  const U = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
  const syms = U.symbols.map(x => x.s).slice(0, U.top || 50);
  const trades = [];
  for (const s of syms) {
    const a = readSeries(barsDir, s, "15m"), b = readSeries(barsDir, s, "1d");
    if (!a || !b) continue;
    const S = prep(a.bars, b.bars);
    const atrAt = new Map();
    const r = advanceSym(s, S, from, to, null, (j, x) => { if (x.st && x.st.atrD) atrAt.set(j, x.st.atrD); });
    const idxOf = new Map(S.r15.map((x, j) => [x.t, j]));
    const days = [...new Set(S.r15.map(x => x.d))];
    for (const t of [...r.closed, ...(r.open ? [r.open] : [])]) {
      const done = t.status === "closed" || t.status === "cancelled";
      const i = idxOf.get(t.t);
      const row = { s, id: t.id, d: t.d, t: t.t, day: S.r15[i].d, base: t.base, evt: t.evt, score: t.score,
        el: t.el, combo: ["day", "ma", "trend", "vwap", "week"].map(k => t.el[k] ? 1 : 0).join(""),
        status: t.status, end: t.end ? t.end.k : null, hit: t.hit || 0, done,
        R: done && t.status === "closed" ? E.tradeR(t, true) : null,
        Rg: done && t.status === "closed" ? E.tradeR(t, false) : null,
        bars: t.fill && t.end ? S.r15.filter(x => x.t >= t.fill.t && x.t <= t.end.t).length : null,
        riskA: t.risk / t.atrD };
      // الأساس العشوائي المطابق
      if (row.R !== null) {
        const di = days.indexOf(row.day), lo = days[Math.max(0, di - 10)], hi = days[Math.min(days.length - 1, di + 10)];
        const pool = [];
        for (let j = 0; j < S.r15.length; j++) { const dd = S.r15[j].d; if (dd >= lo && dd <= hi && j !== i && atrAt.has(j)) pool.push(j); }
        const rnd = rng(row.id), base = [];
        const tgA = t.tg.map(x => (x.p - t.e) * t.d / t.atrD);
        for (let k = 0; k < 20 && pool.length; k++) {
          const j = pool[Math.floor(rnd() * pool.length)];
          const bt = simFrom(S, j, t.d, row.riskA, tgA, atrAt.get(j));
          if (bt && bt.status === "closed") base.push(E.tradeR({ ...bt, risk: row.riskA * atrAt.get(j) }, true));
        }
        row.base = base.length ? mean(base) : null;
        row.baseMed = base.length ? median(base) : null;
      }
      trades.push(row);
    }
    process.stderr.write(".");
  }
  process.stderr.write("\n");
  return trades;
}

function stats(ts, label) {
  const c = ts.filter(t => t.R !== null);
  const R = c.map(t => t.R), pos = R.filter(x => x > 0).reduce((a, x) => a + x, 0), neg = -R.filter(x => x < 0).reduce((a, x) => a + x, 0);
  const wb = c.filter(t => t.base !== null), diff = wb.map(t => t.R - t.base);
  return { label, n: c.length, cancelled: ts.filter(t => t.status === "cancelled").length,
    t1: c.length ? c.filter(t => t.hit >= 1).length / c.length : null,
    stop: c.length ? c.filter(t => t.end === "stop").length / c.length : null,
    meanR: mean(R), medR: median(R), grossR: mean(c.map(t => t.Rg)), pf: neg > 0 ? pos / neg : null,
    bars: median(c.map(t => t.bars).filter(Number.isFinite)),
    base: mean(wb.map(t => t.base)), edge: mean(diff), ci: bootCI(diff, "ci|" + label),
    notBeat: wb.filter(t => t.R <= t.baseMed).length, nBase: wb.length };
}
const f2 = x => x == null ? "—" : x.toFixed(2), pc = x => x == null ? "—" : (x * 100).toFixed(1) + "%";
const line = s => `${s.label.padEnd(28)} n=${String(s.n).padStart(5)} · T1 قبل الوقف ${pc(s.t1)} · وقف ${pc(s.stop)} · R ${f2(s.meanR)} (وسيط ${f2(s.medR)} · قبل التكلفة ${f2(s.grossR)}) · PF ${f2(s.pf)} · مدّة ${s.bars ?? "—"} شمعة · عشوائي ${f2(s.base)} · الفرق ${f2(s.edge)} [${f2(s.ci[0])}, ${f2(s.ci[1])}] · لم يتفوّق ${s.notBeat}/${s.nBase}`;

export function report(trades, meta) {
  const L = [], out = { meta, groups: {} };
  const add = (label, ts) => { const s = stats(ts, label); out.groups[label] = s; L.push("  " + line(s)); };
  L.push(`▶ التقييم التاريخي للمحرّك V3 (معلومية فقط — لا يغيّر المحرّك) · ${meta.from} → ${meta.to} · Alpaca SIP · ${meta.syms} سهماً`);
  L.push(`  R بعد التكلفة (انزلاق 0.05×ATR يومي لكل جهة + 2 نقطة أساس)، والمقام المخاطرة المعلنة. أُلغيت قبل الدخول: ${trades.filter(t => t.status === "cancelled").length}`);
  L.push("١) الكل وحسب الجهة:");
  add("الكل", trades); add("شراء", trades.filter(t => t.d > 0)); add("بيع", trades.filter(t => t.d < 0));
  L.push("٢) حسب الدرجة:");
  const scores = [...new Set(trades.map(t => t.score))].sort((a, b) => b - a);
  for (const sc of scores) add(`${sc}%`, trades.filter(t => t.score === sc));
  L.push("٣) حسب التركيبة (أمس·متوسطات·اتجاه·VWAP·أسبوع):");
  const combos = [...new Set(trades.map(t => t.combo))].sort();
  for (const c of combos) add(`تركيبة ${c}`, trades.filter(t => t.combo === c));
  L.push("٤) الأساس: قمة/قاع أمس مقابل المتوسطات:");
  add("أساس أمس", trades.filter(t => t.base === "day")); add("أساس المتوسطات", trades.filter(t => t.base === "ma"));
  add("أمس ✓ فقط (المتوسطات ✗)", trades.filter(t => t.el.day && !t.el.ma));
  add("المتوسطات ✓ فقط (أمس ✗)", trades.filter(t => t.el.ma && !t.el.day));
  add("الاثنتان ✓", trades.filter(t => t.el.day && t.el.ma));
  L.push("٥) نوع حدث قمة/قاع أمس (أساس أمس):");
  for (const e of ["pdh_break", "pdl_reclaim", "pdl_break", "pdh_loss"]) add(e, trades.filter(t => t.base === "day" && t.evt === e));
  L.push("٦) حسب الفترة (ربع سنة):");
  const q = t => { const y = Math.floor(t.day / 10000), m = Math.floor(t.day / 100) % 100; return `${y}Q${Math.ceil(m / 3)}`; };
  for (const k of [...new Set(trades.map(q))].sort()) add(k, trades.filter(t => q(t) === k));
  L.push("٧) حسب السهم:");
  const bySym = [...new Set(trades.map(t => t.s))].map(s => stats(trades.filter(t => t.s === s), s)).sort((a, b) => (b.meanR ?? -9) - (a.meanR ?? -9));
  out.bySym = bySym;
  for (const s of bySym) L.push("  " + line(s));
  out.text = L;
  out.trades = trades;
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const from = Date.parse((arg("from", "2025-01-02")) + "T00:00:00Z");
  const to = arg("to") ? Date.parse(arg("to") + "T23:59:59Z") : Date.now();
  const barsDir = arg("bars", path.join(ROOT, "data/bars/alpaca_sip"));
  const t0 = Date.now();
  const trades = run({ from, to, barsDir });
  const rep = report(trades, { from: new Date(from).toISOString().slice(0, 10), to: new Date(to).toISOString().slice(0, 10), syms: new Set(trades.map(t => t.s)).size });
  const out = arg("out", path.join(ROOT, "reports", "engine3-validation.json"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(rep));
  console.log(rep.text.join("\n"));
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)}ث · ${out})`);
}
