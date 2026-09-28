/* =====================================================================
   المحرّك المرجعيّ — النتيجة والتحليل والاستراتيجيات والإجماع والاتجاه.

   مكتوبٌ من `docs/STRATEGY_SPECS.md` (§3–§8) بلا استيرادٍ من الإنتاج.
   ما هو **خارج نطاقه عمداً** يُحقَن مدخلاً لا يُعاد اشتقاقه، ويُقال:
     · `levelsAt(px)`: مجمّع الدعوم والمقاومات (`levelsFrom` في plan.js) —
       مكوّن الخطة، ومغطّى بـ`planSelfTest` (مقارنة ذهبية 28/28).
     · `sessOf(t)` و`win` و`sess`: التقويم (session.js) — مغطّى بـ`check-session`.
   كلُّ ما عداهما — المؤشّرات، البوابات، الجهة، الإمساك، الإجماع — يُحسب هنا.
   ===================================================================== */
import {
  isNum, emaRef, rsiRef, macdRef, bbRef, atrRef, adxRef, stochRef, mfiRef, bbWidthRef,
  rankLastRef, pctLeRef, divergenceRef, obvRef, volumeProfileRef, lastNum,
  vwapRef, openingRangeRef, volMedianRef, closedRef
} from "./math.mjs";

/* ============================ §3 النتيجة ============================ */
export const REF = {
  TFS: ["15m", "1h", "4h", "1d"],
  TFW: { "15m": 0.5, "1h": 1, "4h": 1.5, "1d": 2 },
  DEAD: 0.15,
  BANDS: [-45, -15, 15, 45],
  BAND_MARGIN: 3,
  ACT_MIN: 55, S_BANDS: [55, 70, 85], S_MARGIN: 3, DIR_HOLD: 3,
  MIX: 0.35, CONF_HI: 0.78, CONF_MD: 0.62, W_MIN: 0.4, W_MAX: 1.8,
  SCS_FULL: 3, SCS_FLOOR: 0.35, SCS_W: 0.15, AN_WIN: 259
};

/* تصويتُ بوابة مقارنة: 0 داخل ±tol، وإلا إشارة الفرق. غائبٌ ⇒ null. */
function vote(a, b, tol) {
  if (!isNum(a) || !isNum(b)) return null;
  const d = a - b;
  return Math.abs(d) <= tol ? 0 : Math.sign(d);
}

export function scoreRef(o) {
  const tol = isNum(o.atr) && o.atr > 0 ? o.atr * REF.DEAD : 0;
  const gates = [];
  const add = (v, w) => { if (v !== null) gates.push([v, w]); };
  add(vote(o.px, o.e200, tol), 2.5);
  add(vote(o.e50, o.e200, tol), 1.5);
  add(vote(o.px, o.e20, tol), 1.0);
  if (isNum(o.hist)) {
    add(vote(o.hist, 0, tol), 1.5);
    add(isNum(o.histPrev) ? vote(o.hist, o.histPrev, tol) : (o.histRising ? 1 : -1), 0.5);
  }
  if (isNum(o.rsi)) add(o.rsi > 55 ? 1 : o.rsi < 45 ? -1 : 0, 1.0);
  add(vote(o.px, o.bbMid, tol), 0.5);
  const W = gates.reduce((s, g) => s + g[1], 0);
  if (!(W > 0)) return 0;
  const S = gates.reduce((s, g) => s + g[0] * g[1], 0);
  return Math.max(-100, Math.min(100, S / W * 100));
}

export function overallRef(byTf, tfs = REF.TFS, w = REF.TFW) {
  let s = 0, ws = 0;
  for (const tf of tfs) {
    const a = byTf[tf];
    if (!a || !isNum(a.score)) continue;
    s += a.score * w[tf]; ws += w[tf];
  }
  return ws ? s / ws : null;
}

export function bandRef(sc) {
  if (!isNum(sc)) return null;
  return REF.BANDS.filter((b) => sc >= b).length;
}
export function bandStableRef(sc, prev) {
  const now = bandRef(sc);
  if (now === null) return null;
  if (!isNum(prev) || prev < 0 || prev > 4) return now;
  let b = prev;
  while (b < 4 && sc >= REF.BANDS[b] + REF.BAND_MARGIN) b++;
  while (b > 0 && sc <= REF.BANDS[b - 1] - REF.BAND_MARGIN) b--;
  return b;
}

/* ============================ §1 التحليل ============================ */
export function analyzeRef(k) {
  if (!k || k.length < 30) return null;
  const c = k.map((x) => x.c), h = k.map((x) => x.h), l = k.map((x) => x.l);
  const e20 = lastNum(emaRef(c, 20)), e50 = lastNum(emaRef(c, 50)), e200 = lastNum(emaRef(c, 200));
  const rS = rsiRef(c, 14), m = macdRef(c), b = bbRef(c, 20, 2), aS = atrRef(h, l, c, 14);
  const hs = m.hist.filter((v) => v !== null);
  const histPrev = hs.length > 1 ? hs[hs.length - 2] : null;
  const px = c[c.length - 1];
  const o = { px, e20, e50, e200, rsi: lastNum(rS), hist: lastNum(m.hist), histPrev,
              histRising: hs.length > 1 ? hs[hs.length - 1] > hs[hs.length - 2] : false,
              atr: lastNum(aS), bbUp: lastNum(b.up), bbLo: lastNum(b.lo), bbMid: lastNum(b.mid) };
  o.score = scoreRef(o);
  const ax = adxRef(h, l, c, 14);
  o.adx = lastNum(ax.adx); o.pdi = lastNum(ax.pdi); o.mdi = lastNum(ax.mdi);
  const w = bbWidthRef(c, 20, 2);
  o.bbw = lastNum(w); o.squeeze = rankLastRef(w, 120);
  const dv = divergenceRef(h, l, rS, aS, { lookback: 60 });
  o.div = dv.length ? { dir: dv[0].dir, bars: dv[0].bars, kind: dv[0].kind } : null;
  const v = k.map((x) => x.v || 0);
  const hasVol = v.filter((x) => x > 0).length >= Math.min(30, k.length * 0.5);
  const sk = stochRef(h, l, c, 14, 3);
  o.mfi = hasVol ? lastNum(mfiRef(h, l, c, v, 14)) : null;
  o.stochK = lastNum(sk.k); o.stochD = lastNum(sk.d);
  o.obvSlope = null; o.obvDiv = null;
  if (hasVol && c.length > 25) {
    const ob = obvRef(c, v), n = ob.length;
    const d0 = ob[n - 21], d1 = ob[n - 1];
    o.obvSlope = (d1 - d0) / Math.max(1, Math.abs(d0) || 1) * 100;
    const ps = (c[n - 1] - c[n - 21]) / c[n - 21] * 100;
    if (isNum(ps) && Math.abs(ps) > 2 && Math.abs(o.obvSlope) > 5 && Math.sign(ps) !== Math.sign(o.obvSlope))
      o.obvDiv = ps > 0 ? -1 : 1;
  }
  const vp = hasVol ? volumeProfileRef(k, 24, 120) : null;
  o.poc = vp ? { p: vp.poc, share: vp.share } : null;
  return o;
}

export const unpack = (arr) => (arr || []).map((x) => Array.isArray(x)
  ? { t: x[0] * 1000, o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] } : x);

/* ============================ §5 الاستراتيجيات ============================ */
const tolOf = (atr) => isNum(atr) && atr > 0 ? atr * REF.DEAD : 0;
const signed = (a, b, atr, d) => { const v = vote(a, b, tolOf(atr)); return v === null ? null : v * d; };
function agreeRef(v, d, flat = 0) {
  if (!isNum(v)) return null;
  if (Math.abs(v) <= flat) return 0;
  return Math.sign(v) === d ? 1 : -1;
}
function rangeRef(v, lo, hi) {
  if (!isNum(v)) return null;
  if (v >= lo && v <= hi) return 1;
  const m = (hi - lo) * 0.25;
  return v >= lo - m && v <= hi + m ? 0 : -1;
}
const tier = (x, a, b) => x >= a ? 1 : x >= b ? 0 : -1;          // عالٍ أفضل
const tierLo = (x, a, b) => x <= a ? 1 : x <= b ? 0 : -1;        // منخفضٌ أفضل

function volRatioRef(c, tf) {
  const a = (c.ik && c.ik[tf]) || c.k[tf];
  if (!a || a.length < 8) return null;
  const last = a[a.length - 2];
  if (!last || !isNum(last.v) || !(last.v > 0)) return null;
  let base = a.slice(0, -1);
  if (typeof c.sessOf === "function") {
    const kind = c.sessOf(last.t);
    base = base.filter((x) => c.sessOf(x.t) === kind);
    if (base.length < 8) return null;
  }
  const med = volMedianRef(base, 20);
  return med > 0 ? last.v / med : null;
}
function closePosRef(x) {
  if (!x || !isNum(x.h) || !isNum(x.l) || !(x.h > x.l)) return null;
  return (x.c - x.l) / (x.h - x.l);
}
function donchRef(c, tf, n = 25) {
  const k = c.k[tf];
  if (!k || k.length < n + 4) return null;
  const w = k.slice(-n, -2);
  const hi = Math.max(...w.map((x) => x.h)), lo = Math.min(...w.map((x) => x.l));
  return hi > lo ? { hi, lo } : null;
}
function rangeOf(k, from, to) {
  const w = k.slice(from, to);
  const hi = Math.max(-Infinity, ...w.map((x) => x.h)), lo = Math.min(Infinity, ...w.map((x) => x.l));
  return hi > lo ? { hi, lo } : null;
}

/* اختيار الفريم (§5.0) — بلا تثبيت (`tfPin`) في مسار الفرص. */
const f15 = (c) => c.k["15m"] ? "15m" : c.k["1h"] ? "1h" : c.k["1d"] ? "1d" : null;
const fSq = (c) => c.bw["1h"] ? "1h" : c.bw["4h"] ? "4h" : c.bw["1d"] ? "1d" : null;
const fDiv = (c) => ["1h", "15m", "1d"].find((t) => c.an[t] && c.an[t].div) || null;
const fPbUp = (c) => c.an["4h"] ? "4h" : c.an["1d"] ? "1d" : null;
const dayVote = (c, d) => c.an["1d"] ? agreeRef(c.an["1d"].score, d, 15) : null;
const h1Vote = (c, d) => c.an["1h"] ? agreeRef(c.an["1h"].score, d, 15) : null;
const rsiFor = (r, d) => d > 0 ? r : 100 - r;

export const STRATS_REF = [
  { id: "orb", fam: "session", tfOf: () => "15m",
    ready: (c) => !c.lv.iTf ? "no-intraday" : c.sess === "CLOSED" ? "closed" : !c.win ? "no-win"
      : !c.today ? "not-today" : c.lv.short ? "short" : !c.lv.or ? "no-or" : !c.lv.or.complete ? "or-forming" : null,
    side: (c) => { const a = c.ian[c.lv.iTf], or = c.lv.or; if (!a || !or) return 0;
      const t = tolOf(a.atr); return c.px > or.hi + t ? 1 : c.px < or.lo - t ? -1 : 0; },
    gates: [
      ["orClear", 2.0, "price", (c, d) => { const a = c.ian[c.lv.iTf], or = c.lv.or; if (!a || !or || !(a.atr > 0)) return null;
        return tier((c.px - (d > 0 ? or.hi : or.lo)) * d / a.atr, 0.4, 0.2); }],
      ["orChase", 1.5, "price", (c, d) => { const a = c.ian[c.lv.iTf], or = c.lv.or; if (!a || !or || !(a.atr > 0)) return null;
        return tierLo((c.px - (d > 0 ? or.hi : or.lo)) * d / a.atr, 1.5, 2.5); }],
      ["vwapSide", 2.0, "price", (c, d) => { const a = c.ian[c.lv.iTf]; return c.lv.vwap && a ? signed(c.px, c.lv.vwap.vwap, a.atr, d) : null; }],
      ["orWidth", 1.0, "ind", (c) => { const a = c.ian[c.lv.iTf], or = c.lv.or; if (!a || !or || !(a.atr > 0)) return null;
        return rangeRef((or.hi - or.lo) / a.atr, 0.8, 5); }],
      ["volConf", 1.5, "ind", (c) => { const x = volRatioRef(c, c.lv.iTf); return x === null ? null : tier(x, 1.3, 0.8); }],
      ["h1Trend", 1.0, "ind", h1Vote],
      ["dayTrend", 1.0, "ind", dayVote]] },

  { id: "vwapRec", fam: "session", tfOf: () => "15m",
    ready: (c) => !c.lv.iTf ? "no-intraday" : c.sess === "CLOSED" ? "closed" : !c.win ? "no-win"
      : !c.today ? "not-today" : !c.lv.vwap ? "no-vwap" : null,
    side: (c) => { const a = c.ian[c.lv.iTf], vw = c.lv.vwap, k = c.ik[c.lv.iTf]; if (!a || !vw || !k) return 0;
      const t = tolOf(a.atr), r = k.slice(-6);
      if (c.px > vw.vwap + t && r.some((x) => x.c < vw.vwap)) return 1;
      if (c.px < vw.vwap - t && r.some((x) => x.c > vw.vwap)) return -1; return 0; },
    gates: [
      ["vwDist", 2.0, "price", (c, d) => { const a = c.ian[c.lv.iTf]; if (!a || !(a.atr > 0) || !c.lv.vwap) return null;
        return tierLo((c.px - c.lv.vwap.vwap) * d / a.atr, 1, 2); }],
      ["vwBand", 1.5, "price", (c, d) => { const vw = c.lv.vwap, a = c.ian[c.lv.iTf]; if (!vw || !a) return null;
        return signed(d > 0 ? vw.upper : vw.lower, c.px, a.atr, d); }],
      ["vwTrend", 1.5, "ind", (c, d) => { const a = c.ian[c.lv.iTf]; return a && c.lv.vwap ? signed(a.e20, c.lv.vwap.vwap, a.atr, d) : null; }],
      ["volConf", 1.5, "ind", (c) => { const x = volRatioRef(c, c.lv.iTf); return x === null ? null : tier(x, 1.2, 0.7); }],
      ["h1Trend", 1.5, "ind", h1Vote],
      ["rsiRoom", 1.0, "ind", (c, d) => { const a = c.ian[c.lv.iTf]; if (!a || !isNum(a.rsi)) return null; return tierLo(rsiFor(a.rsi, d), 65, 75); }],
      ["dayTrend", 1.0, "ind", dayVote]] },

  { id: "brk", fam: "trend", tfOf: f15,
    ready: (c) => f15(c) ? null : "no-intraday",
    side: (c) => { const tf = f15(c), a = c.an[tf], dn = donchRef(c, tf); if (!a || !dn) return 0;
      const t = tolOf(a.atr); return c.px > dn.hi + t ? 1 : c.px < dn.lo - t ? -1 : 0; },
    gates: [
      ["brkClear", 2.5, "price", (c, d) => { const tf = f15(c), a = c.an[tf], dn = donchRef(c, tf); if (!a || !dn || !(a.atr > 0)) return null;
        return tier((c.px - (d > 0 ? dn.hi : dn.lo)) * d / a.atr, 0.35, 0.18); }],
      ["brkChase", 1.5, "price", (c, d) => { const tf = f15(c), a = c.an[tf], dn = donchRef(c, tf); if (!a || !dn || !(a.atr > 0)) return null;
        return tierLo((c.px - (d > 0 ? dn.hi : dn.lo)) * d / a.atr, 1.8, 3); }],
      ["brkVol", 2.0, "ind", (c) => { const x = volRatioRef(c, f15(c)); return x === null ? null : tier(x, 1.5, 1); }],
      ["brkClose", 1.5, "ind", (c, d) => { const k = c.k[f15(c)]; if (!k || k.length < 3) return null; const p = closePosRef(k[k.length - 2]);
        if (p === null) return null; return tier(d > 0 ? p : 1 - p, 0.7, 0.45); }],
      ["trendAgree", 1.5, "ind", h1Vote],
      ["adxOn", 1.0, "ind", (c) => { const a = c.an["1h"] || c.an["1d"]; if (!a || !isNum(a.adx)) return null; return tier(a.adx, 22, 16); }],
      ["notBlowoff", 1.0, "ind", (c, d) => { const a = c.an["1h"] || c.an["1d"]; if (!a || !isNum(a.rsi)) return null; return tierLo(rsiFor(a.rsi, d), 72, 80); }]] },

  { id: "pbTrend", fam: "revert", tfOf: () => "1h",
    ready: (c) => !c.an["1h"] ? "no-1h" : !fPbUp(c) ? "no-mother" : null,
    side: (c) => { const h = c.an["1h"], f = c.an[fPbUp(c)]; if (!h || !f) return 0;
      if (![f.e200, f.e50, f.px, h.e20, h.rsi].every(isNum) || !(h.atr > 0)) return 0;
      const dip = Math.max(tolOf(h.atr), h.atr * 0.5);
      if (f.px > f.e200 && f.e50 > f.e200 && c.px < h.e20 - dip && h.rsi >= 30 && h.rsi < 55) return 1;
      if (f.px < f.e200 && f.e50 < f.e200 && c.px > h.e20 + dip && h.rsi <= 70 && h.rsi > 45) return -1; return 0; },
    gates: [
      ["motherTrend", 2.5, "ind", (c, d) => { const f = c.an[fPbUp(c)]; return f ? agreeRef(f.score, d, 15) : null; }],
      ["dipDepth", 2.0, "price", (c, d) => { const h = c.an["1h"]; if (!h || !(h.atr > 0) || !isNum(h.e20)) return null; return rangeRef((h.e20 - c.px) * d / h.atr, 0.5, 2.5); }],
      ["holdsE50", 1.5, "price", (c, d) => { const h = c.an["1h"]; return h ? signed(c.px, h.e50, h.atr, d) : null; }],
      ["rsiZone", 1.5, "ind", (c, d) => { const h = c.an["1h"]; if (!h || !isNum(h.rsi)) return null; return rangeRef(rsiFor(h.rsi, d), 32, 50); }],
      ["stochTurn", 1.0, "ind", (c, d) => { const h = c.an["1h"]; if (!h || !isNum(h.stochK) || !isNum(h.stochD)) return null; return (h.stochK - h.stochD) * d > 0 ? 1 : -1; }],
      /* المواصفة §5.4: حجمُ التراجع على **فريم التراجع** نفسه. */
      ["volDry", 1.0, "ind", (c) => { const x = volRatioRef(c, "1h"); return x === null ? null : tierLo(x, 1.1, 1.6); }],
      ["dayTrend", 1.0, "ind", dayVote]] },

  { id: "meanRev", fam: "revert", tfOf: f15,
    ready: (c) => f15(c) ? null : "no-intraday",
    side: (c) => { const a = c.an[f15(c)]; if (!a || !isNum(a.bbLo) || !isNum(a.bbUp)) return 0;
      const t = tolOf(a.atr); return c.px < a.bbLo - t ? 1 : c.px > a.bbUp + t ? -1 : 0; },
    gates: [
      ["noTrend", 2.5, "ind", (c) => { const a = c.an[f15(c)] || c.an["1h"]; if (!a || !isNum(a.adx)) return null; return a.adx < 22 ? 1 : a.adx < 28 ? 0 : -1; }],
      ["bbExt", 2.0, "price", (c, d) => { const a = c.an[f15(c)]; if (!a || !(a.atr > 0)) return null; return rangeRef(((d > 0 ? a.bbLo : a.bbUp) - c.px) * d / a.atr, 0.1, 1.5); }],
      ["rsiExt", 1.5, "ind", (c, d) => { const a = c.an[f15(c)]; if (!a || !isNum(a.rsi)) return null; return tierLo(rsiFor(a.rsi, d), 30, 40); }],
      ["mfiExt", 1.5, "ind", (c, d) => { const a = c.an[f15(c)]; if (!a || !isNum(a.mfi)) return null; return tierLo(rsiFor(a.mfi, d), 25, 40); }],
      ["midRoom", 1.0, "price", (c, d) => { const a = c.an[f15(c)]; if (!a || !(a.atr > 0) || !isNum(a.bbMid)) return null; return (a.bbMid - c.px) * d / a.atr >= 0.5 ? 1 : 0; }],
      ["notCrash", 1.5, "ind", (c, d) => { const a = c.an["1d"]; if (!a || !isNum(a.score)) return null; return tier(a.score * d, -15, -45); }]] },

  { id: "sqzExp", fam: "vol", tfOf: fSq,
    ready: (c) => fSq(c) ? null : "no-bw",
    side: (c) => { const tf = fSq(c), w = c.bw[tf], a = c.an[tf], k = c.k[tf]; if (!w || !a || !k || w.length < 40) return 0;
      const cur = w[w.length - 1], pre = w.slice(-13, -1).filter(isNum);
      if (!isNum(cur) || pre.length < 6 || !(cur > Math.min(...pre) * 1.25)) return 0;
      const r = rangeOf(k, -13, -1); if (!r) return 0; const t = tolOf(a.atr);
      return c.px > r.hi + t ? 1 : c.px < r.lo - t ? -1 : 0; },
    gates: [
      ["wasTight", 2.5, "ind", (c) => { const w = c.bw[fSq(c)]; if (!w) return null; const pre = w.slice(-13, -1).filter(isNum);
        if (pre.length < 6) return null; const p = pctLeRef(w, Math.min(...pre), 120); return p === null ? null : tierLo(p, 15, 30); }],
      /* المواصفة §5.6: قوّةُ التوسّع على **فريم الانضغاط نفسه** (`sqTf`). */
      ["expRatio", 2.0, "ind", (c) => { const w = c.bw[fSq(c)]; if (!w) return null; const cur = w[w.length - 1], pre = w.slice(-13, -1).filter(isNum);
        if (!isNum(cur) || pre.length < 6) return null; return tier(cur / Math.min(...pre), 1.6, 1.3); }],
      ["brkClear", 2.0, "price", (c, d) => { const tf = fSq(c), a = c.an[tf], k = c.k[tf]; if (!a || !k || !(a.atr > 0)) return null;
        const r = rangeOf(k, -13, -1); if (!r) return null; return tier((c.px - (d > 0 ? r.hi : r.lo)) * d / a.atr, 0.3, 0.15); }],
      ["volConf", 1.5, "ind", (c) => { const x = volRatioRef(c, fSq(c)); return x === null ? null : tier(x, 1.3, 0.9); }],
      ["adxRise", 1.0, "ind", (c) => { const a = c.an[fSq(c)]; if (!a || !isNum(a.adx)) return null; return tier(a.adx, 20, 14); }],
      ["dayTrend", 1.0, "ind", dayVote]] },

  { id: "rsiDiv", fam: "revert", tfOf: (c) => fDiv(c) || "1d",
    ready: (c) => ["1h", "15m", "1d"].some((t) => c.an[t]) ? null : "no-an",
    side: (c) => { const tf = fDiv(c); if (!tf) return 0; const dv = c.an[tf].div; return dv && (dv.dir === 1 || dv.dir === -1) ? dv.dir : 0; },
    gates: [
      ["divFresh", 2.0, "ind", (c) => { const tf = fDiv(c); if (!tf) return null; const b = c.an[tf].div.bars; return isNum(b) ? tierLo(b, 8, 16) : null; }],
      ["counterTrend", 2.0, "ind", (c, d) => { const a = c.an["1d"]; return a ? agreeRef(a.score, -d, 15) : null; }],
      ["rsiZone", 1.5, "ind", (c, d) => { const a = c.an["1h"] || c.an["1d"]; if (!a || !isNum(a.rsi)) return null; return tierLo(rsiFor(a.rsi, d), 45, 58); }],
      ["atLevel", 1.5, "price", (c, d) => { const L = c.lv.L; if (!L || !(L.atr > 0)) return null; const pool = d > 0 ? L.supAll : L.resAll;
        if (!pool || !pool.length) return null; return tierLo(Math.abs(c.px - pool[0].p) / L.atr, 1, 2); }],
      ["volConf", 1.0, "ind", (c) => { const x = volRatioRef(c, f15(c) || "1d"); return x === null ? null : tier(x, 1.2, 0.7); }],
      ["obvBack", 1.0, "ind", (c, d) => { const a = c.an["1d"] || c.an["1h"]; if (!a || !isNum(a.obvSlope)) return null; return agreeRef(a.obvSlope, d, 0); }]] },

  { id: "volSpike", fam: "vol", tfOf: f15,
    ready: (c) => f15(c) ? null : "no-intraday",
    side: (c) => { const tf = f15(c), k = c.k[tf]; if (!k || k.length < 12) return 0; const x = volRatioRef(c, tf);
      if (!(x >= 2.5)) return 0; const p = closePosRef(k[k.length - 2]); if (p === null) return 0; return p >= 0.7 ? 1 : p <= 0.3 ? -1 : 0; },
    gates: [
      ["spikeSize", 2.0, "ind", (c) => { const x = volRatioRef(c, f15(c)); return x === null ? null : tier(x, 4, 2.5); }],
      ["closeStrong", 2.0, "ind", (c, d) => { const k = c.k[f15(c)]; if (!k || k.length < 3) return null; const p = closePosRef(k[k.length - 2]);
        if (p === null) return null; return tier(d > 0 ? p : 1 - p, 0.8, 0.65); }],
      ["follow", 2.0, "price", (c, d) => { const k = c.k[f15(c)]; if (!k || k.length < 3) return null; const b = k[k.length - 2], a = c.an[f15(c)];
        if (!b || !a) return null; return signed(c.px, (b.h + b.l) / 2, a.atr, d); }],
      ["dayTrend", 1.0, "ind", dayVote],
      ["not52", 1.0, "price", (c, d) => { const r = c.row, L = c.lv.L; if (!r || !L || !(L.atr > 0)) return null; const wall = d > 0 ? r.w52h : r.w52l;
        if (!isNum(wall)) return null; return tier((wall - c.px) * d / L.atr, 2, 0.5); }],
      ["rsiRoom", 1.0, "ind", (c, d) => { const a = c.an[f15(c)]; if (!a || !isNum(a.rsi)) return null; return tierLo(rsiFor(a.rsi, d), 70, 80); }]] },

  { id: "momo", fam: "trend", tfOf: () => "1h",
    ready: (c) => !c.an["1h"] || !c.an["15m"] ? "need-1h-15m" : null,
    side: (c) => { const h = c.an["1h"], m = c.an["15m"]; if (!h || !m || !isNum(h.hist) || !isNum(m.hist)) return 0;
      if (h.hist > 0 && m.hist > 0 && h.histRising === true) return 1;
      if (h.hist < 0 && m.hist < 0 && h.histRising === false) return -1; return 0; },
    gates: [
      ["histSize", 1.5, "ind", (c) => { const h = c.an["1h"]; if (!h || !isNum(h.hist) || !(h.atr > 0)) return null; return tier(Math.abs(h.hist) / h.atr, 0.25, 0.1); }],
      ["rsiSide", 1.5, "ind", (c, d) => { const h = c.an["1h"]; if (!h || !isNum(h.rsi)) return null; return tier(rsiFor(h.rsi, d), 55, 45); }],
      ["aboveE20", 1.5, "price", (c, d) => { const h = c.an["1h"]; return h ? signed(c.px, h.e20, h.atr, d) : null; }],
      ["aboveE50", 1.0, "price", (c, d) => { const h = c.an["1h"]; return h ? signed(c.px, h.e50, h.atr, d) : null; }],
      ["dayTrend", 1.5, "ind", dayVote],
      ["adxOn", 1.0, "ind", (c) => { const h = c.an["1h"]; if (!h || !isNum(h.adx)) return null; return tier(h.adx, 22, 16); }],
      ["notExtended", 1.0, "price", (c, d) => { const h = c.an["1h"]; if (!h || !(h.atr > 0) || !isNum(h.e20)) return null; return (c.px - h.e20) * d / h.atr <= 2.5 ? 1 : -1; }]] },

  { id: "tfAlign", fam: "trend", tfOf: () => "1d",
    ready: (c) => ["15m", "1h", "4h", "1d"].every((t) => c.an[t] && isNum(c.an[t].score)) ? null : "missing-tf",
    side: (c) => { const v = ["15m", "1h", "4h", "1d"].map((t) => c.an[t].score);
      return v.every((x) => x > 15) ? 1 : v.every((x) => x < -15) ? -1 : 0; },
    gates: [
      ...[["f15", "15m", 1.0], ["f1h", "1h", 1.5], ["f4h", "4h", 2.0], ["f1d", "1d", 2.5]].map(([id, tf, w]) =>
        [id, w, "ind", (c, d) => { const a = c.an[tf]; return a ? tier(a.score * d, 45, 25) : null; }]),
      ["adxOn", 1.0, "ind", (c) => { const a = c.an["1d"]; if (!a || !isNum(a.adx)) return null; return tier(a.adx, 22, 16); }],
      ["notExtended", 1.5, "price", (c, d) => { const h = c.an["1h"]; if (!h || !(h.atr > 0) || !isNum(h.e20)) return null; return tierLo((c.px - h.e20) * d / h.atr, 2, 3.5); }]] }
];

/* النتيجة: round(((Σ w·v / Σ w) + 1) / 2 · 100) على البوابات غير الغائبة. */
export function gatesRef(gates, c, d) {
  let S = 0, W = 0; const g = [];
  for (const [id, w, , fn] of gates) {
    let v; try { v = fn(c, d); } catch { v = null; }
    if (v === null || v === undefined || !isNum(v)) continue;
    S += w * v; W += w; g.push([id, w, v]);
  }
  return W > 0 ? { sc: Math.round((S / W + 1) / 2 * 100), g, w: W } : null;
}

export function sBandRef(sc) { return isNum(sc) ? REF.S_BANDS.filter((b) => sc >= b).length : null; }

/* إمساك الاتجاه (§5.12): انقلابٌ يُنشر بعد ثلاث شمعاتٍ مغلقة متمايزة. */
export function holdRef(d, H = {}, bar, need = REF.DIR_HOLD) {
  const ld = isNum(H.ld) ? H.ld : 0;
  if (!ld || !d || d === ld) return { dir: d, hold: { ld: d || ld, pd: 0, pn: 0, pb: 0 }, pend: null };
  if (!isNum(bar)) return { dir: d, hold: { ld: d, pd: 0, pn: 0, pb: 0 }, pend: null };
  const same = H.pd === d;
  const fresh = isNum(H.pb) && bar > H.pb;
  const pn = same ? (fresh ? (H.pn || 0) + 1 : (H.pn || 1)) : 1;
  const pb = Math.max(bar, H.pb || 0);
  if (pn >= need) return { dir: d, hold: { ld: d, pd: 0, pn: 0, pb: 0 }, pend: null };
  return { dir: ld, hold: { ld, pd: d, pn, pb }, pend: { d, n: pn, of: need } };
}

/* ============================ §4 سياق التأكيد ============================ */
/* يبني السياق **المؤكَّد** من السجلّ الخام: الشمعات المغلقة بساعة `cnow`، آخرُ
   259 منها، ومؤشّراتٌ معادة. `now` ساعة الحائط (الجلسة والنوافذ). */
export function confirmedCtxRef({ rec, row = {}, now, cnow, sess = null, win = null, sessOf = null, levelsAt = null }) {
  const cl = isNum(cnow) ? cnow : now;
  const cut = (box) => {
    const o = {};
    for (const tf of Object.keys(box || {})) {
      const raw = box[tf] && box[tf].c;
      if (!raw || raw.length < 2) continue;
      const cc = closedRef(raw, tf, cl);
      if (cc && cc.length) o[tf] = unpack(cc.slice(-REF.AN_WIN));
    }
    return o;
  };
  const k = cut(rec.tf), kx = cut(rec.tfx);
  if (!Object.keys(k).length) return null;
  const an = {}, anx = {};
  for (const tf of Object.keys(k)) { const a = analyzeRef(k[tf]); if (a) an[tf] = a; }
  for (const tf of Object.keys(kx)) { const a = analyzeRef(kx[tf]); if (a) anx[tf] = a; }

  const ext = sess === "PRE" || sess === "AFTER";
  const pick = ext && kx["15m"] ? kx : k;
  let px = null;
  for (const tf of ["15m", "1h", "4h", "1d"]) {
    const s = (pick[tf] && pick[tf].length ? pick[tf] : k[tf]);
    if (s && s.length && isNum(s[s.length - 1].c)) { px = s[s.length - 1].c; break; }
  }
  if (!isNum(px)) return null;

  let period = rec.period || null, W = win, S = sess;
  const mkt = rec.mkt || row.mkt || null;
  if (mkt === "crypto") {
    const d = new Date(now), day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    period = { regular: { start: day0, end: day0 + 86400000 } }; S = "REGULAR"; W = period.regular;
  }
  if (!W && period && period.regular) W = period.regular;
  const today = !!(W && isNum(W.start) && now >= W.start - 6 * 3600000 && now <= (W.end || W.start) + 6 * 3600000);
  const extSess = S === "PRE" || S === "AFTER";
  const ik = extSess && kx["15m"] ? kx : k;
  const iTf = ik["15m"] && ik["15m"].length ? "15m" : null;
  const lv = { iTf, short: !!(iTf && !(ik["15m"][0].t <= (W && W.start))) };
  if (iTf && today) { lv.vwap = vwapRef(ik[iTf], W); lv.or = openingRangeRef(ik[iTf], W, 30); }
  lv.L = k["1d"] && (an["4h"] || an["1d"]) && levelsAt ? levelsAt(px, { k, an, now }) : null;
  const bw = {};
  for (const tf of ["15m", "1h", "4h", "1d"]) if (k[tf] && k[tf].length >= 40) bw[tf] = bbWidthRef(k[tf].map((x) => x.c), 20, 2);
  return { px, now, k, kx, ik, an, anx, ian: ik === kx ? anx : an, row, sess: S, win: W, today,
           lv, bw, sessOf, levelsAt, mkt };
}

/* سعرُ كلّ استراتيجية: إغلاقُ آخر شمعةٍ مغلقة **في فريمها**، ومستوياتٌ معادة به. */
function ctxFor(st, base) {
  const tf = st.tfOf(base);
  const ser = tf ? ((base.ik && base.ik[tf]) || base.k[tf]) : null;
  if (!ser || !ser.length) return base;
  const px = ser[ser.length - 1].c;
  if (!isNum(px)) return Object.assign({}, base, { _unconfirmed: true });
  if (px === base.px) return base;
  const L = base.lv.L && base.levelsAt ? base.levelsAt(px, { k: base.k, an: base.an, now: base.now }) : null;
  return Object.assign({}, base, { px, lv: Object.assign({}, base.lv, { L: L || base.lv.L }) });
}

export function evalStratRef(st, c, holdIn) {
  const out = { id: st.id, fam: st.fam, dir: 0, sc: null, off: null };
  if (c._unconfirmed) return Object.assign(out, { off: "unconfirmed" });
  const why = st.ready(c);
  if (why) return Object.assign(out, { off: why });
  let d; try { d = st.side(c); } catch { d = 0; }
  let hold = null, pend = null;
  if (holdIn) {
    const tf = st.tfOf(c), s = (c.ik && c.ik[tf]) || (c.k && c.k[tf]);
    const bar = s && s.length ? s[s.length - 1].t : null;
    const h = holdRef(d, holdIn, isNum(bar) ? bar : null);
    d = h.dir; hold = h.hold; pend = h.pend;
  }
  if (d !== 1 && d !== -1) return Object.assign(out, { quiet: true, hold, pend });
  const r = gatesRef(st.gates, c, d);
  if (!r) return Object.assign(out, { off: "no-gates" });
  return Object.assign(out, { dir: d, sc: r.sc, g: r.g, w: r.w, band: sBandRef(r.sc),
                              active: r.sc >= REF.ACT_MIN, hold, pend, tfUsed: st.tfOf(c) });
}

export function evalAllRef(base, holdBy) {
  return STRATS_REF.map((st) => evalStratRef(st, ctxFor(st, base), holdBy && holdBy[st.id]));
}

/* ============================ §6 الإجماع ============================ */
const clampW = (x) => Math.max(REF.W_MIN, Math.min(REF.W_MAX, x));
export function weightRef(id, { edge, regime } = {}) {
  const row = edge && edge[id];
  let w = 1, measured = false;
  if (row && isNum(row.edge)) { w = clampW(1 + row.edge / 2); measured = true; }
  if (row && row.byRegime && regime && isNum(row.byRegime[regime]))
    w *= clampW(1 + (row.byRegime[regime] - (row.edge || 0)) / 2);
  return { w: clampW(w), measured };
}

export function consensusRef(res, o = {}) {
  const act = res.filter((r) => r.dir && r.active && isNum(r.sc));
  if (!act.length) return { dir: 0, k: "none", up: 0, dn: 0, n: 0 };
  let up = 0, dn = 0, measured = 0; const items = [];
  for (const r of act) {
    const w = weightRef(r.id, o), mass = w.w * r.sc / 100;
    if (r.dir > 0) up += mass; else dn += mass;
    if (w.measured) measured++;
    items.push({ id: r.id, fam: r.fam, dir: r.dir, w: w.w, mass });
  }
  const total = up + dn, maj = up >= dn ? 1 : -1;
  const majM = Math.max(up, dn), minM = Math.min(up, dn);
  const agree = total > 0 ? majM / total : 0;
  const fams = [...new Set(items.filter((x) => x.dir === maj).map((x) => x.fam))];
  const wMaj = items.filter((x) => x.dir === maj).reduce((s, x) => s + x.w, 0) || 1;
  const base = { up, dn, n: act.length, nUp: act.filter((r) => r.dir > 0).length, agree,
                 fams, mass: majM, sc: Math.round(majM / wMaj * 100), measured };
  if (total > 0 && minM / total > REF.MIX) return Object.assign(base, { dir: 0, k: "mixed" });
  let conf = agree >= REF.CONF_HI && fams.length >= 2 && act.length >= 3 ? "high"
           : agree >= REF.CONF_MD && act.length >= 2 ? "med" : "low";
  if (measured === 0 && conf === "high") conf = "med";
  return Object.assign(base, { dir: maj, k: act.length === 1 ? "solo" : maj > 0 ? "up" : "dn", conf });
}

export function scsRef(cons) {
  if (!cons) return { scs: null, dir: 0, pct: null };
  const up = cons.up || 0, dn = cons.dn || 0, total = up + dn;
  if (!(total > 0)) return { scs: null, dir: 0, pct: null };
  if (cons.k === "mixed") return { scs: 0, dir: 0, pct: 0, mixed: true };
  const net = (up - dn) / total, cover = Math.min(1, total / REF.SCS_FULL);
  const str = Math.abs(net) * (REF.SCS_FLOOR + (1 - REF.SCS_FLOOR) * cover);
  const dir = Math.sign(net);
  return { scs: dir * str, dir, pct: Math.round(str * 100), mixed: false };
}

export function oppQualityRef(base, scs, sd) {
  if (!isNum(base)) return null;
  if (scs === null || scs === undefined || (sd !== 1 && sd !== -1)) return base;
  return Math.max(0, Math.min(1, base + REF.SCS_W * scs * sd));
}

/* ============================ §7 الاتجاه ============================ */
export function baseDirRef(score, band) {
  if (isNum(band) && band >= 0 && band <= 4) return band <= 1 ? -1 : 1;
  if (!isNum(score)) return null;
  return score < -15 ? -1 : 1;
}
export function tfUnanimousRef(tfScore) {
  const v = tfScore ? Object.values(tfScore) : [];
  if (v.length !== 4 || !v.every(isNum)) return 0;
  return v.every((x) => x > 15) ? 1 : v.every((x) => x < -15) ? -1 : 0;
}
export function resolveOppRef({ score, band, tfScore, hits = [] }) {
  const base = baseDirRef(score, band), uni = tfUnanimousRef(tfScore);
  const extreme = (f) => (f === 1 && band === 0) || (f === -1 && band === 4);
  const againstTf = (f) => uni !== 0 && uni !== f;
  let dir;
  if (!hits.length) dir = uni || base;
  else {
    const f = hits.map((h) => h && h.forced).find((x) => (x === 1 || x === -1) && !extreme(x) && !againstTf(x));
    dir = uni || (f === 1 || f === -1 ? f : base);
  }
  const kept = [], dropped = [];
  for (const h of hits) {
    const own = (h && (h.forced === 1 || h.forced === -1)) ? h.forced
              : (h && (h.dir === 1 || h.dir === -1)) ? h.dir : dir;
    (own === dir ? kept : dropped).push(h);
  }
  return { dir: hits.length && !kept.length ? null : dir, kept, dropped };
}
