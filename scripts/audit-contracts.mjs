#!/usr/bin/env node
/* =====================================================================
   تدقيق توصيات العقود — طلب المالك 2026-10-10. قراءةٌ وحدها (طلبات Alpaca للأسعار التاريخية).

   لكل صفٍّ في contracts-track.json: شموع الدقيقة الحقيقية لكلّ ساق (OPRA عبر Alpaca)،
   ثم **التنفيذ أوّلاً**: لا يُحتسب هدفٌ ولا وقف قبل دقيقةٍ يثبت فيها أن سعر الدخول كان متاحاً
   (مدين: أدنى ≤ الدخول · دائن: أعلى ≥ الدخول؛ والمركّبة بإغلاق الدقيقة كما يفعل المتتبّع).
   والوقف قبل الهدف داخل الدقيقة (محافظ). وبمعزلٍ عن العقد: هل تحرّك الأصل في جهة التوصية
   (شموع SIP 15د: إغلاقُ ما قبل الإصدار مقابل آخر إغلاقٍ حتى النهاية).
   حدود: شموعٌ لا عروض — السبريد غير مقيس هنا (الموقع يرشّح السبريد عند الإصدار).

     node scripts/audit-contracts.mjs --data=DIR [--out=FILE.json]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSeries } from "./lib/bars-store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const DATA = path.resolve(arg("data", path.join(ROOT, "data")));
const AO = await import("./providers/alpaca-options.mjs");
const T = JSON.parse(fs.readFileSync(path.join(DATA, "contracts-track.json"), "utf8"));
const rows = T.rows;
const syms = [...new Set(rows.flatMap((r) => r.legs.map((l) => l.sym)))];
const start = new Date(Math.min(...rows.map((r) => r.at)) * 1000 - 60000).toISOString();
const bars = await AO.optionBars(syms, "1Min", start);

function series(r) {
  if (r.legs.length === 1) return (bars[r.legs[0].sym] || []).map((b) => ({ t: b.t, hi: b.h, lo: b.l }));
  const maps = r.legs.map((l) => new Map((bars[l.sym] || []).map((b) => [b.t, b.c])));
  const ts = [...maps[0].keys()].filter((t) => maps.every((m) => m.has(t))).sort((a, b) => a - b);
  return ts.map((t) => { const v = r.legs.reduce((a, l, i) => a + (l.side === "buy" ? 1 : -1) * maps[i].get(t), 0) * (r.kind === "credit" ? -1 : 1); return { t, hi: v, lo: v }; });
}
const out = [];
for (const r of rows) {
  const ser = series(r).filter((b) => b.t >= r.at * 1000).sort((a, b) => a.t - b.t);
  const credit = r.kind === "credit";
  const fillIdx = ser.findIndex((b) => credit ? b.hi >= r.entry : b.lo <= r.entry);
  let status = ser.length ? (fillIdx < 0 ? "nofill" : "open") : "nodata", hits = 0, end = null;
  if (fillIdx >= 0) for (let i = fillIdx; i < ser.length; i++) {
    const b = ser[i], adv = credit ? b.hi : b.lo, fav = credit ? b.lo : b.hi;
    if (i > fillIdx || true) {
      if (credit ? adv >= r.stop : adv <= r.stop) { status = "stop"; end = b.t; break; }
      while (hits < r.tg.length && (credit ? fav <= r.tg[hits] : fav >= r.tg[hits])) hits++;
      if (hits === r.tg.length) { status = "done"; end = b.t; break; }
    }
  }
  // الأصل: إغلاق 15د قبل الإصدار مقابل آخر إغلاقٍ حتى نهاية الصفقة (أو الآن)
  let under = null;
  const ser15 = readSeries(path.join(DATA, "bars", "alpaca_sip"), r.s, "15m");
  if (ser15 && r.d) {
    const b = ser15.bars.filter((x) => x.t + 900000 <= r.at * 1000), a = ser15.bars.filter((x) => x.t + 900000 <= (end || Date.now()));
    if (b.length && a.length) { const p0 = b[b.length - 1].c, p1 = a[a.length - 1].c; under = { p0, p1, mv: (p1 - p0) / p0 * 100, ok: (p1 - p0) * r.d > 0 }; }
  }
  out.push({ s: r.s, kind: r.kind, cat: r.cat, d: r.d, at: r.at * 1000, exp: r.exp, legs: r.legs.map((l) => (l.side === "buy" ? "+" : "-") + l.sym).join(" "),
    entry: r.entry, stop: r.stop, tg: r.tg, track: { status: r.status, hits: r.hits.length },
    audit: { status, hits, fillT: fillIdx >= 0 ? ser[fillIdx].t : null, end, bars: ser.length }, under });
}
const f = arg("out", path.join(ROOT, "reports", "audit-contracts.json"));
fs.writeFileSync(f, JSON.stringify({ at: Date.now(), coverageFrom: Math.min(...rows.map((r) => r.at)) * 1000, rows: out }));
console.log(`✓ ${out.length} عقداً → ${f}`);
