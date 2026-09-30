#!/usr/bin/env node
/* =====================================================================
   التحقّق التاريخي للمحرّك V2 — docs/ENGINE_V2_SPEC.md §7.

   يخطو على كل إغلاق شمعة 15د رسمية لـ SPY، ولكل رمزٍ أُغلقت شمعتُه عند T
   يستدعي `evaluateAt` نفسها التي يستدعيها المسار الحيّ، بمدخلاتٍ من
   `engine2-input.mjs` نفسه. ثم يدير الصفقة بـ`openTrade/stepTrade` نفسها.

   --period=is|oos   الفترة (لا يُحسب خارج العيّنة إلا بطلبه صراحةً)
   --bars=DIR        مخزن alpaca_sip (افتراضياً data/bars/alpaca_sip)
   --out=FILE        JSON كامل (افتراضياً reports/engine2-<period>.json)
   --check           فحصٌ ذاتي بلا بيانات
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readSeries } from "./lib/bars-store.mjs";
import { prep, idxAt, inputAt } from "./lib/engine2-input.mjs";

const require = createRequire(import.meta.url);
const E = require("../stocks/engine2.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };

export const PERIODS = {
  is:  { from: "2025-01-02", to: "2026-02-27" },
  oos: { from: "2026-03-02", to: "2026-09-29" }
};
const BASE_N = 20, BASE_SESS = 10, BOOT = 2000;

/* مولّدٌ حتمي (mulberry32) وبذرةٌ من نصّ */
export function rng(seedStr) {
  let a = parseInt(crypto.createHash("sha256").update(seedStr).digest("hex").slice(0, 8), 16) >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function bootCI(a, seed = "boot") {
  if (a.length < 2) return [null, null];
  const r = rng(seed), ms = [];
  for (let k = 0; k < BOOT; k++) { let s = 0; for (let i = 0; i < a.length; i++) s += a[Math.floor(r() * a.length)]; ms.push(s / a.length); }
  ms.sort((x, y) => x - y);
  return [ms[Math.floor(0.025 * BOOT)], ms[Math.floor(0.975 * BOOT) - 1]];
}

/* يدير صفقةً من إشارةٍ عند الفهرس i15 (شمعة التأكيد) على سلسلة الرمز */
function simulate(S, i15, sig) {
  let tr = null;
  for (let j = i15 + 1; j < S.r15.length; j++) {
    const b = S.r15[j];
    tr = tr ? E.stepTrade(tr, b) : E.openTrade(sig, b);
    if (tr.end) return tr;
  }
  return tr;                                         // لم ينتهِ ضمن البيانات
}

function run({ period, barsDir }) {
  const P = PERIODS[period];
  const from = Date.parse(P.from + "T00:00:00Z"), to = Date.parse(P.to + "T23:59:59Z");
  const U = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
  const syms = [...U.symbols.map(x => typeof x === "string" ? x : x.s).slice(0, U.top || 50), "SPY"];
  const S = {};
  for (const s of syms) {
    const a = readSeries(barsDir, s, "15m"), b = readSeries(barsDir, s, "1d");
    if (!a || !b) { console.warn(`  ⚠ ${s}: لا بيانات في المخزن`); continue; }
    S[s] = prep(a.bars, b.bars);
  }
  const M = S.SPY;
  const steps = M.r15.filter(b => b.end > from && b.end <= to).map(b => b.end);
  const trades = [], rej = {}, gateAt = {}, atrAt = {}, busyTo = {};
  for (const s of Object.keys(S)) { gateAt[s] = new Map(); atrAt[s] = new Map(); busyTo[s] = -Infinity; }

  for (const T of steps) {
    for (const s of Object.keys(S)) {
      const X = S[s];
      const ix = idxAt(X, T);
      if (!ix || X.r15[ix.i15].end !== T) continue;       // الرمز لم تُغلق شمعتُه الآن
      const inp = inputAt(X, M, T);
      const r = E.evaluateAt(inp);
      if (r.gate) gateAt[s].set(ix.i15, r.gate.d);
      if (r.signal) atrAt[s].set(ix.i15, r.signal.atrD);
      rej[r.reject || "ok"] = (rej[r.reject || "ok"] || 0) + 1;
      if (!r.signal || !r.signal.ok) continue;
      if (T <= busyTo[s]) { rej.busy = (rej.busy || 0) + 1; continue; }   // صفقةٌ قائمة للرمز
      const tr = simulate(X, ix.i15, r.signal);
      const key = `${s}|${T}`;
      busyTo[s] = tr && tr.end ? tr.end.t + 15 * 60000 - 1 : Infinity;
      const mi = idxAt(M, T), md1 = M.d1.slice(Math.max(0, mi.iD + 1 - 259), mi.iD + 1);
      const spyVol = md1.length ? E.e2atr(md1, 14) / md1[md1.length - 1].c : null;
      trades.push({ key, s, i15: ix.i15, T, day: ix.day, sig: r.signal, tr, spyVol,
                    R: tr && tr.end ? E.tradeR(tr) : null });
    }
  }

  /* ATR اليومي لأيّ شمعة: من أوّل تقييمٍ لذلك اليوم (يلزم للأساس) */
  const atrDay = (s, i) => {
    const X = S[s], day = X.r15[i].d;
    const ix = idxAt(X, X.r15[i].end);
    const d1 = X.d1.slice(Math.max(0, ix.iD + 1 - 259), ix.iD + 1);
    return E.e2atr(d1, 14);
  };

  /* خطّ الأساس المطابق */
  for (const t of trades) {
    if (t.R === null) continue;
    const X = S[t.s], sig = t.sig;
    const days = [...new Set(X.r15.map(b => b.d))];
    const di = days.indexOf(t.day);
    const lo = days[Math.max(0, di - BASE_SESS)], hi = days[Math.min(days.length - 1, di + BASE_SESS)];
    const pool = [];
    for (const [i, g] of gateAt[t.s]) {
      if (g !== sig.d || i === t.i15) continue;
      const d = X.r15[i].d;
      if (d >= lo && d <= hi) pool.push(i);
    }
    pool.sort((a, b) => a - b);
    const R = [], rnd = rng(t.key);
    const stopA = sig.risk / sig.atrD, tgA = sig.tg.map(p => (p - sig.e) * sig.d / sig.atrD);
    for (let k = 0; k < BASE_N && pool.length; k++) {
      const i = pool[Math.floor(rnd() * pool.length)];
      const a = atrAt[t.s].get(i) || atrDay(t.s, i);
      if (!(a > 0)) continue;
      const e = X.r15[i].c;
      const rs = { d: sig.d, e, st: e - sig.d * stopA * a, tg: tgA.map(x => e + sig.d * x * a), atrD: a };
      const tr = simulate(X, i, rs);
      if (tr && tr.end) R.push(E.tradeR(tr));
    }
    t.base = R;
  }
  return { steps: steps.length, syms: Object.keys(S).length, rej, trades };
}

/* ---------------- التقرير ---------------- */
function stats(ts, label) {
  const done = ts.filter(t => t.R !== null);
  const R = done.map(t => t.R);
  const t1 = done.filter(t => t.tr.hit >= 1).length;
  const stp = done.filter(t => t.tr.end.k === "stop").length;
  const exp = done.filter(t => t.tr.end.k === "exp").length;
  const pos = R.filter(x => x > 0).reduce((s, x) => s + x, 0), neg = -R.filter(x => x < 0).reduce((s, x) => s + x, 0);
  const withB = done.filter(t => t.base && t.base.length);
  const diff = withB.map(t => t.R - mean(t.base));
  const notBeat = withB.filter(t => t.R <= median(t.base)).length;
  const ci = bootCI(diff, "ci|" + label);
  return { label, n: done.length, open: ts.length - done.length,
    t1BeforeStop: done.length ? t1 / done.length : null, stopRate: done.length ? stp / done.length : null,
    expRate: done.length ? exp / done.length : null,
    meanR: mean(R), medR: median(R), pf: neg > 0 ? pos / neg : null,
    baseMeanR: mean(withB.map(t => mean(t.base))), edge: mean(diff), ci,
    notBeat, nBase: withB.length };
}
const f2 = x => x === null || x === undefined ? "—" : (Math.round(x * 100) / 100).toFixed(2);
const pc = x => x === null || x === undefined ? "—" : (x * 100).toFixed(1) + "%";
function line(s) {
  return `${s.label.padEnd(26)} n=${String(s.n).padStart(4)} · T1 قبل الوقف ${pc(s.t1BeforeStop)} · وقف ${pc(s.stopRate)} · انقضاء ${pc(s.expRate)}` +
    ` · R متوسط ${f2(s.meanR)} وسيط ${f2(s.medR)} · PF ${f2(s.pf)} · الأساس ${f2(s.baseMeanR)}` +
    ` · الفرق ${f2(s.edge)} [${f2(s.ci[0])}, ${f2(s.ci[1])}] · لم يتفوّق ${s.notBeat}/${s.nBase}`;
}

export function report(res, period, specHash) {
  const all = res.trades, show = all.filter(t => t.sig.show);
  const L = [];
  const out = { period, spec: specHash, steps: res.steps, syms: res.syms, rej: res.rej, groups: {} };
  const add = (k, ts) => { const s = stats(ts, k); out.groups[k] = s; L.push("  " + line(s)); return s; };
  L.push(`▶ المحرّك V2 — التحقّق التاريخي · الفترة ${period} (${PERIODS[period].from} → ${PERIODS[period].to}) · بصمة المواصفة ${specHash}`);
  L.push(`  ${res.syms} رمزاً · ${res.steps} خطوة · أسباب عدم الإشارة: ${JSON.stringify(res.rej)}`);
  L.push("١) الصفقات المعروضة (العدد ≥ 3):");
  add("الكل (≥3)", show);
  add("شراء (≥3)", show.filter(t => t.sig.d > 0));
  add("بيع (≥3)", show.filter(t => t.sig.d < 0));
  L.push("٢) حسب العدد:");
  for (const c of [5, 4, 3, 2]) for (const d of [1, -1])
    add(`${c}/5 ${d > 0 ? "شراء" : "بيع"}${c === 2 ? " (ضابطة)" : ""}`, all.filter(t => t.sig.count === c && t.sig.d === d));
  L.push("٣) تفكيك العناصر (كل الصفقات المحاكاة ≥2، به مقابل بدونه):");
  for (const k of ["ma", "day", "vwap", "week"]) {
    add(`${k}=1`, all.filter(t => t.sig.el[k] === 1));
    add(`${k}=0`, all.filter(t => t.sig.el[k] === 0));
  }
  add("تجمّع مستويات=1", all.filter(t => t.sig.cluster === 1));
  add("تجمّع مستويات=0", all.filter(t => t.sig.cluster === 0));
  L.push("٤) حسب تقلّب السوق (ATR/السعر لـ SPY مقابل وسيط الفترة):");
  const vm = median(show.map(t => t.spyVol).filter(Number.isFinite));
  if (vm !== null) {
    add("تقلّب SPY مرتفع", show.filter(t => t.spyVol > vm));
    add("تقلّب SPY منخفض", show.filter(t => t.spyVol <= vm));
  }
  L.push("٥) الترتيب (أيامٌ فيها ≥ 2 صفقة معروضة):");
  const byDay = {};
  for (const t of show) (byDay[t.day] ||= []).push(t);
  const rankR = {};
  const first = [], rest = [];
  for (const ts of Object.values(byDay)) {
    if (ts.length < 2) continue;
    ts.map(t => ({ ...t.sig, s: t.s, _t: t })).sort(E.rankCmp).forEach((x, i) => {
      const t = x._t; if (t.R === null) return;
      (rankR[Math.min(i + 1, 10)] ||= []).push(t.R);
      (i === 0 ? first : rest).push(t);
    });
  }
  add("الأوّل في يومه", first);
  add("البقية", rest);
  out.rankCurve = Object.fromEntries(Object.entries(rankR).map(([k, v]) => [k, { n: v.length, meanR: mean(v) }]));
  L.push("  منحنى الرتبة: " + Object.entries(out.rankCurve).map(([k, v]) => `#${k} ${f2(v.meanR)} (n=${v.n})`).join(" · "));
  L.push("٦) معيار القبول (§7): n ≥ 100 و متوسط R > 0 و الحدّ الأدنى للفرق > 0 — لكل جهة:");
  for (const k of ["شراء (≥3)", "بيع (≥3)"]) {
    const g = out.groups[k];
    const ok = g.n >= 100 && g.meanR > 0 && g.ci[0] !== null && g.ci[0] > 0;
    out.groups[k].accept = ok;
    L.push(`  ${k}: ${ok ? "✓ مقبول" : "✗ بلا أفضلية مثبتة"} (n=${g.n} · R=${f2(g.meanR)} · الحدّ الأدنى ${f2(g.ci[0])})`);
  }
  out.text = L;
  out.trades = all.map(t => ({ key: t.key, s: t.s, d: t.sig.d, count: t.sig.count, el: t.sig.el, trig: t.sig.trig,
    cluster: t.sig.cluster, e: t.sig.e, st: t.sig.st, tg: t.sig.tg, rr1: t.sig.rr1, show: t.sig.show,
    end: t.tr && t.tr.end ? t.tr.end.k : null, hit: t.tr ? t.tr.hit : null, R: t.R,
    base: t.base ? { n: t.base.length, mean: mean(t.base), med: median(t.base) } : null }));
  return out;
}

export function specHash() {
  const s = fs.readFileSync(path.join(ROOT, "docs/ENGINE_V2_SPEC.md"), "utf8").replace(/\r\n/g, "\n");
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function selfCheck() {
  const r1 = rng("x"), r2 = rng("x");
  if (r1() !== r2()) throw new Error("المولّد غير حتمي");
  const ci = bootCI([1, 1, 1, 1], "t");
  if (ci[0] !== 1 || ci[1] !== 1) throw new Error("bootstrap خاطئ");
  if (median([3, 1, 2]) !== 2 || median([1, 2, 3, 4]) !== 2.5) throw new Error("الوسيط خاطئ");
  console.log("✓ validate-engine2 --check");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) { selfCheck(); process.exit(0); }
  const period = arg("period", "is");
  if (!PERIODS[period]) throw new Error("--period=is|oos");
  const barsDir = arg("bars", path.join(ROOT, "data/bars/alpaca_sip"));
  const t0 = Date.now();
  const res = run({ period, barsDir });
  const rep = report(res, period, specHash());
  const out = arg("out", path.join(ROOT, "reports", `engine2-${period}.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(rep, null, 1));
  console.log(rep.text.join("\n"));
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)}ث · ${out})`);
}
