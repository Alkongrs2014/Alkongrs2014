#!/usr/bin/env node
/* =====================================================================
   تدقيق فرص استراتيجية SMA منذ تفعيلها — طلب المالك 2026-10-10. قراءةٌ وحدها.

   ١) يعيد بناء ما نشره الموقع لقطةً لقطة بشيفرة الإنتاج نفسها (`build`) على
      مخزن SIP وشموع Binance، بالحالة المنقولة بين اللقطات — ثم يطابقه بالمنشور
      الفعلي (عدد «الجديدة» لكل لقطة في سجلّات التشغيل، والنسخة الاحتياطية).
   ٢) يفحص كلَّ فرصةٍ بشيفرةٍ مستقلّة عن المحرّك: شرط 15د عند شمعة الإشارة نفسها
      (المتوسطات على إغلاقات ما قبلها)، أوّليّتها، تأكيد الساعة، النقاط، طزاجة
      البيانات، التكرار، والنتيجة بقواعد دورة الحياة (الوقف يُحسب قبل الهدف في
      الشمعة نفسها — محافظ).
   ٣) يحصي كلَّ شمعة 15د حقّقت الشرط ولم تصدر فرصة، وسببَ ذلك.
   ٤) يقارن بتعريف TradingView الافتراضي للأسهم (SMA على الجلسة الرسمية وحدها).
   ٥) التوقيت: افتتاح الشمعة · إمكان القرار (إغلاقها) · اللقطة · النشر (من السجلّ).

     node scripts/audit-sma.mjs --data=DIR --from=ISO [--to=ISO] [--out=FILE.json]
   ===================================================================== */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readSeries } from "./lib/bars-store.mjs";
import { prep, prepCrypto, evalSlot, prevSlotOf, stepOver } from "./lib/engine3-run.mjs";
import { build } from "./build-trades.mjs";

const require = createRequire(import.meta.url);
const E = require("../stocks/engine3.js");
const SES = require("../stocks/session.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const DATA = path.resolve(arg("data", path.join(ROOT, "data")));
const FROM = Date.parse(arg("from", "2026-10-08T15:30:00Z"));
const M15 = 900000, H1 = 3600000;
const TO = arg("to") ? Date.parse(arg("to")) : Math.floor(Date.now() / M15) * M15;
const rj = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const riy = (t) => t == null ? null : new Date(t + 3 * H1).toISOString().slice(0, 16).replace("T", " ");

/* ---------- مستقلّ عن المحرّك ---------- */
const sma = (xs, p, k) => { if (k + 1 < p || k < 0) return null; let s = 0; for (let i = k - p + 1; i <= k; i++) s += xs[i]; return s / p; };
function cond15(bars, i) {                                    // bars: شموع 15د مغلقة، i شمعة الإشارة
  const c = bars.map((b) => b.c);
  const base = sma(c, 200, i - 1), pBase = sma(c, 200, i - 2), f35 = sma(c, 35, i - 1), f50 = sma(c, 50, i - 1);
  if ([base, pBase, f35, f50].some((x) => x === null)) return { ok: null };
  const o = bars[i].o, po = bars[i - 1].o;
  const up = o > base && po <= pBase && f35 < base && f50 < base;
  const dn = o < base && po >= pBase && f35 > base && f50 > base;
  return { ok: true, d: up ? 1 : dn ? -1 : 0, base, pBase, f35, f50, o, po };
}
function conf1h(h1, T) {                                      // آخر شمعة ساعة مغلقة عند T
  let i = h1.length - 1; while (i >= 0 && h1[i].end > T) i--;
  if (i < 51) return null;
  const m = sma(h1.map((b) => b.c), 50, i - 1);
  return h1[i].o > m ? 1 : h1[i].o < m ? -1 : 0;
}
/* TradingView الافتراضي للأسهم: الجلسة الرسمية 09:30–16:00 نيويورك وحدها */
function rthOnly(r15) {
  return r15.filter((b) => { const w = SES.sessionWindows(b.t); return w.regular && b.t >= w.regular.start && b.t < w.regular.end; });
}

/* ---------- زمن النشر من سجلّات التشغيل ---------- */
function publishTimes(book) {
  const dir = path.join(DATA, "logs", "runs"), out = new Map(), born = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(book === "crypto" ? "-crypto.log" : "-confirm.log")).sort()) {
    const L = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/);
    let start = null, acc = 0, slot = null;
    for (const x of L) {
      const s0 = /════ \w+ · (\S+Z)/.exec(x); if (s0) { start = Date.parse(s0[1]); acc = 0; slot = null; continue; }
      const d = /⏱ (fetch-market|fetch-crypto|build-trades)\.mjs ([\d.]+)ث/.exec(x); if (d && start) acc += +d[2] * 1000;
      const b = new RegExp(`trades\\.json \\(${book}\\) · لقطة (\\S+Z) · جديدة (\\d+)`).exec(x);
      if (b) { slot = Date.parse(b[1]); born.set(slot, +b[2]); }
      const p = /⏱ نشر (.+)/.exec(x);
      if (p && start && slot && !out.has(slot)) {
        const ms = [...p[1].matchAll(/([\d.]+)ث/g)].reduce((a, m) => a + +m[1] * 1000, 0);
        out.set(slot, start + acc + ms);
      }
      if (/نُشر/.test(x) && start) start = null;
    }
  }
  return { pub: out, born };
}

/* ---------- السلاسل ---------- */
function loadStocks() {
  const U = rj(path.join(ROOT, "stocks/symbols.json")), S = {};
  for (const s of U.symbols.map((x) => x.s).slice(0, U.top || 50)) {
    const a = readSeries(path.join(DATA, "bars", "alpaca_sip"), s, "15m"), b = readSeries(path.join(DATA, "bars", "alpaca_sip"), s, "1d");
    if (a && b) S[s] = prep(a.bars, b.bars);
  }
  return S;
}
function loadCrypto() {
  const sum = rj(path.join(DATA, "crypto", "summary.json")), S = {};
  for (const r of sum.rows) { const f = path.join(DATA, "crypto", "sym", r.s + ".json"); if (fs.existsSync(f)) S[r.s] = prepCrypto(rj(f)); }
  return S;
}

/* ---------- إعادة البناء والفحص ---------- */
function audit(book) {
  const S = book === "crypto" ? loadCrypto() : loadStocks();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
  if (book === "crypto") fs.copyFileSync(path.join(DATA, "crypto", "summary.json"), path.join(tmp, "summary.json"));
  const { pub, born } = publishTimes(book);
  let state = { book, hour: Math.round((FROM - M15) / 1000), active: [], closed: [] }, lastH = null;
  const trades = new Map(), missed = [], slots = [];
  for (let now = FROM + 60000; now <= TO + 60000; now += M15) {
    const r = build({ now, out: tmp, book, S, state });
    if (!r.ok || r.same) continue;
    const H = r.doc.hour * 1000; if (H === lastH) continue;
    const heldBefore = new Set(state.active.map((t) => t.s));
    lastH = H; state = r.state;
    slots.push({ H, rebuilt: r.doc.open.length, logged: born.has(H) ? born.get(H) : null, pubAt: pub.get(H) || null });
    for (const t of [...state.active, ...state.closed]) trades.set(t.id, t);
    // شمعة 15د حقّقت الشرط في هذه اللقطة ولم تصدر فرصة
    const issued = new Set(r.doc.open.map((t) => t.s)), prevH = prevSlotOf(book, H);
    for (const s of Object.keys(S)) {
      const x = evalSlot(S[s], H, prevH); const m = x.r.fa && x.r.fa.fr["15m"].ma;
      if (!m || !m.ev || !(m.end > prevH) || issued.has(s)) continue;
      const bar = S[s].r15[x.i];
      const why = heldBefore.has(s) ? "held" : x.r.reject ? x.r.reject : bar.t !== H - M15 ? "notrade" : "stale";
      missed.push({ book, s, d: m.ev, H, t: bar.t, why });
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const rows = [];
  const pre = arg("pre"); if (pre) for (const t of [...rj(path.join(pre, book === "crypto" ? "crypto/trades-state.json" : "trades-state.json")).active,
    ...rj(path.join(pre, book === "crypto" ? "crypto/trades-state.json" : "trades-state.json")).closed].filter((x) => x.wv === 2)) {
    if (!S[t.s]) continue;
    if (t.status === "confirmed" || t.status === "active") stepOver(t, S[t.s], FROM - M15, TO);
    t.preReset = 1; trades.set(t.id, t);
  }
  for (const t of trades.values()) {
    const X = S[t.s], i = X.r15.findIndex((b) => b.t === t.t), H = t.h * 1000;
    const c = i > 1 ? cond15(X.r15, i) : { ok: null };
    const h1 = conf1h(X.h1, H);
    const ptsMa = 40 + (t.tfs && t.tfs.ma.includes("1h") ? 20 : 0);
    const sum = ["day", "ma", "trend", "vwap", "week"].reduce((a, k) => a + (t.pts[k] || 0), 0);
    const R = { book, pre: t.preReset ? 1 : 0, s: t.s, id: t.id, d: t.d, H, t: t.t, score: t.score, pts: t.pts, e: t.e, st: t.st, tg: t.tg.map((x) => x.p),
      riskPct: t.risk / t.e * 100, status: t.status, end: t.end ? t.end.k : null, endT: t.end ? t.end.t : null, hit: t.hit || 0,
      fill: t.fill ? t.fill.px : null, Rg: t.status === "closed" ? E.tradeR(t, false) : null,
      pct: t.status === "closed" && t.fill ? (t.end.px - t.fill.px) * t.d / t.fill.px * 100 : null,
      chk: { data: c.ok !== null, cond: c.ok ? c.d === t.d : null, first: c.ok ? (t.d > 0 ? c.po <= c.pBase : c.po >= c.pBase) : null,
             h1: h1 === null ? null : (h1 === t.d) === (t.tfs && t.tfs.ma.includes("1h")), pts: t.pts.ma === ptsMa && Math.abs(sum - t.score) < 1e-9,
             fresh: t.t === H - M15, entry: i >= 0 && Math.abs(X.r15[i].c - t.e) < 1e-9 },
      sma: c.ok ? { base: c.base, f35: c.f35, f50: c.f50, o: c.o, po: c.po, pBase: c.pBase } : null,
      pubAt: pub.get(H) || null };
    // تعريف TradingView الافتراضي للأسهم: هل كان «أوّل افتتاحٍ فوق SMA200» في الجلسة الرسمية؟ وكم شمعة قبلها؟
    if (book === "stocks") {
      const rth = rthOnly(X.r15), k = rth.findIndex((b) => b.t === t.t);
      if (k < 0) R.tv = { inRth: false };
      else {
        let first = null;
        for (let j = k; j > Math.max(2, k - 30); j--) { const q = cond15(rth, j); if (q.ok && q.d === t.d) { first = j; break; }
          const q2 = cond15(rth, j); if (q2.ok && (t.d > 0 ? q2.o <= q2.base : q2.o >= q2.base)) break; }
        let side = 0;
        for (let j = k - 1; j > 2; j--) { const q = cond15(rth, j); if (!q.ok || !(t.d > 0 ? q.o > q.base : q.o < q.base)) break; side++; }
        const q0 = cond15(rth, k);
        R.tv = { inRth: true, firstT: first === null ? null : rth[first].t, lagBars: first === null ? null : k - first, sideBefore: side,
                 openSide: q0.ok ? (t.d > 0 ? q0.o > q0.base : q0.o < q0.base) : null, rthBase: q0.ok ? q0.base : null };
      }
    }
    rows.push(R);
  }
  // التكرار: صفقتان للرمز تتداخل حياتاهما
  for (const r of rows) r.dup = rows.some((o) => o !== r && o.s === r.s && o.H < r.H && (o.endT === null || o.endT > r.H));
  return { book, rows, missed, slots };
}

const out = { at: Date.now(), from: FROM, to: TO, books: {} };
for (const b of ["stocks", "crypto"]) { out.books[b] = audit(b); process.stderr.write(`${b}: ${out.books[b].rows.length} فرصة · ${out.books[b].missed.length} شمعة مؤهّلة بلا فرصة\n`); }
const f = arg("out", path.join(ROOT, "reports", "audit-sma.json"));
fs.mkdirSync(path.dirname(f), { recursive: true });
fs.writeFileSync(f, JSON.stringify(out));
console.log("✓ " + f);
