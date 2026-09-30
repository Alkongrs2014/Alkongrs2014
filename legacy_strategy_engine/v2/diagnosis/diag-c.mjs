// تشخيص (ج): دراسة حدث — داخل العيّنة وحدها. هل يحمل عبورُ قمة/قاع أمس (بتعريف تأكيد V2
// نفسه) مع البوّابة معلومةً اتجاهية فوق شمعةٍ عشوائية بنفس البوّابة؟ بلا وقفٍ ولا أهداف ولا تكلفة.
import { readSeries } from "../scripts/lib/bars-store.mjs";
import { prep, idxAt, inputAt } from "../scripts/lib/engine2-input.mjs";
import { rng, bootCI } from "../scripts/validate-engine2.mjs";
import { createRequire } from "node:module";
import fs from "node:fs";
const E = createRequire(import.meta.url)("../stocks/engine2.js");
const DIR = "D:/Ai/ClaudeCode/trade/webtrade/data/bars/alpaca_sip";
const U = JSON.parse(fs.readFileSync("stocks/symbols.json","utf8"));
const syms = [...U.symbols.map(x=>x.s).slice(0,50), "SPY"];
const S = {}; for (const s of syms) S[s] = prep(readSeries(DIR,s,"15m").bars, readSeries(DIR,s,"1d").bars);
const M = S.SPY, from = Date.parse("2025-01-02"), to = Date.parse("2026-02-27T23:59:59Z");
const steps = M.r15.filter(b => b.end > from && b.end <= to).map(b => b.end);
const ev = [], gated = {}; for (const s of syms) gated[s] = [];
const seen = new Set();
for (const T of steps) for (const s of syms) {
  const X = S[s], ix = idxAt(X, T); if (!ix || X.r15[ix.i15].end !== T) continue;
  const inp = inputAt(X, M, T), r = E.evaluateAt(inp);
  if (!r.gate || !r.gate.d) continue;
  const d = r.gate.d, atrD = E.e2atr(inp.d1.slice(-259), 14), atr15 = E.e2atr(inp.b15.slice(-259), 14);
  if (!(atrD > 0 && atr15 > 0)) continue;
  gated[s].push({ i: ix.i15, d, atrD });
  const pd = E.prevDay(inp.d1);
  const hit = E.findTrigger(inp.b15, [{id:"PDH",p:pd.h},{id:"PDL",p:pd.l}], d, atr15);
  if (!hit) continue;
  for (const lv of hit) {
    const type = d>0 ? (lv==="PDH"?"شراء: كسر قمة أمس":"شراء: استعادة قاع أمس") : (lv==="PDL"?"بيع: كسر قاع أمس":"بيع: فقدان قمة أمس");
    const k = `${s}|${ix.day}|${type}`; if (seen.has(k)) continue; seen.add(k);   // أوّل حدثٍ من نوعه في اليوم
    ev.push({ s, i: ix.i15, d, atrD, type, day: ix.day });
  }
}
// المقاييس من افتتاح الشمعة التالية، بوحدة ATRd وبإشارة الجهة
function measure(X, i, d, a) {
  const f = X.r15[i+1]; if (!f) return null; const F = f.o; const day0 = f.d;
  let rClose = null, rNext = null, race5 = null, race10 = null, days = 0, prevD = day0, r1h = null;
  for (let j = i+1; j < X.r15.length; j++) {
    const b = X.r15[j]; if (b.d !== prevD) { days++; prevD = b.d; }
    if (days > 5) break;
    if (j === i+4) r1h = (b.c - F)*d/a;
    if (b.last && days === 0) rClose = (b.c - F)*d/a;
    if (b.last && days === 1) rNext = (b.c - F)*d/a;
    const up = (d>0?b.h-F:F-b.l)/a, dn = (d>0?F-b.l:b.h-F)/a;
    if (race5 === null) { if (dn >= 0.5) race5 = 0; else if (up >= 0.5) race5 = 1; }
    if (race10 === null) { if (dn >= 1) race10 = 0; else if (up >= 1) race10 = 1; }
  }
  return { r1h, rClose, rNext, race5, race10 };
}
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
const f = x => x==null?"—":x.toFixed(3), p = x => x==null?"—":(x*100).toFixed(1)+"%";
const groups = {};
for (const e of ev) { const X = S[e.s], m = measure(X, e.i, e.d, e.atrD); if (!m) continue;
  // أساسٌ مطابق: 20 شمعة عشوائية للرمز نفسه ±10 جلسات بنفس جهة البوّابة
  const days = [...new Set(X.r15.map(b=>b.d))], di = days.indexOf(e.day);
  const lo = days[Math.max(0,di-10)], hi = days[Math.min(days.length-1,di+10)];
  const pool = gated[e.s].filter(g => g.d === e.d && g.i !== e.i && X.r15[g.i].d >= lo && X.r15[g.i].d <= hi);
  const R = rng(`${e.s}|${e.i}|c`), base = [];
  for (let k = 0; k < 20 && pool.length; k++) { const g = pool[Math.floor(R()*pool.length)]; const bm = measure(X, g.i, g.d, g.atrD); if (bm) base.push(bm); }
  for (const key of [e.type, e.d>0?"شراء: الكل":"بيع: الكل"]) (groups[key] ||= []).push({ m, base });
}
const order = ["شراء: الكل","شراء: كسر قمة أمس","شراء: استعادة قاع أمس","بيع: الكل","بيع: كسر قاع أمس","بيع: فقدان قمة أمس"];
console.log("داخل العيّنة 2025-01-02 → 2026-02-27 · أوّل حدثٍ من نوعه لكل رمز ويوم · الأرقام بوحدة ATR اليومي، بلا تكلفة");
for (const k of order) { const g = groups[k] || []; if (!g.length) continue;
  const line = [`${k.padEnd(22)} n=${String(g.length).padStart(4)}`];
  for (const [m, lbl] of [["r1h","ساعة"],["rClose","إغلاق اليوم"],["rNext","إغلاق الغد"]]) {
    const ok = g.filter(x => x.m[m] != null && x.base.some(b=>b[m]!=null));
    const diff = ok.map(x => x.m[m] - mean(x.base.filter(b=>b[m]!=null).map(b=>b[m])));
    const ci = bootCI(diff, k+m);
    line.push(`${lbl} ${f(mean(ok.map(x=>x.m[m])))} (أساس ${f(mean(ok.map(x=>mean(x.base.filter(b=>b[m]!=null).map(b=>b[m])))))}) فرق ${f(mean(diff))} [${f(ci[0])},${f(ci[1])}]`);
  }
  for (const [m, lbl] of [["race5","±0.5"],["race10","±1"]]) {
    const ok = g.filter(x => x.m[m] != null);
    line.push(`سباق ${lbl} ${p(mean(ok.map(x=>x.m[m])))} (أساس ${p(mean(ok.map(x=>mean(x.base.filter(b=>b[m]!=null).map(b=>b[m])))))})`);
  }
  console.log("  " + line.join(" · "));
}
