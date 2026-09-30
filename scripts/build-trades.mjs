#!/usr/bin/env node
/* =====================================================================
   المسار الحيّ للمحرّك V3 ← data/trades.json (docs/ENGINE_V3_SPEC.md)

   يقرأ مخزن Alpaca SIP (يحدّثه fetch-market في نفس الدورة) ويمشي كلَّ شمعة
   15د رسمية أُغلقت منذ آخر تشغيل بنفس `advanceSym` التي يمشيها التقييم
   التاريخي. فالصفقة المعروضة هي الصفقة المقيسة.

   الحالة (الصفقات القائمة والمغلقة حديثاً) محفوظةٌ في الملفّ نفسه وتتقدّم
   بالشموع المغلقة وحدها: تشغيلان داخل نفس الشمعة يعطيان نفس الملفّ. وتغيّرُ
   نسخة الشيفرة يعيد البناء من نافذة إحماءٍ ثابتة (خمس جلسات).

   --out DIR   مجلّد البيانات (افتراضياً data)
   --check     فحصٌ ذاتي بلا شبكة
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readSeries, storeDir } from "./lib/bars-store.mjs";
import { prep, advanceSym, stateAtIdx, dayKeyOf } from "./lib/engine3-run.mjs";

const require = createRequire(import.meta.url);
const E = require("../stocks/engine3.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg("out", path.join(ROOT, "data")));
const FILE = path.join(OUT, "trades.json");
/* الحالة الداخلية الكاملة (الصفقات بحقولها) — لا تُنشر؛ trades.json هو المنشور */
const STATE = path.join(OUT, "trades-state.json");
const M15 = 15 * 60000, KEEP_DAYS = 150, WARM_SESS = 5, CLOSED_SESS = 10;

/* نسخة المحرّك: بصمة الشيفرة التي تشكّل القرار (نصٌّ موحّد النهايات) */
export function engineVersion() {
  const h = crypto.createHash("sha256");
  for (const f of ["stocks/engine3.js", "scripts/lib/engine3-run.mjs", "scripts/build-trades.mjs"])
    h.update(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n"));
  return h.digest("hex").slice(0, 12);
}
const r4 = (x) => x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4;
const r2 = (x) => x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100;

/* ما يُنشر من الصفقة — أرقامٌ مقرّبة للعرض، والحالة الداخلية كاملةً في `_` */
function pub(tr) {
  return { id: tr.id, s: tr.s, d: tr.d, status: tr.status, t: Math.round(tr.t / 1000),
    base: tr.base, evt: tr.evt || null, weekEvt: tr.weekEvt || null,
    el: tr.el, pts: tr.pts, score: tr.score,
    e: r4(tr.e), st: r4(tr.st), stNow: r4(tr.stNow ?? tr.st), risk: r4(tr.risk), rr1: r2(tr.rr1),
    tg: tr.tg.map(x => ({ p: r4(x.p), src: x.src })), hit: tr.hit || 0,
    fill: tr.fill ? { t: Math.round(tr.fill.t / 1000), px: r4(tr.fill.px) } : null,
    end: tr.end ? { k: tr.end.k, t: Math.round(tr.end.t / 1000), px: r4(tr.end.px) } : null,
    sess: tr.sess ?? null, ma: tr.ma, trend: tr.trend, trendTf: tr.trendTf, vwap: r4(tr.vwap),
    pdh: r4(tr.pdh), pdl: r4(tr.pdl), pwh: r4(tr.pwh), pwl: r4(tr.pwl), atrD: r4(tr.atrD) };
}
function canon(doc) {
  return JSON.stringify({ open: doc.open.map(x => x.id + JSON.stringify(x)).sort(), closed: doc.closed.map(x => x.id + JSON.stringify(x)).sort(), bySym: doc.bySym });
}

export function build({ now = Date.now(), out = OUT, barsDir = storeDir(out), fresh: forceFresh = false } = {}) {
  const U = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
  const syms = U.symbols.map(x => x.s).slice(0, U.top || 50);
  const ver = engineVersion();
  let prev = null;
  if (!forceFresh) try { prev = JSON.parse(fs.readFileSync(path.join(out, "trades-state.json"), "utf8")); } catch { /* أوّل تشغيل */ }

  const from = now - KEEP_DAYS * 86400000;
  const S = {};
  for (const s of syms) {
    const a = readSeries(barsDir, s, "15m"), b = readSeries(barsDir, s, "1d");
    if (!a || !b) continue;
    S[s] = prep(a.bars.filter(x => x.t >= from), b.bars.filter(x => x.t >= from - 400 * 86400000));
  }
  // ساعة الشمعة: آخر نهاية شمعة رسمية أُغلقت فعلاً عبر الكون
  let T = 0;
  for (const s in S) { const r = S[s].r15; for (let i = r.length - 1; i >= 0; i--) if (r[i].end <= now) { T = Math.max(T, r[i].end); break; } }
  if (!T) return { ok: false, why: "لا شموع في المخزن" };

  const fresh = !prev || prev.version !== ver || !Number.isFinite(prev.lastEnd);
  if (!fresh && prev.lastEnd >= T) return { ok: true, same: true, doc: prev, why: "لا شمعة جديدة" };

  // نافذة الإحماء عند البناء من الصفر: بداية الجلسة قبل خمس جلسات
  const days = [...new Set(Object.values(S)[0].r15.filter(b => b.end <= T).map(b => b.d))];
  const warmDay = days[Math.max(0, days.length - 1 - WARM_SESS)];
  const warmStart = Object.values(S)[0].r15.find(b => b.d === warmDay).t;
  const after = fresh ? warmStart : prev.lastEnd;
  const openIn = fresh ? {} : (prev.open || {});
  const closedIn = fresh ? [] : (prev.closed || []);

  const open = {}, closed = closedIn.slice(), bySym = {}, nowBy = {};
  for (const s of syms) {
    if (!S[s]) continue;
    const r = advanceSym(s, S[s], after, T, openIn[s] ? structuredClone(openIn[s]) : null);
    closed.push(...r.closed);
    if (r.open) open[s] = r.open;
    // حالة الرمز الآن — للعرض والتحذيرات، لا تُنشئ صفقة
    const ri = S[s].r15;
    let i = ri.length - 1;
    while (i >= 0 && ri[i].end > T) i--;
    if (i < 0 || ri[i].end !== T) continue;
    const st = stateAtIdx(S[s], i);
    if (!st) continue;
    bySym[s] = { px: r4(st.px), ma: st.ma.dir, trend: st.trend.dir, trendTf: st.trend.tf,
      vwap: r4(st.vwap), pdh: r4(st.pd && st.pd.h), pdl: r4(st.pd && st.pd.l),
      pwh: r4(st.pw && st.pw.h), pwl: r4(st.pw && st.pw.l),
      day: st.day ? { evt: st.day.evt, d: st.day.d, holds: st.day.holds } : null,
      week: st.week ? { evt: st.week.evt, d: st.week.d, holds: st.week.holds } : null,
      up: E.scoreFor(st, 1).score, dn: E.scoreFor(st, -1).score };
    /* التوافق الحاليّ للتحذير — للعرض وحده، لا يُحفظ في حالة الصفقة: حفظُه كان
       يُبقيه عالقاً على الصفقة بعد إغلاقها فيختلف البناء التزايديّ عن المتواصل */
    if (r.open) { const cur = E.scoreFor(st, r.open.d); nowBy[s] = { score: cur.score, el: cur.el, t: Math.round(st.t / 1000) }; }
  }
  // المغلقة الحديثة وحدها: آخر عشر جلسات بتاريخ الانتهاء
  const keepDay = days[Math.max(0, days.length - CLOSED_SESS)];
  const closedKeep = closed.filter(t => t.end && dayKeyOf(t.end.t) >= keepDay);

  const rank = (a, b) => (b.score - a.score) || (b.t - a.t) || (a.s < b.s ? -1 : 1);
  const doc = {
    engine: "v3", version: ver, generatedAt: new Date(now).toISOString(),
    candleKey: Math.round((T - M15) / 1000),
    weights: E.E3.W,
    count: Object.keys(open).length,
    open: Object.values(open).sort(rank).map((t) => ({ ...pub(t), now: nowBy[t.s] || null })),
    closed: closedKeep.sort((a, b) => b.end.t - a.end.t).map(pub),
    bySym
  };
  doc.rowsHash = crypto.createHash("sha256").update(canon(doc)).digest("hex").slice(0, 12);
  const state = { version: ver, candleKey: doc.candleKey, lastEnd: T, rowsHash: doc.rowsHash, open, closed: closedKeep };
  // حارس الرتابة: لا مفتاح أقدم، ولا بصمة أخرى لنفس المفتاح بنفس النسخة
  if (prev && prev.version === ver && prev.candleKey > doc.candleKey)
    return { ok: false, why: `مفتاحٌ أقدم ${doc.candleKey} < ${prev.candleKey}` };
  return { ok: true, doc, state };
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
  const r = build();
  if (!r.ok) { console.error("✗ build-trades: " + r.why); process.exit(1); }
  if (r.same) { console.log(`= trades.json: ${r.why} (${r.doc.candleKey})`); process.exit(0); }
  writeAtomic(FILE, r.doc);
  writeAtomic(STATE, r.state);
  console.log(`✓ trades.json · شمعة ${new Date(r.doc.candleKey * 1000).toISOString()} · مفتوحة ${r.doc.open.length} · مغلقة حديثاً ${r.doc.closed.length} · ${r.doc.rowsHash}`);
}
