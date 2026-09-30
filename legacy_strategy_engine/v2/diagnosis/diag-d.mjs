// تشخيص (د): قيمة البوّابة نفسها — داخل العيّنة. حركة إغلاق الغد (بإشارة الشراء، بوحدة ATRd)
// لكل الشموع، مقسومةً بحالة البوّابة: صاعد واضح / هابط واضح / بلا بوّابة.
import { readSeries } from "../scripts/lib/bars-store.mjs";
import { prep, idxAt, inputAt } from "../scripts/lib/engine2-input.mjs";
import { bootCI } from "../scripts/validate-engine2.mjs";
import { createRequire } from "node:module";
import fs from "node:fs";
const E = createRequire(import.meta.url)("../stocks/engine2.js");
const DIR = "D:/Ai/ClaudeCode/trade/webtrade/data/bars/alpaca_sip";
const U = JSON.parse(fs.readFileSync("stocks/symbols.json","utf8"));
const syms = [...U.symbols.map(x=>x.s).slice(0,50), "SPY"];
const S = {}; for (const s of syms) S[s] = prep(readSeries(DIR,s,"15m").bars, readSeries(DIR,s,"1d").bars);
const M = S.SPY, from = Date.parse("2025-01-02"), to = Date.parse("2026-02-27T23:59:59Z");
const steps = M.r15.filter(b => b.end > from && b.end <= to).map(b => b.end);
const G = { "+1": [], "-1": [], "0": [] }, mk = { "+1": [], "-1": [], "0": [] }, sk = { "+1": [], "-1": [], "0": [] };
let n = 0;
for (const T of steps) for (const s of syms) {
  const X = S[s], ix = idxAt(X, T); if (!ix || X.r15[ix.i15].end !== T) continue;
  if ((n++ % 7) !== 0) continue;                         // عيّنةٌ منتظمة ‎1/7‎ تكفي للمتوسّط وتقصّر التشغيل
  const inp = inputAt(X, M, T), r = E.evaluateAt(inp); if (!r.gate) continue;
  const a = E.e2atr(inp.d1.slice(-259), 14); if (!(a > 0)) continue;
  const f = X.r15[ix.i15 + 1]; if (!f) continue;
  let days = 0, pd = f.d, rn = null;
  for (let j = ix.i15 + 1; j < X.r15.length; j++) { const b = X.r15[j]; if (b.d !== pd) { days++; pd = b.d; } if (b.last && days === 1) { rn = (b.c - f.o) / a; break; } if (days > 1) break; }
  if (rn === null) continue;
  const k = x => x > 0 ? "+1" : (x < 0 ? "-1" : "0");
  G[k(r.gate.d)].push(rn); mk[k(r.gate.mkt.dir)].push(rn); sk[k(r.gate.stk.dir)].push(rn);
}
const mean = a => a.reduce((x,y)=>x+y,0)/a.length, f3 = x => x.toFixed(3);
const all = [...G["+1"], ...G["-1"], ...G["0"]], m0 = mean(all);
console.log(`داخل العيّنة · حركة إغلاق الغد من افتتاح الشمعة التالية (بإشارة الشراء، ×ATRd) · كل الشموع: ${f3(m0)} (n=${all.length})`);
for (const [lbl, T] of [["البوّابة (السوق+السهم)", G], ["السوق وحده (SPY)", mk], ["السهم وحده", sk]])
  for (const k of ["+1","-1","0"]) { const a = T[k], d = a.map(x => x - m0), ci = bootCI(d, lbl+k);
    console.log(`  ${lbl.padEnd(22)} ${k==="+1"?"صاعد واضح":k==="-1"?"هابط واضح":"غير واضح "} n=${String(a.length).padStart(6)} · ${f3(mean(a))} · فرقه عن الكل ${f3(mean(d))} [${f3(ci[0])}, ${f3(ci[1])}]`); }
