#!/usr/bin/env node
/* =====================================================================
   إعادة تشغيل محرّك الأسهم **الحالي كما هو** على تاريخ Alpaca SIP.

   قراءةٌ وحدها — لا يكتب إلا ملفّ ناتجه. ولا نسخةَ ثانية من المنطق:
   الفريمات من `applyStore` (مسار الإنتاج نفسه) و‎4h‎ من `aggregate`،
   والتحليل على `closedBars` بساعة الشمعة، ثم **`track-strategies.runOnce`**
   (الاستراتيجيات العشر وإجماعها وهيستريسس الاتجاه بحالتها المنقولة بين
   الخطوات)، ثم **`build-opportunities.buildSnapshot` / `decide`** (المسوح
   والترتيب ودورة الحياة). وهو الفرق عن `replay-opps.mjs` الذي لا يعيد
   الإجماع.

   ساعةٌ افتراضية: خطوةٌ بعد إغلاق كل شمعة ‎15د‎ رسمية بثلاث دقائق (موعد
   Confirm). ولا يُقرأ عند الخطوة إلا ما بدأ قبلها، والجاريةُ يُسقطها
   `closedBars` كما في الإنتاج.

   حدودٌ معلنة (تُطبع في الناتج):
   · الأساسيات: `avgVol` من اليومي حتى الخطوة، و`roe` من ملفّ اليوم (نظرٌ إلى
     المستقبل في `low52` وحده). «أرخص من قطاعه» و«أرباح خلال أسبوع» معطَّلان.
   · `strategy-edge.json` الحالي (أوزان الإجماع كما في الإنتاج اليوم) — مقيسٌ
     على تاريخ ياهو حتى اليوم، فهو نظرٌ إلى المستقبل على الأوزان وحدها.
   · بلا المفتاح النهائي بعد الإغلاق: الخطوات على شمعات الجلسة وحدها.

     node scripts/replay-stocks.mjs --from=2026-06-01 --to=2026-09-29 [--out=f.json] [--symbols=A,B]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readSeries, storeDir } from "./lib/bars-store.mjs";
import { analyze, overallScore, aggregate, bandStable, closedBars, TFS } from "./lib/indicators.mjs";
import { candleClock, K4H } from "./fetch-market.mjs";
import { rp } from "./lib/round.mjs";
import * as TS from "./track-strategies.mjs";
import * as BO from "./build-opportunities.mjs";

const req = createRequire(import.meta.url);
const SES = req("../stocks/session.js");
const { SCANS, scanRow } = req("../stocks/scans.js");
const AN_WIN = req("../stocks/indicators.js").AN_WIN;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const DATA = path.join(ROOT, "data");
const DIR = storeDir(DATA);
const FROM = arg("from"), TO = arg("to");
const OUTF = arg("out", path.join(DATA, ".monitor", `replay-stocks-${FROM}_${TO}.json`));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
const SYMS = arg("symbols") ? arg("symbols").split(",") : cfg.symbols.filter(m => m.mkt !== "crypto").map(m => m.s);
const META = Object.fromEntries(cfg.symbols.map(m => [m.s, m]));
const rjLive = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch { return null; } };
const EDGE = rjLive("strategy-edge.json");
const ROE = rjLive("fundamentals.json")?.f || {};
const KEEP = 260;
const r2 = (x) => Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
const pack = (a) => a.map(b => [Math.round(b.t / 1000), b.o, b.h, b.l, b.c, b.v]);
const nyDate = (t) => SES.etParts(t).date;

/* ما بدأ قبل `T` — بحثٌ ثنائيّ في مصفوفةٍ مرتّبة */
function upto(arr, T) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t < T) lo = m + 1; else hi = m; } return lo; }

console.log(`▶ إعادة المحرّك الحالي على SIP · ${SYMS.length} سهماً · ${FROM} → ${TO}`);
const D = {};
/* =====================================================================
   حسابٌ مسبق مرّةً لكل رمز — **نفس تحويلات `applyStore`** (الرسمية بحجمٍ
   موجب، الساعة على مرسى ‎09:30‎، ‎4h‎ من الساعة، اليومي مطبَّع إلى ‎09:30 ET‎،
   والتقريب `rp`) — ثم يُقصّ عند كل خطوة بالفهرس. وحسابُها في كل خطوة كان
   ‎5‎ ثوانٍ لكل خطوة (تصنيفُ الجلسة لـ‎11‎ ألف شمعة × ‎50‎ رمزاً).
   والدلوُ الأخير (ساعةً و‎4h‎) يُعاد بناؤه من الشمعات قبل الخطوة وحدها:
   المحسوبُ مسبقاً يحمل شمعاتٍ لاحقة داخل الدلو — نظرٌ إلى المستقبل لو مُرِّر.
   ===================================================================== */
const K1H = (t) => SES.sessionBucket(t, 1);
const R = (b) => ({ t: b.t, o: rp(b.o), h: rp(b.h), l: rp(b.l), c: rp(b.c), v: Math.round(b.v) });
const fold = (g) => ({ t: g[0].t, o: g[0].o, h: Math.max(...g.map(x => x.h)), l: Math.min(...g.map(x => x.l)),
                       c: g[g.length - 1].c, v: g.reduce((a, x) => a + (x.v || 0), 0) });
for (const s of SYMS) {
  const a = readSeries(DIR, s, "15m")?.bars, d = readSeries(DIR, s, "1d")?.bars;
  if (!(a?.length && d?.length)) continue;
  const rth = a.filter(x => SES.isRegularBar(x.t) && (x.v || 0) > 0);
  const h1 = aggregate(rth, 1, K1H), h4 = aggregate(h1, 4, K4H);
  D[s] = { m15: a, d1: d, rth, h1, h4, k1: h1.map(b => K1H(b.t)), k4: h4.map(b => K4H(b.t)),
           d1n: d.map(b => R({ ...b, t: SES.atEtMinutes(b.t + 12 * 3600e3, SES.REG_OPEN) })),
           all15R: a.map(R), rthR: rth.map(R) };
}
console.log(`  بيانات ${Object.keys(D).length}/${SYMS.length}`);

/* الخطوات: إغلاق كل شمعة ‎15د‎ رسمية في المدى، من SPY مرجعاً للتقويم الفعلي */
const ref = readSeries(DIR, "SPY", "15m").bars.filter(b => SES.isRegularBar(b.t));
const steps = ref.filter(b => { const d = nyDate(b.t); return d >= FROM && d <= TO; }).map(b => b.t + 15 * 60e3);
console.log(`  ${steps.length} خطوة · ${new Set(steps.map(nyDate)).size} جلسة`);

const band = {};
let stratPrev = { rows: [] }, oppPrev = null;
/* =====================================================================
   الناتج **مجمَّعٌ أثناء التشغيل** لا خطوةً خطوة: على ~400 جلسة (~10,400
   خطوة) كان حفظُ خريطة دورة الحياة والقوائم كاملةً في كل خطوة يبلغ
   غيغابايتات. ولا يُفقد مقياسٌ واحد: كلُّ فرصةٍ فريدة بسماتها لحظةَ ظهورها
   الأولى وآخرِ ظهورٍ وأفضلِ رتبة، والحالةُ الأخيرة لكل دورة حياة من المحرّك
   نفسه، وتفعيلاتُ الاستراتيجيات الجديدة وحدها، وأوّلُ إطلاقٍ لكل شرطٍ في
   كل يوم (قبل الترشيح)، وATR اليومي لكل رمزٍ في كل يوم.
   ===================================================================== */
const opps = {}, lifeFinal = {}, stratEvents = [], fired = {}, atrDay = {};
let prevAct = {}, skips = 0, stepsRun = 0;
const t0 = Date.now();
for (let si = 0; si < steps.length; si++) {
  const T = steps[si], now = T + 3 * 60e3;
  const recs = {}, rows = [], F = {};
  for (const s of Object.keys(D)) {
    const X = D[s];
    /* الحدّ `T` لا `now`: شمعةُ `T` جاريةٌ عند `now` (بدأت قبل ثلاث دقائق)،
       والمحفوظ منها في المخزن قيمتُها **النهائية** — فتمريرُها نظرٌ إلى
       المستقبل. والإنتاج يمرّرها جزئيةً ثم يُسقطها `closedBars`؛ فالمؤكَّد
       واحد. واليومي: يومُ الخطوة جارٍ فلا يُمرَّر. */
    const nR = upto(X.rth, T);
    if (nR < 60) continue;
    const today = nyDate(T);
    const nD = upto(X.d1n, SES.atEtMinutes(Date.parse(today + "T17:00:00Z"), 0));
    if (nD < 60) continue;
    const rthS = X.rthR.slice(Math.max(0, nR - KEEP), nR);
    const lastBucket = (arr, keys, keyOf, srcArr) => {
      const kT = keyOf(T - 1);
      let n = upto(arr, T);
      const out = arr.slice(Math.max(0, n - KEEP - 1), n);
      if (out.length && keys[n - 1] === kT) {
        const g = srcArr.filter(b => b.t >= out[out.length - 1].t && b.t < T);
        out[out.length - 1] = g.length ? fold(g) : out[out.length - 1];
      }
      return out.slice(-KEEP);
    };
    const h1S = lastBucket(X.h1, X.k1, K1H, X.rthR.slice(Math.max(0, nR - 8), nR)).map(R);
    const h4S = lastBucket(X.h4, X.k4, K4H, h1S.slice(-8));
    const rec = { s, ar: META[s]?.ar, en: META[s]?.en, sec: META[s]?.sec, src: "alpaca_sip",
      tf: { "15m": { updated: now, c: rthS }, "1h": { updated: now, c: h1S },
            "4h": { updated: now, c: h4S.map(R), derived: true }, "1d": { updated: now, c: X.d1n.slice(Math.max(0, nD - KEEP), nD) } },
      tfx: { "15m": { updated: now, src: "alpaca_sip", c: X.all15R.slice(Math.max(0, upto(X.m15, T) - KEEP), upto(X.m15, T)) } } };
    const cnow = candleClock(rec, now);
    rec.an = {};
    for (const tf of TFS) {
      const kk = closedBars(rec.tf[tf].c, tf, cnow).slice(-AN_WIN);
      const a = kk.length ? analyze(kk) : null;
      if (a) { const { series, ...rest } = a; rec.an[tf] = rest; }
    }
    rec.score = r2(overallScore(rec.an));
    rec.band = bandStable(rec.score, band[s]);
    band[s] = rec.band;
    const kk15 = closedBars(rec.tf["15m"].c, "15m", cnow), d1c = closedBars(rec.tf["1d"].c, "1d", cnow);
    if (!kk15.length || d1c.length < 60) continue;
    const b = kk15[kk15.length - 1], dd = rec.an["1d"] || {};
    const last252 = d1c.slice(-252), vols = d1c.slice(-20).map(x => x.v);
    const row = {
      s, ar: rec.ar, en: rec.en, sec: rec.sec, p: b.c, pc: b.c, cbar: Math.round(b.t / 1000), ctf: "15m",
      volc: d1c[d1c.length - 1].v, vol: d1c[d1c.length - 1].v, score: rec.score, band: rec.band,
      atr: dd.atr ?? null, rsi: dd.rsi ?? null, e20: dd.e20 ?? null, e50: dd.e50 ?? null, e200: dd.e200 ?? null,
      adx: dd.adx ?? null, pdi: dd.pdi ?? null, mdi: dd.mdi ?? null, squeeze: dd.squeeze ?? null,
      ...(dd.div && dd.div.dir ? { div: dd.div.dir } : {}),
      tfScore: Object.fromEntries(TFS.filter(t => rec.an[t]).map(t => [t, +rec.an[t].score.toFixed(1)])),
      w52h: last252.length >= 200 ? Math.max(...last252.map(x => x.h)) : null,
      w52l: last252.length >= 200 ? Math.min(...last252.map(x => x.l)) : null, src: "alpaca_sip"
    };
    // الملفّ كما يُكتب على القرص: شمعاتٌ مضغوطة
    const packed = { ...rec, tf: {}, tfx: {} };
    for (const [tf, o] of Object.entries(rec.tf)) packed.tf[tf] = { ...o, c: pack(o.c) };
    for (const [tf, o] of Object.entries(rec.tfx || {})) packed.tfx[tf] = { ...o, c: pack(o.c) };
    recs[s] = packed; rows.push(row);
    F[s] = { avgVol: vols.reduce((a, x) => a + x, 0) / vols.length, roe: ROE[s]?.roe };
    for (const sc of SCANS) {
      let ok = false; try { ok = !!sc.test(scanRow(row), F[s], { secMed: {} }); } catch { /* */ }
      if (ok) { const f = (fired[`${s}|${nyDate(T)}`] ||= {}), k = `${sc.id}|${sc.dir === -1 ? -1 : 1}`; if (!(k in f)) f[k] = T; }
    }
  }
  const summary = { updated: now, rows };
  const io = (rel, d = null) => {
    if (rel === "summary.json") return summary;
    if (rel === "wide.json") return { rows: [] };
    if (rel === "strategies.json") return stratPrev;
    if (rel === "strat-signals.json" || rel === "strat-history.json") return { records: [] };
    if (rel === "strategy-edge.json") return EDGE;
    if (rel === "fundamentals.json") return { f: F };
    if (rel === "opportunities.json") return oppPrev;
    if (rel === "signals.json") return { records: [] };
    if (rel === "market.json") return {};
    const m = /^sym\/(.+)\.json$/.exec(rel);
    if (m) return recs[m[1]] || d;
    return d;
  };
  const res = TS.runOnce({ now, io, out: path.join(DATA, ".monitor", "replay-scratch") });
  stratPrev = { confBar: res.confBar, rows: res.rows, hold: res.holdNext };
  {
    const cur = {}, nDir = {};
    for (const r of res.rows) if (r.act) { cur[`${r.s}|${r.st}`] = [r.dir, r.sc]; nDir[`${r.s}|${r.dir}`] = (nDir[`${r.s}|${r.dir}`] || 0) + 1; }
    for (const [k, [dir, sc]] of Object.entries(cur)) {
      if (prevAct[k] && prevAct[k][0] === dir) continue;               // ليس تفعيلاً جديداً
      const [sy, st] = k.split("|");
      stratEvents.push([T, sy, st, dir, sc, nDir[`${sy}|${dir}`]]);
    }
    prevAct = cur;
  }
  const snap = BO.buildSnapshot(now, { rd: (f) => io(f), sym: (s) => recs[s] || null });
  if (!snap.ok) { skips++; continue; }
  stepsRun++;
  const dec = BO.decide ? BO.decide(snap, oppPrev) : { write: true };
  if (dec.write) oppPrev = { candleKey: snap.candleKey, rowsHash: snap.rowsHash, strategyVersion: snap.strategyVersion,
                             pipelineVersion: snap.pipelineVersion, scans: snap.scans, life: snap.life, bySym: snap.bySym,
                             sources: { depth: snap.depth } };
  const day = nyDate(T), rowBy = Object.fromEntries(rows.map(r => [r.s, r]));
  for (const r of rows) if (!((atrDay[r.s] ||= {})[day] > 0) && r.atr > 0) atrDay[r.s][day] = r.atr;
  const bySym = {};
  for (const rs of Object.values(snap.scans)) for (const r of rs) if (!bySym[r.s] || r.q > bySym[r.s].q) bySym[r.s] = r;
  const symOrder = Object.values(bySym).sort((a, b) => b.q - a.q).map(r => r.s);
  for (const [id, rs] of Object.entries(snap.scans)) rs.forEach((r, i) => {
    if (!(r.sd === 1 || r.sd === -1) || !Number.isFinite(r.since)) return;
    const k = `${r.s}|${id}|${r.sd}|${r.since}`;
    const o = opps[k] ||= { s: r.s, scan: id, d: r.sd, since: r.since * 1000, T0: T, px: r.pc, e: r.e, stp: r.st, t: r.t || [],
      q: r.q, q0: r.q0, adj: r.adj, scs: r.scs, n: r.n, cdir: r.cdir, mixed: r.mixed, rank: i, symRank: symOrder.indexOf(r.s),
      score: rowBy[r.s]?.score, band: rowBy[r.s]?.band, atr: rowBy[r.s]?.atr, fr: r.fr, steps: 0, bestRank: i };
    o.steps++; o.lastT = T; o.bestRank = Math.min(o.bestRank, i);
  });
  for (const [lk, L] of Object.entries(snap.life || {}))
    lifeFinal[`${lk}|${L.since}`] = { since: L.since, d: L.d, e: L.e, st: L.st, t: L.t, hit: L.hit, in: L.in, inAt: L.inAt,
      end: L.end, shown: L.shown, px0: L.px0, mfe: L.mfe, mae: L.mae, at: T };
  if ((si + 1) % 26 === 0) console.log(`  ${nyDate(T)} · ${si + 1}/${steps.length} · ${((Date.now() - t0) / 1000).toFixed(0)}ث`);
}
fs.mkdirSync(path.dirname(OUTF), { recursive: true });
const lastT = steps[steps.length - 1];
fs.writeFileSync(OUTF, JSON.stringify({
  engine: { strategyVersion: oppPrev?.strategyVersion, pipelineVersion: oppPrev?.pipelineVersion },
  from: FROM, to: TO, steps: steps.length, symbols: Object.keys(D), generated: Date.now(),
  limits: ["roe من ملفّ اليوم (low52)", "cheap/earn معطّلان", "strategy-edge الحالي (أوزان الإجماع)", "بلا المفتاح النهائي بعد الإغلاق"],
  stepsRun, skips, opps: Object.values(opps), lifeFinal, stratEvents, fired, atrDay,
  /* شموع المتابعة: الجلسة الرسمية بعد المدى بعشرة أيام لقياس النتائج */
  bars: Object.fromEntries(Object.entries(D).map(([s, X]) => [s, X.m15
    .filter(b => SES.isRegularBar(b.t) && nyDate(b.t) >= FROM && b.t <= lastT + 14 * 86400e3)
    .map(b => [b.t, b.o, b.h, b.l, b.c, b.v])])),
  daily: Object.fromEntries(Object.entries(D).map(([s, X]) => [s, X.d1.filter(b => nyDate(b.t + 12 * 3600e3) >= FROM)
    .map(b => [b.t, b.o, b.h, b.l, b.c, b.v])]))
}));
console.log(`✔ ${stepsRun} خطوة (تُخطّي ${skips}) · ${Object.keys(opps).length} فرصة فريدة · ${stratEvents.length} تفعيل · ${((Date.now() - t0) / 1000).toFixed(0)}ث · ${path.relative(ROOT, OUTF)}`);
