#!/usr/bin/env node
/* =====================================================================
   الاختبار التاريخي بدورة الحياة الحيّة — للمقارنة بين نسختين من المحرّك.

   لا نسخةَ ثانية من المنطق: يمشي `build()` من build-trades.mjs نفسَه لقطةً
   لقطة (كل 15 دقيقة) بالحالة المنقولة بين اللقطات — صفقةٌ واحدة لكل رمز،
   تُحمَل حتى الوقف أو آخر هدف أو 5 جلسات، وINV-67 (لا دخولٌ قديم). والمدخلات
   مقطوعةٌ عند كل حدّ H بشموعٍ مغلقة نهايتُها ≤ H (`inputAt`)، فلا نظرَ إلى
   المستقبل. يشغّله كلُّ فرعٍ على محرّكه هو (stocks/engine3.js في شجرته).

   التكاليف — نموذجان يُطبعان معاً:
     · نموذج المحرّك (`tradeR`): انزلاق 0.05×ATR يومي لكل جهة + 2 نقطة أساس.
     · نموذجٌ صريح بنقاط الأساس ذهاباً وإياباً (--cost-bps، افتراضياً الأسهم 6 والكريبتو 25):
       الأسهم: عمولة Alpaca 0 + رسوم SEC/FINRA ~0.3 + سبريد ~2 + انزلاق ~2 (+ الممتد أوسع)
       الكريبتو: عمولة Binance 0.1% لكل جهة (20) + سبريد/انزلاق ~5.

     node scripts/backtest-lifecycle.mjs --book=stocks --from=2025-01-02 --to=2026-10-07 --out=f.json
     node scripts/backtest-lifecycle.mjs --book=crypto --dir=<مجلّد ملفّات العملات> --from=... --out=f.json
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readSeries } from "./lib/bars-store.mjs";
import { prep, prepCrypto } from "./lib/engine3-run.mjs";
import { build, engineVersion } from "./build-trades.mjs";

const require = createRequire(import.meta.url);
const E = require("../stocks/engine3.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const M15 = 15 * 60000;

const book = arg("book", "stocks");
const from = Date.parse(arg("from", "2025-01-02") + "T00:00:00Z");
const to = Date.parse(arg("to", new Date().toISOString().slice(0, 10)) + "T23:59:59Z");
const costBps = Number(arg("cost-bps", book === "crypto" ? 25 : 6));

/* السلاسل كاملةً مرّةً واحدة — `build` يقطعها عند كل حدّ بنفسه */
const S = {};
if (book === "crypto") {
  const dir = arg("dir");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) S[path.basename(f, ".json")] = prepCrypto(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
} else {
  const barsDir = arg("bars", path.join(ROOT, "data/bars/alpaca_sip"));
  const U = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
  for (const s of U.symbols.map((x) => x.s).slice(0, U.top || 50)) {
    const a = readSeries(barsDir, s, "15m"), b = readSeries(barsDir, s, "1d");
    if (a && b) S[s] = prep(a.bars, b.bars);
  }
}
const tmpOut = fs.mkdtempSync(path.join(process.env.TEMP || "/tmp", "bt-"));
const all = new Map();
let state = null, lastH = null, slots = 0, evalMs = 0;
const t0 = Date.now();
for (let now = Math.ceil(from / M15) * M15; now <= to; now += M15) {
  const t1 = performance.now();
  const r = build({ now, out: tmpOut, book, S, state, fresh: true });
  evalMs += performance.now() - t1;
  if (!r.ok || r.same) continue;
  const H = r.doc.hour * 1000;
  if (H === lastH) continue;
  lastH = H; slots++;
  state = r.state;
  for (const tr of [...state.active, ...state.closed]) all.set(tr.id, tr);
  if (slots % 2000 === 0) process.stderr.write(`${new Date(H).toISOString().slice(0, 10)} `);
}
process.stderr.write("\n");

const trades = [...all.values()].map((t) => {
  const done = t.status === "closed";
  let pct = null, pctNet = null;
  if (done && t.fill) {
    pct = (t.end.px - t.fill.px) * t.d / t.fill.px;
    pctNet = pct - costBps / 10000;
  }
  return { s: t.s, id: t.id, d: t.d, h: t.h, score: t.score, base: t.base, baseTf: t.baseTf, status: t.status,
    end: t.end ? t.end.k : null, endT: t.end ? t.end.t : null, hit: t.hit || 0,
    R: done ? E.tradeR(t, true) : null, Rg: done ? E.tradeR(t, false) : null, pct, pctNet,
    riskPct: t.risk / t.e, el: t.el, tfs: t.tfs };
});
const out = arg("out", path.join(ROOT, "reports", `bt-${book}.json`));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ book, version: engineVersion(), weights: E.E3.W, from: arg("from"), to: arg("to"),
  syms: Object.keys(S).length, slots, costBps, msPerSlot: evalMs / Math.max(1, slots), wallS: (Date.now() - t0) / 1000, trades }));
fs.rmSync(tmpOut, { recursive: true, force: true });
console.log(`${book}: ${Object.keys(S).length} رمزاً · ${slots} لقطة · ${trades.length} صفقة · ${(evalMs / Math.max(1, slots)).toFixed(1)} م.ث/لقطة · ${((Date.now() - t0) / 1000).toFixed(0)}ث → ${out}`);
