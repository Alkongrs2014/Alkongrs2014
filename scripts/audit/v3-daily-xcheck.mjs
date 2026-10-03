#!/usr/bin/env node
/* =====================================================================
   تحقّقٌ ثانٍ مستقلّ لمستويات «أمس» و«الأسبوع» — مزوّدٌ آخر (ياهو، الجلسة الرسمية
   المجمَّعة) مقابل Alpaca 1Day (ما يقرؤه المحرّك) ومقابل الدقيقة الواحدة من Alpaca
   مجمَّعةً لساعات الجلسة الرسمية. قراءةٌ فقط.

   node scripts/audit/v3-daily-xcheck.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD --out=FILE
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const FROM = arg("from"), TO = arg("to"), OUT = arg("out");
const CACHE = path.join(ROOT, "reports/v3-audit/cache");
const U = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8")).symbols.map((x) => x.s).slice(0, 50);

const etDate = (t) => new Date(t - 4 * 3600000).toISOString().slice(0, 10);   // ظهراً لا يتأثّر بالتوقيت
async function yahoo(s) {
  const f = path.join(CACHE, `Y-${s}-${FROM}-${TO}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  const p1 = Math.floor(Date.parse(FROM) / 1000), p2 = Math.floor(Date.parse(TO) / 1000) + 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?period1=${p1}&period2=${p2}&interval=1d&events=split`,
    { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${s} ${r.status}`);
  const j = (await r.json()).chart.result[0], q = j.indicators.quote[0];
  const out = j.timestamp.map((t, i) => [etDate(t * 1000 + 12 * 3600000), q.high[i], q.low[i]]).filter((x) => x[1] != null);
  fs.writeFileSync(f, JSON.stringify(out));
  return out;
}
const near = (a, b) => Math.abs(a - b) <= Math.max(0.011, 1e-4 * Math.abs(b));
const res = { compared: 0, alpacaVsYahoo: [], perSym: {} };
for (const s of U) {
  const al = fs.readdirSync(CACHE).find((f) => f.startsWith(`${s}-1Day-`));
  if (!al) continue;
  const A = new Map(JSON.parse(fs.readFileSync(path.join(CACHE, al), "utf8")).map(([t, , h, l]) => [etDate(t + 12 * 3600000), [h, l]]));
  let Y; try { Y = await yahoo(s); } catch (e) { res.perSym[s] = "ياهو: " + e.message; continue; }
  let n = 0, bad = 0;
  for (const [d, h, l] of Y) {
    if (d < FROM || d > TO || !A.has(d)) continue;
    n++; res.compared++;
    const [ah, alo] = A.get(d);
    if (!near(ah, h) || !near(alo, l)) { bad++; res.alpacaVsYahoo.push({ s, d, alpaca: [ah, alo], yahoo: [+h.toFixed(4), +l.toFixed(4)] }); }
  }
  res.perSym[s] = { n, bad };
}
res.mismatchRate = res.compared ? +(res.alpacaVsYahoo.length / res.compared).toFixed(4) : null;
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log(`✓ قورن ${res.compared} يوماً-رمزاً · خلاف ${res.alpacaVsYahoo.length} (${(res.mismatchRate * 100).toFixed(2)}%)`);
