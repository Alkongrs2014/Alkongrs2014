#!/usr/bin/env node
/* =====================================================================
   تقرير مسبار SIP — ما أقصرُ انتظارٍ آمن بعد إغلاق شمعة ‎15د‎؟

   لكل إزاحة: (١) نسبة الرموز التي وصلت شمعتُها، (٢) نسبة المطابِقة للنهائية
   سعراً (OHLC) وحجماً، (٣) **أثر الفرق على قرار المحرّك**: تُستبدل الشمعة في
   مخزن الليل (النهائي) بما رآه المسبار عند تلك الإزاحة — أو تُحذف إن لم تصل —
   ويُقيَّم الرمز عند الحدّ H بنفس `evalSlot` الحيّ (نافذة 15د)، ويُقارن بالنهائي:
   الرفض والجهة والأساس والدرجة والدخول والوقف. الإزاحةُ آمنة إن لم يتغيّر قرارٌ
   واحد في كل الحدود — لا «نسبةٌ عالية».

   النهائي = مخزن الليل (`data/bars/alpaca_sip`، يُعاد آخر يومٍ في كل دورة) إن
   غطّى الحدّ، وإلا آخر إزاحة (+30د).

   node scripts/probe-sip-report.mjs [YYYY-MM-DD] [--json]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSeries } from "./lib/bars-store.mjs";
import { prep, evalSlot } from "./lib/engine3-run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const day = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toISOString().slice(0, 10);
const file = path.join(ROOT, "data", "logs", "probe", `sip-${day}.jsonl`);
if (!fs.existsSync(file)) { console.error("✗ لا ملفّ مسبار: " + file); process.exit(1); }
const M15 = 15 * 60000;
const recs = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byH = new Map();
for (const r of recs) (byH.get(r.H) || byH.set(r.H, []).get(r.H)).push(r);

const STORE = path.join(ROOT, "data", "bars", "alpaca_sip");
const series = {};
const ser = (s) => series[s] ||= { a: readSeries(STORE, s, "15m"), b: readSeries(STORE, s, "1d") };

const same = (x, y) => x && y && x[0] === y[0] && x[1] === y[1] && x[2] === y[2] && x[3] === y[3];
const decision = (r) => r.reject ? "rej:" + r.reject
  : [r.sig.d, r.sig.base, r.sig.baseTf, r.sig.score, r.sig.e, r.sig.st].join("|");

function evalWith(s, H, bar) {
  const { a, b } = ser(s);
  if (!a || !b) return null;
  const from = H - 150 * 86400000;
  let bars = a.bars.filter((x) => x.t >= from && x.t < H);       // لا نظرَ بعد الحدّ
  bars = bars.filter((x) => x.t !== H - M15);
  if (bar) bars.push({ t: H - M15, o: bar[0], h: bar[1], l: bar[2], c: bar[3], v: bar[4] });
  bars.sort((x, y) => x.t - y.t);
  const S = prep(bars, b.bars.filter((x) => x.t >= from - 400 * 86400000 && x.t < H));
  const { i, r } = evalSlot(S, H, H - M15);
  // قاعدة INV-67 كما في build-trades: لا فرصة بلا تداولٍ في آخر 15 دقيقة
  if (i < 0) return "rej:data";
  if (!r.reject && S.r15[i].t !== H - M15) return "rej:notrade";
  return decision(r);
}

const offs = [...new Set(recs.map((r) => r.off))].sort((a, b) => a - b);
const rows = offs.map((off) => ({ off, n: 0, have: 0, price: 0, vol: 0, dec: 0, decDiff: 0, diffs: [] }));
let Hn = 0;
for (const [H, list] of [...byH].sort((x, y) => x[0] - y[0])) {
  const last = list.reduce((m, r) => (r.off > m.off ? r : m), list[0]);
  const finalOf = (s) => {
    const a = ser(s).a, x = a && a.bars.find((b) => b.t === H - M15);
    return x ? [x.o, x.h, x.l, x.c, x.v] : last.bars[s] || null;
  };
  const syms = new Set(Object.keys(last.bars));
  for (const r of list) for (const s of Object.keys(r.bars)) syms.add(s);
  if (!syms.size) continue;
  Hn++;
  const finalDec = {};
  for (const r of list) {
    const row = rows.find((x) => x.off === r.off);
    for (const s of syms) {
      const fin = finalOf(s); if (!fin) continue;
      const got = r.bars[s] || null;
      row.n++;
      if (got) row.have++;
      if (same(got, fin)) { row.price++; if (got[4] === fin[4]) row.vol++; row.dec++; continue; }
      // يختلف أو غائب: هل يغيّر القرار؟
      if (!(s in finalDec)) finalDec[s] = evalWith(s, H, fin);
      const d = evalWith(s, H, got);
      if (d === finalDec[s]) row.dec++;
      else { row.decDiff++; if (row.diffs.length < 6) row.diffs.push(`${new Date(H).toISOString().slice(11, 16)}Z ${s}: ${d} ≠ ${finalDec[s]}`); }
    }
  }
}
const pct = (a, b) => b ? (100 * a / b).toFixed(2) + "%" : "—";
console.log(`مسبار SIP ${day} — ${Hn} حدّاً · ${recs.length} طلباً · زمن الطلب الوسيط ${recs.map((r) => r.ms).sort((a, b) => a - b)[recs.length >> 1]}ms`);
console.log("الإزاحة | وصلت | السعر نهائي | الحجم نهائي | القرار مطابق | قرارات مختلفة");
for (const r of rows)
  console.log(`+${String(r.off).padStart(4)}ث | ${pct(r.have, r.n).padStart(7)} | ${pct(r.price, r.n).padStart(7)} | ${pct(r.vol, r.n).padStart(7)} | ${pct(r.dec, r.n).padStart(7)} | ${r.decDiff}${r.diffs.length ? "  ← " + r.diffs.join(" ; ") : ""}`);
// أقصر إزاحة لا يختلف بعدها قرارٌ واحد في أيّ إزاحةٍ لاحقة
let safe = null;
for (let k = rows.length - 1; k >= 0; k--) { if (rows[k].decDiff) break; safe = rows[k].off; }
console.log(safe === null ? "✗ لا إزاحة آمنة في هذا اليوم" : `✔ أقصر إزاحةٍ آمنة (لا قرار مختلف منها فصاعداً): +${safe}ث`);
if (process.argv.includes("--json")) fs.writeFileSync(path.join(ROOT, "data", "logs", "probe", `report-${day}.json`), JSON.stringify({ day, H: Hn, rows, safe }, null, 1));
