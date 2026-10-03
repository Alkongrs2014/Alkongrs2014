#!/usr/bin/env node
/* =====================================================================
   تحقّقٌ مستقلّ من لقطة العقود المنشورة — قراءةٌ فقط (لا يستورد fetch-contracts).

   لكل رجل: العرض/الطلب وIV والإغريقيات مقابل لقطة OPRA جديدة من Alpaca (حين لم يتغيّر
   السوق — خارج الجلسة — يجب التطابق التامّ)، والسترايك والانتهاء والنوع مقابل رمز OCC،
   والسبريد والأيام المتبقّية محسوبةً من جديد، وأن لا عقد «قابل للتنفيذ» بعرضٍ قديم أو والسوق مغلق.

   node scripts/audit/contracts-verify.mjs [FILE]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FILE = process.argv[2] || path.join(ROOT, "data/contracts.json");
const ENV = {};
for (const l of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) ENV[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const H = { "APCA-API-KEY-ID": ENV.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": ENV.ALPACA_SECRET_KEY };
const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const legs = doc.picks.flatMap((p) => p.legs.map((l) => ({ p, l })));
const syms = [...new Set(legs.map((x) => x.l.sym))];
const snap = {};
for (let i = 0; i < syms.length; i += 100) {
  const u = `https://data.alpaca.markets/v1beta1/options/snapshots?feed=opra&symbols=${syms.slice(i, i + 100).join(",")}`;
  const j = await (await fetch(u, { headers: H, signal: AbortSignal.timeout(30000) })).json();
  Object.assign(snap, j.snapshots || {});
}
const occ = (s) => { const m = /^([A-Z.]+?)(\d{6})([CP])(\d{8})$/.exec(s); return m && { exp: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4)}`, type: m[3] === "C" ? "call" : "put", K: +m[4] / 1000 }; };
/* بلاك–شولز مستقلّ (لا يستورد scripts/lib/options.mjs) */
const Nc = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const R = 0.04;
const bsPrice = (S, K, T, v, type) => { const d1 = (Math.log(S / K) + (R + v * v / 2) * T) / (v * Math.sqrt(T)), d2 = d1 - v * Math.sqrt(T);
  return type === "call" ? S * Nc(d1) - K * Math.exp(-R * T) * Nc(d2) : K * Math.exp(-R * T) * Nc(-d2) - S * Nc(-d1); };
const bsDelta = (S, K, T, v, type) => { const d1 = (Math.log(S / K) + (R + v * v / 2) * T) / (v * Math.sqrt(T)); return type === "call" ? Nc(d1) : Nc(d1) - 1; };
function impliedVol(px, S, K, T, type) { let lo = 0.01, hi = 4; if (bsPrice(S, K, T, hi, type) < px || bsPrice(S, K, T, lo, type) > px) return null;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (bsPrice(S, K, T, m, type) < px) lo = m; else hi = m; } return (lo + hi) / 2; }
/* إغلاق نيويورك يوم الانتهاء (16:00 ET) — بإزاحة التوقيت الصيفي/الشتوي من Intl */
const closeEt = (exp) => { const g = Date.parse(exp + "T16:00:00Z");
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).formatToParts(new Date(g)).map((x) => [x.type, x.value]));
  return g + (16 - +p.hour) * 3600000; };
const near = (a, b, t) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= t);
const out = { legs: legs.length, checks: 0, bad: [], noGreeksAtSource: 0, execOpen: 0, phase: doc.phase };
const H0 = doc.hour * 1000;
const etDay = (t) => new Date(t - 4 * 3600e3).toISOString().slice(0, 10);
for (const { p, l } of legs) {
  const s = snap[l.sym], o = occ(l.sym), q = s && s.latestQuote;
  const chk = (f, ok, got, want) => { out.checks++; if (!ok) out.bad.push({ s: p.s, sym: l.sym, f, got, want }); };
  chk("رمز OCC", !!o, l.sym, "صيغة OCC");
  if (o) { chk("السترايك", o.K === l.K, l.K, o.K); chk("الانتهاء", o.exp === l.exp, l.exp, o.exp); chk("النوع", o.type === l.type, l.type, o.type); }
  chk("في OPRA", !!s, null, "لقطة");
  if (q) { chk("العرض", near(l.bid, Math.round(q.bp * 100) / 100, 0.005), l.bid, q.bp); chk("الطلب", near(l.ask, Math.round(q.ap * 100) / 100, 0.005), l.ask, q.ap);
           chk("وقت العرض", l.qt === Math.round(Date.parse(q.t) / 1000), l.qt, Math.round(Date.parse(q.t) / 1000)); }
  if (Number.isFinite(l.bid) && Number.isFinite(l.ask)) { const mid = (l.bid + l.ask) / 2; chk("السبريد", near(l.spr, (l.ask - l.bid) / mid, 2e-3), l.spr, (l.ask - l.bid) / mid); }
  /* IV والإغريقيات تتغيّر بمرور الزمن وإن ثبت السعر (المصدر يعيد حسابها بالزمن المتبقّي الآن)،
     فلا تُقارن بلقطةٍ لاحقة. يُتحقَّق بدلاً من ذلك أن IV المحفوظ **يفسّر سعر الوسط المحفوظ** عند
     لحظة البناء — بلاك–شولز مستقلّ هنا (r=4%، بلا توزيعات)، وفرقُ النماذج المقبول 3 نقاط. */
  if (Number.isFinite(l.iv) && l.mid > 0 && o) {
    const T = (closeEt(o.exp) - Date.parse(doc.generatedAt)) / (365 * 86400000);
    const iv = T > 0 ? impliedVol(l.mid, p.S, o.K, T, o.type) : null;
    if (iv !== null) chk("IV يفسّر سعر الوسط", Math.abs(iv - l.iv) <= 0.03, l.iv, +iv.toFixed(4));
    if (iv !== null && Number.isFinite(l.delta)) chk("Delta متّسقة", Math.abs(bsDelta(p.S, o.K, T, l.iv, o.type) - l.delta) <= 0.03, l.delta, +bsDelta(p.S, o.K, T, l.iv, o.type).toFixed(4));
  }
  if (!s || !s.greeks) out.noGreeksAtSource++;
  if (o) { const dte = Math.round((Date.parse(o.exp + "T12:00:00Z") - Date.parse(etDay(H0) + "T12:00:00Z")) / 86400000); chk("الأيام المتبقّية", l.dte === dte, l.dte, dte); }
}
for (const p of doc.picks) {
  out.checks++;
  if (p.exec) { out.execOpen++; if (doc.phase !== "regular" || p.legs.some((l) => !l.qt || H0 - l.qt * 1000 > 5 * 60000)) out.bad.push({ s: p.s, f: "قابل للتنفيذ بعرضٍ قديم أو والسوق مغلق" }); }
}
const by = {}; for (const b of out.bad) by[b.f] = (by[b.f] || 0) + 1;
console.log(JSON.stringify({ ...out, byField: by, bad: out.bad.filter((b) => !["IV", "Delta"].includes(b.f)).slice(0, 15), badCount: out.bad.length }, null, 1));
process.exit(out.bad.length ? 1 : 0);
