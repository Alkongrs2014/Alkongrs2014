#!/usr/bin/env node
/* =====================================================================
   المسار الحيّ للمحرّك V3 ← trades.json (docs/ENGINE_V3_SPEC.md §4ب)

   **لقطة الساعة — قرار المالك 2026-10-01**: كلُّ ساعة بدايةٌ جديدة بالكامل.
   عند كل حدّ ساعة تُصفَّر الفرص كلُّها، ويُحلَّل كلُّ رمزٍ من الصفر على آخر
   الشموع المغلقة، وما تحقّق فيه شرطُ فرصةٍ الآن يُنشأ فرصةً جديدة بجهتها
   ودرجتها ودخولها ووقفها وأهدافها. **لا يُقرأ شيءٌ من لقطة الساعة السابقة** —
   لا حالة ولا ملفّ: البناء دالّةٌ في (الشموع المغلقة، حدّ الساعة) وحدهما.

   الأسهم: 05:15 نيويورك ثم كلَّ 30 دقيقة حتى نهاية نافذة SIP (20:00) — قرار المالك
   2026-10-01؛ الشموع المغلقة من ما قبل الافتتاح والرسمية وما بعد الإغلاق (مخزن Alpaca SIP).
   الكريبتو: كلُّ ساعة UTC، ويومُه 03:00→03:00 الرياض = يوم UTC (ملفّات Binance).
   وداخل الساعة الواحدة لا يُعاد البناء: اللقطة ثابتةٌ حتى الحدّ التالي.

   --out DIR   مجلّد البيانات (data للأسهم · data/crypto للكريبتو)
   --book stocks|crypto   (الافتراضي من المجلّد)
   --check     فحصٌ ذاتي بلا شبكة
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readSeries, storeDir } from "./lib/bars-store.mjs";
import { prep, prepCrypto, evalHour, stockSlotAt, cryptoHourAt } from "./lib/engine3-run.mjs";
import { rp } from "./lib/round.mjs";

const require = createRequire(import.meta.url);
const E = require("../stocks/engine3.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg("out", path.join(ROOT, "data")));
const M15 = 15 * 60000, KEEP_DAYS = 150;

/* نسخة المحرّك: بصمة الشيفرة التي تشكّل القرار (نصٌّ موحّد النهايات) */
export function engineVersion() {
  const h = crypto.createHash("sha256");
  for (const f of ["stocks/engine3.js", "scripts/lib/engine3-run.mjs", "scripts/build-trades.mjs"])
    h.update(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n"));
  return h.digest("hex").slice(0, 12);
}
/* الأسعار بالأرقام المعنوية (`rp`) لا بخاناتٍ ثابتة — التقريب الثابت يمحو الأصول
   الرخيصة (شيبا إينو 0.0000051 ⇒ صفر)، مصيدةٌ موثّقة */
const r4 = (x) => x == null || !Number.isFinite(x) ? null : rp(x);
const r2 = (x) => x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100;
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

/* فرصةُ الساعة المنشورة — كلُّ رقمٍ محسوبٌ في هذه الساعة */
function pubOpp(s, H, sig, bar) {
  return { id: `${s}|${Math.round(H / 1000)}`, s, h: Math.round(H / 1000), d: sig.d, status: "open",
    t: Math.round(bar.t / 1000), base: sig.base, evt: sig.evt || null, weekEvt: sig.weekEvt || null,
    el: sig.el, pts: sig.pts, score: sig.score,
    e: r4(sig.e), st: r4(sig.st), risk: r4(sig.risk), rr1: r2(sig.rr1),
    tg: sig.tg.map((x) => ({ p: r4(x.p), src: x.src })), hit: 0,
    ma: sig.ma, trend: sig.trend, trendTf: sig.trendTf, vwap: r4(sig.vwap),
    pdh: r4(sig.pdh), pdl: r4(sig.pdl), pwh: r4(sig.pwh), pwl: r4(sig.pwl), atrD: r4(sig.atrD) };
}
function stateRow(st) {
  return { px: r4(st.px), ma: st.ma.dir, trend: st.trend.dir, trendTf: st.trend.tf,
    vwap: r4(st.vwap), pdh: r4(st.pd && st.pd.h), pdl: r4(st.pd && st.pd.l),
    pwh: r4(st.pw && st.pw.h), pwl: r4(st.pw && st.pw.l),
    day: st.day ? { evt: st.day.evt, d: st.day.d, holds: st.day.holds } : null,
    week: st.week ? { evt: st.week.evt, d: st.week.d, holds: st.week.holds } : null,
    up: E.scoreFor(st, 1).score, dn: E.scoreFor(st, -1).score };
}

/* مصدر الشموع لكل دفتر */
function loadBook(book, out, barsDir, now) {
  const S = {};
  if (book === "crypto") {
    const sum = readJ(path.join(out, "summary.json"));
    for (const r of (sum && sum.rows) || []) {
      const rec = readJ(path.join(out, "sym", r.s + ".json"));
      if (rec) S[r.s] = prepCrypto(rec);
    }
    return S;
  }
  const U = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
  const from = now - KEEP_DAYS * 86400000;
  for (const s of U.symbols.map((x) => x.s).slice(0, U.top || 50)) {
    const a = readSeries(barsDir, s, "15m"), b = readSeries(barsDir, s, "1d");
    if (!a || !b) continue;
    S[s] = prep(a.bars.filter((x) => x.t >= from), b.bars.filter((x) => x.t >= from - 400 * 86400000));
  }
  return S;
}

/* =====================================================================
   البناء — دالّةٌ في (الشموع المغلقة، حدّ الساعة) وحدهما. `prev` لا يُقرأ إلا
   ليُعرف هل هذه الساعة بُنيت أصلاً (فلا تتبدّل اللقطة داخل ساعتها).
   ===================================================================== */
export function build({ now = Date.now(), out = OUT, barsDir, book, fresh = false } = {}) {
  book = book || (path.basename(out) === "crypto" ? "crypto" : "stocks");
  barsDir = barsDir || storeDir(out);
  const ver = engineVersion();
  const H = book === "crypto" ? cryptoHourAt(now) : stockSlotAt(now);
  if (!H) return { ok: false, why: "لا حدّ لقطة" };
  const prev = fresh ? null : readJ(path.join(out, "trades.json"));
  if (prev && prev.mode === "hourly" && prev.version === ver && prev.hour === Math.round(H / 1000))
    return { ok: true, same: true, doc: prev, why: "نفس الساعة — اللقطة ثابتة حتى الحدّ التالي" };

  const S = loadBook(book, out, barsDir, now);
  const syms = Object.keys(S);
  if (!syms.length) return { ok: false, why: "لا شموع" };
  /* طزاجة الرمز: شمعتُه الأخيرة المغلقة من جلسة الساعة نفسها (الأسهم) أو من
     الساعة الأخيرة (الكريبتو) — رمزٌ متوقّف لا يُقيَّم على شموعٍ قديمة. */
  let refDay = 0;
  if (book !== "crypto") for (const s of syms) {
    const r = S[s].r15; let i = r.length - 1;
    while (i >= 0 && r[i].end > H) i--;
    if (i >= 0) refDay = Math.max(refDay, r[i].d);
  }
  const open = [], bySym = {}, rej = {};
  for (const s of syms) {
    const { i, r } = evalHour(S[s], H);
    if (i < 0) { rej.data = (rej.data || 0) + 1; continue; }
    const bar = S[s].r15[i];
    const fresh1 = book === "crypto" ? bar.end > H - 3600000 : bar.d === refDay;
    if (!fresh1) { rej.stale = (rej.stale || 0) + 1; continue; }
    if (r.st) bySym[s] = stateRow(r.st);
    /* قرار المالك 2026-10-01: لا فرصة بلا تداولٍ في آخر 15 دقيقة. في التداول الممتد قد
       لا يُتداول السهم ساعتين، فتكون آخر شمعةٍ مغلقة أقدم من شمعة اللقطة ويُعرض دخولٌ عمره
       ساعتان على أنه «الآن» (قِيس: CDNS دخول 321.22 من 06:30 في لقطة 08:45، والصفقة التالية
       327). تُستبعد الفرصة وحدها — التحليل في bySym باقٍ — وتعود من تلقاء نفسها في أوّل
       لقطةٍ شمعتُها الأخيرة فيها تداول، لأن كلَّ لقطةٍ تُبنى من الصفر. المحرّك لم يُمسّ. */
    if (!r.reject && bar.t !== H - M15) { rej.notrade = (rej.notrade || 0) + 1; continue; }
    rej[r.reject || "ok"] = (rej[r.reject || "ok"] || 0) + 1;
    if (!r.reject) open.push(pubOpp(s, H, r.sig, bar));
  }
  open.sort((a, b) => (b.score - a.score) || (a.s < b.s ? -1 : 1));
  // مفتاح الشمعة = بداية آخر شمعة 15د مغلقة عند الحدّ (على شبكة ربع الساعة)
  const doc = { engine: "v3", mode: "hourly", book, version: ver, generatedAt: new Date(now).toISOString(),
    hour: Math.round(H / 1000), candleKey: Math.round((H - M15) / 1000), weights: E.E3.W,
    count: open.length, open, closed: [], bySym, stats: rej };
  doc.rowsHash = crypto.createHash("sha256").update(JSON.stringify({ open, bySym })).digest("hex").slice(0, 12);
  if (prev && prev.version === ver && prev.hour > doc.hour)
    return { ok: false, why: `ساعةٌ أقدم ${doc.hour} < ${prev.hour}` };
  return { ok: true, doc };
}

function writeAtomic(file, doc) {
  const tmp = path.join(path.dirname(file), "." + path.basename(file) + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, file);
}

function selfCheck() {
  const W = E.E3.W, sum = W.day + W.ma + W.trend + W.vwap + W.week;
  if (Math.abs(sum - 100) > 1e-9) throw new Error("مجموع الأوزان ليس 100");
  const ev = (o, c) => E.crossEvents({ o, c }, 100, 90, "pd");
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m + ": " + JSON.stringify(a)); };
  eq(ev(99, 101), ["pdh_break"], "كسر قمة");
  eq(ev(100, 101), ["pdh_break"], "كسر قمة من عندها");
  eq(ev(101, 102), [], "فوق القمة أصلاً");
  eq(ev(89, 91), ["pdl_reclaim"], "استعادة قاع");
  eq(ev(90, 91), [], "من القاع نفسه ليس استعادة");
  eq(ev(91, 89), ["pdl_break"], "كسر قاع");
  eq(ev(101, 99), ["pdh_loss"], "فقد قمة");
  eq(ev(95, 96), [], "داخل النطاق");
  console.log("✓ build-trades --check");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) { selfCheck(); process.exit(0); }
  const r = build({ book: arg("book") });
  if (!r.ok) { console.error("✗ build-trades: " + r.why); process.exit(1); }
  if (r.same) { console.log(`= trades.json: ${r.why} (${new Date(r.doc.hour * 1000).toISOString()})`); process.exit(0); }
  writeAtomic(path.join(OUT, "trades.json"), r.doc);
  try { fs.rmSync(path.join(OUT, "trades-state.json"), { force: true }); } catch { /* لا حالة بعد اليوم */ }
  console.log(`✓ trades.json (${r.doc.book}) · ساعة ${new Date(r.doc.hour * 1000).toISOString()} · فرص ${r.doc.open.length} · ${JSON.stringify(r.doc.stats)} · ${r.doc.rowsHash}`);
}
