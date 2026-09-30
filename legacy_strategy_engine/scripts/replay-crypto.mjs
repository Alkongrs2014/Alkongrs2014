#!/usr/bin/env node
/* =====================================================================
   إعادة تشغيل دفتر الكريبتو على شموعٍ ماضية — **نفس المحرّك** لا نسخة.

   لكل شمعة ‎5د‎ في النافذة: تُقصّ كلُّ سلسلةٍ إلى ما أُغلق عندها (لا نظرة
   إلى المستقبل)، ثم `analyzeRec`/`buildRow`/`regimeOf` من `fetch-crypto`،
   ثم `runOnce` من `track-strategies`، ثم `buildSnapshot` من
   `build-opportunities` — كلُّها بقارئٍ في الذاكرة. والحالة (النطاقات،
   صفوف الاستراتيجيات وإمساكها، لقطة الفرص ودورة حياتها) تُحمل من شمعةٍ إلى
   التالية كما في الإنتاج.

   `--engine=PATH` يقارن محرّكاً آخر للّقطة على **نفس المدخلات** (مثلاً
   نسخة ما قبل الإصلاح محفوظةً في `scripts/`) — فالفرق فرقُ المنطق وحده.

   يُشغَّل:  node scripts/replay-crypto.mjs --from=ISO --to=ISO [--engine=./x.mjs] [--out=f.json]
   ===================================================================== */
process.env.BOOK = "crypto";
process.env.OPP_BAR_SEC = "300";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = path.join(ROOT, "data", "crypto");
const arg = (k, d = null) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const FROM = Date.parse(arg("from")), TO = Date.parse(arg("to"));
const ENGINE = arg("engine", "./build-opportunities.mjs");
const OUTF = arg("out");
if (!Number.isFinite(FROM) || !Number.isFinite(TO)) { console.error("--from و--to مطلوبان"); process.exit(2); }

const FC = await import("./fetch-crypto.mjs");
const TS = await import("./track-strategies.mjs");
const BO = await import(pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ENGINE)).href);

const LV = (/LIFE_V = "([^"]+)"/.exec(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ENGINE), "utf8")) || [])[1] || null;
const U = JSON.parse(fs.readFileSync(path.join(C, "universe.json"), "utf8")).rows;
const BAR = { "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
const FULL = {};
for (const u of U) { try { FULL[u.s] = JSON.parse(fs.readFileSync(path.join(C, "sym", u.s + ".json"), "utf8")); } catch { /* بلا ملف */ } }

const bands = {};
let stratPrev = { rows: [] }, oppPrev = null;
const perCandle = [];
const t0 = Date.now();
for (let k = Math.floor(FROM / 3e5) * 3e5; k <= TO; k += 3e5) {
  const now = k + 3e5 + 60e3;                 // الجلب بعد إغلاق الشمعة بدقيقة كما في المجدول
  const recs = {}, rows = [];
  for (const u of U) {
    const F = FULL[u.s];
    if (!F) continue;
    const rec = { s: u.s, ar: u.ar, en: u.en, sec: u.sec, mkt: "crypto", src: "binance", tf: {} };
    // المغلق عند `now` وحده — والجارية لا تُمرَّر أصلاً
    for (const [tf, o] of Object.entries(F.tf || {})) {
      const c = o.c.filter(b => b[0] * 1000 + BAR[tf] <= now);
      if (c.length) rec.tf[tf] = { updated: now, c };
    }
    if (!rec.tf["5m"] || !rec.tf["4h"]) continue;
    FC.analyzeRec(rec, now, bands[u.s]);
    bands[u.s] = rec.band;
    recs[u.s] = rec;
    rows.push(FC.buildRow(rec, u, null, now));
  }
  const regime = FC.regimeOf(recs["BTC-USD"], rows);
  const summary = { updated: now, rows };
  const io = (rel, d = null) => {
    if (rel === "summary.json") return summary;
    if (rel === "wide.json") return { rows: [] };
    if (rel === "strategies.json") return stratPrev;
    if (rel === "strat-signals.json" || rel === "strat-history.json") return { records: [] };
    if (rel === "strategy-edge.json") return null;
    if (rel === "market.json") return { regime };
    if (rel === "opportunities.json") return oppPrev;
    if (rel === "signals.json" || rel === "fundamentals.json") return d;
    const m = /^sym\/(.+)\.json$/.exec(rel);
    if (m) return recs[m[1]] || d;
    return d;
  };
  const res = TS.runOnce({ now, io });
  stratPrev = { confBar: res.confBar, rows: res.rows, hold: res.holdNext };
  const snap = BO.buildSnapshot(now, { rd: (f) => io(f), sym: (s) => recs[s] || null });
  if (!snap.ok) { perCandle.push({ k: k / 1000, skip: snap.why }); continue; }
  const d = BO.decide ? BO.decide(snap, oppPrev) : { write: true };
  if (d.write) oppPrev = { candleKey: snap.candleKey, rowsHash: snap.rowsHash, strategyVersion: snap.strategyVersion,
                           scans: snap.scans, life: snap.life, bySym: snap.bySym, lifeV: LV, sources: { depth: snap.depth } };
  const slim = (r) => ({ s: r.s, sd: r.sd, q: r.q, q0: r.q0, adj: r.adj, scs: r.scs, n: r.n, fk: r.fk ?? null, since: r.since ?? null,
                         hit: r.hit ?? 0, pc: r.pc, e: r.e, st: r.st, t: r.t, ba: r.ba ?? null, ext: r.ext ?? null, rr: r.rr ?? null });
  perCandle.push({ k: snap.candleKey, best: (snap.scans.best || []).map(slim),
    scans: Object.fromEntries(Object.entries(snap.scans).filter(([id]) => id !== "best").map(([id, v]) => [id, v.map(slim)])),
    ended: (snap.ended || []).map(L => ({ key: L.key, since: L.since, shown: L.shown, end: L.end, hit: L.hit, t: (L.t || []).length,
                                            px0: L.px0, mfe: L.mfe, mae: L.mae, ba0: L.ba0 ?? null, d: L.d })),
    regime: regime.score });
  if (perCandle.length % 24 === 0) console.log(`  ${new Date(k).toISOString().slice(5, 16)} · ${((Date.now() - t0) / 1000).toFixed(0)}ث`);
}
const out = { engine: ENGINE, from: FROM, to: TO, candles: perCandle };
if (OUTF) fs.writeFileSync(OUTF, JSON.stringify(out));
console.log(`✔ ${perCandle.length} شمعة · ${((Date.now() - t0) / 1000).toFixed(0)}ث`);
