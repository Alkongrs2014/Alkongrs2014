/* =====================================================================
   مقارنة الإنتاج بالمرجع — على بياناتٍ حقيقية.

   هذا الملفّ **المقارِن** لا المرجع: يستورد الإنتاج (ليقارنه) والمرجعَ
   (ليقارن به). والمرجعُ نفسه لا يستورد شيئاً من الإنتاج.

   ثلاث طبقات:
     ١) المؤشّرات والنتيجة لكل فريم: `analyze` مقابل `analyzeRef` على نفس
        الشمعات المغلقة بنفس ساعة الشمعة.
     ٢) ما **نُشر فعلاً**: `summary.json` (score · tfScore) مقابل إعادة
        حسابه بالمرجع من ملفّ الرمز — «هل الرقم المعروض صحيح؟».
     ٣) الاستراتيجيات العشر المؤكَّدة: `evalAllConfirmed` مقابل `evalAllRef`
        على نفس السجلّ، ثم الإجماع ودرجة التوافق من النتيجتين.
   ===================================================================== */
import { createRequire } from "node:module";
import * as R from "./engine.mjs";
import { closedRef, isNum } from "./math.mjs";

const require = createRequire(import.meta.url);
const IND = require("../../stocks/indicators.js");
const SC = require("../../stocks/score.js");
const S = require("../../stocks/strategies.js");
const CONS = require("../../stocks/consensus.js");
const CF = require("../../stocks/confluence.js");
const P = require("../../stocks/plan.js");

export const AN_FIELDS = ["px", "e20", "e50", "e200", "rsi", "hist", "histPrev", "atr", "bbUp", "bbLo",
  "bbMid", "adx", "pdi", "mdi", "bbw", "squeeze", "mfi", "stochK", "stochD", "obvSlope", "score"];

/* تساوٍ عدديّ نسبيّ — `null` يساوي `null` وحده. */
export function near(a, b, rel = 1e-9, abs = 1e-9) {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (!isNum(a) || !isNum(b)) return Object.is(a, b);
  return Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
}

/* ساعة الشمعة كما في `fetch-market`/`track-strategies`: نهايةُ آخر ‎15د‎ مغلقة. */
export function candleClockRef(rec, now) {
  const cc = rec && rec.tf && rec.tf["15m"] && rec.tf["15m"].c;
  if (!cc || cc.length < 2) return now;
  const k = closedRef(cc, "15m", now);
  const t = k.length ? k[k.length - 1][0] * 1000 : null;
  return isNum(t) ? t + 900000 + 1 : now;
}

/* ١) المؤشّرات والنتيجة لكل فريم */
export function compareAnalysis(rec, clock) {
  const diffs = [];
  for (const tf of R.REF.TFS) {
    const raw = rec.tf && rec.tf[tf] && rec.tf[tf].c;
    if (!raw) continue;
    const kP = IND.closedBars(raw, tf, clock).slice(-IND.AN_WIN);
    const kR = closedRef(raw, tf, clock).slice(-R.REF.AN_WIN);
    if (kP.length !== kR.length || (kP.length && kP[kP.length - 1][0] !== kR[kR.length - 1][0])) {
      diffs.push({ tf, field: "closedBars", prod: kP.length, ref: kR.length });
      continue;
    }
    const a = IND.analyze(P.unpackK(kP)), b = R.analyzeRef(R.unpack(kR));
    if (!a || !b) { if (!!a !== !!b) diffs.push({ tf, field: "analyze", prod: !!a, ref: !!b }); continue; }
    for (const f of AN_FIELDS) if (!near(a[f], b[f], 1e-9, 1e-9)) diffs.push({ tf, field: f, prod: a[f], ref: b[f] });
    const dA = a.div ? a.div.dir + ":" + a.div.bars : null, dB = b.div ? b.div.dir + ":" + b.div.bars : null;
    if (dA !== dB) diffs.push({ tf, field: "div", prod: dA, ref: dB });
    if (a.histRising !== b.histRising) diffs.push({ tf, field: "histRising", prod: a.histRising, ref: b.histRising });
  }
  return diffs;
}

/* ٢) ما نُشر في `summary.json` مقابل إعادة حسابه بالمرجع.
   `score` مقرَّبٌ لخانتين (r2) و`tfScore` لخانة (toFixed(1)) عند الكتابة. */
export function comparePublishedScore(rec, row, fileTime) {
  const clock = candleClockRef(rec, fileTime);
  const byTf = {};
  for (const tf of R.REF.TFS) {
    const raw = rec.tf && rec.tf[tf] && rec.tf[tf].c;
    if (!raw) continue;
    const a = R.analyzeRef(R.unpack(closedRef(raw, tf, clock).slice(-R.REF.AN_WIN)));
    if (a) byTf[tf] = a;
  }
  const out = [];
  const overall = R.overallRef(byTf);
  const r2 = (x) => Math.round(x * 100) / 100;
  if (isNum(row.score) || isNum(overall)) {
    if (!(isNum(row.score) && isNum(overall) && Math.abs(r2(overall) - row.score) <= 0.011))
      out.push({ field: "score", published: row.score, ref: isNum(overall) ? r2(overall) : null });
  }
  for (const tf of R.REF.TFS) {
    const pub = row.tfScore && row.tfScore[tf];
    const ref = byTf[tf] ? +byTf[tf].score.toFixed(1) : undefined;
    if ((pub ?? null) === null && ref === undefined) continue;
    if (!(isNum(pub) && isNum(ref) && Math.abs(pub - ref) <= 0.051))
      out.push({ field: "tfScore." + tf, published: pub ?? null, ref: ref ?? null });
  }
  if (isNum(row.band)) {
    /* النطاق بهيستريسس — لا يُقاس إلا حدُّه: النطاق المنشور يجب أن يكون
       ممكناً من النتيجة (على بُعد خطوةٍ بهامشها على الأكثر). */
    const b = R.bandRef(row.score);
    if (b !== null && Math.abs(b - row.band) > 1) out.push({ field: "band", published: row.band, ref: b });
    if (b !== null && b !== row.band) {
      const edge = row.band > b ? R.REF.BANDS[row.band - 1] - R.REF.BAND_MARGIN : R.REF.BANDS[row.band] + R.REF.BAND_MARGIN;
      const ok = row.band > b ? row.score > edge : row.score < edge;
      if (!ok) out.push({ field: "band-hysteresis", published: row.band, score: row.score });
    }
  }
  return out;
}

/* ٣) الاستراتيجيات العشر المؤكَّدة + الإجماع */
export function compareStrategies({ rec, row, now, cnow, sess, win, sessOf, holdBy, edge }) {
  const levelsAt = (px, { k, an, now: nw }) => P.levelsFrom({
    k4h: k["4h"], k1d: k["1d"], px, a: an["4h"] || an["1d"] || null,
    w52h: row && row.w52h, w52l: row && row.w52l, now: nw });
  const c = S.buildCtx({ rec, row, now, px: row.p, sess, win, cnow, sessOf });
  const prod = S.STRATEGIES.map((st) => S.evalStrategy(st, S.confirmCtx(st, c),
    { hold: (holdBy && holdBy[st.id]) || {} }));
  const base = R.confirmedCtxRef({ rec, row, now, cnow, sess, win, sessOf, levelsAt });
  const ref = base ? R.evalAllRef(base, holdBy || {}) : [];
  const diffs = [];
  for (const p of prod) {
    const r = ref.find((x) => x.id === p.id) || { dir: 0, sc: null, off: "missing" };
    const pOff = !!p.off, rOff = !!r.off;
    if (pOff !== rOff) { diffs.push({ id: p.id, field: "off", prod: p.off, ref: r.off }); continue; }
    if ((p.dir || 0) !== (r.dir || 0)) diffs.push({ id: p.id, field: "dir", prod: p.dir, ref: r.dir });
    if ((p.sc ?? null) !== (r.sc ?? null)) diffs.push({ id: p.id, field: "sc", prod: p.sc, ref: r.sc,
      gatesP: p.g, gatesR: r.g });
    if (!!p.active !== !!r.active) diffs.push({ id: p.id, field: "active", prod: p.active, ref: r.active });
  }
  const cP = CONS.consensusOf(prod, { edge }), cR = R.consensusRef(ref, { edge });
  if (cP.k !== cR.k || cP.dir !== cR.dir) diffs.push({ id: "consensus", field: "k/dir", prod: cP.k + "/" + cP.dir, ref: cR.k + "/" + cR.dir });
  if (!near(cP.up, cR.up) || !near(cP.dn, cR.dn)) diffs.push({ id: "consensus", field: "mass", prod: [cP.up, cP.dn], ref: [cR.up, cR.dn] });
  const sP = CF.scsFrom(cP), sR = R.scsRef(cR);
  if (!near(sP.scs, sR.scs) || sP.pct !== sR.pct) diffs.push({ id: "scs", field: "scs/pct", prod: [sP.scs, sP.pct], ref: [sR.scs, sR.pct] });
  return { diffs, prod, ref };
}
