/* =====================================================================
   محرّك الصفقة الواحدة (V2) — المواصفة: docs/ENGINE_V2_SPEC.md

   دالّةُ قرارٍ واحدة يستدعيها المسار الحيّ والإعادة التاريخية معاً: «ما يُعرض
   هو ما يُقاس». الملفّ **مكتفٍ بذاته** — لا يستورد شيئاً، ولا يعرف المحرّك
   القديم (مؤرشَفٌ في legacy_strategy_engine/ واختبار عزلٍ يمنع استيراده).

   المدخلات شموعٌ **مغلقة** يبنيها scripts/lib/engine2-input.mjs:
     b15  شموع 15د الرسمية المغلقة، كلٌّ {t,o,h,l,c,v,d,last}
          (d = تاريخ الجلسة YYYYMMDD، last = آخر شمعة في جلستها)
     h1 · h4  دلاءٌ منتهية {t,o,h,l,c}
     d1   جلساتٌ مكتملة سابقة ليوم القرار {t,o,h,l,c,d,w} (w = مفتاح الأسبوع)
     wk   مفتاح أسبوع يوم القرار
     mkt  {h1,h4,d1} للسوق (SPY أو BTC)
   الأزمنة بالملّي. الملفّ نقيّ: لا Date.now ولا state.
   ===================================================================== */

var E2 = {
  PIV_K: 3, PIV_WIN: 120,
  MA: [20, 50, 200], MA_WIN: 259,
  ATR_P: 14, ATR_WIN: 259,
  TRIG_BUF: 0.1, WATCH_ATR: 0.5,
  STOP_BARS: 4, STOP_BUF: 0.1, MAX_RISK_ATR: 1.0,
  TGT_MERGE_ATR: 0.1, MIN_RR1: 1.0,
  MIN_SHOW: 3, EXPIRY_SESS: 5,
  SLIP_ATR: 0.05, FEE: 0.0002,
  CLUSTER_ATR: 0.25
};

/* ---------------- رياضيات ---------------- */
function e2ema(a, p) {
  var out = new Array(a.length).fill(null);
  if (a.length < p) return out;
  var s = 0;
  for (var i = 0; i < p; i++) s += a[i];
  var v = s / p, k = 2 / (p + 1);
  out[p - 1] = v;
  for (var j = p; j < a.length; j++) { v = a[j] * k + v * (1 - k); out[j] = v; }
  return out;
}
/* ATR ويلدر: بذرة = متوسط أوّل p مدى حقيقي، ثم التمهيد. */
function e2atr(bars, p) {
  if (!bars || bars.length < p + 1) return null;
  var tr = [];
  for (var i = 1; i < bars.length; i++) {
    var b = bars[i], pc = bars[i - 1].c;
    tr.push(Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)));
  }
  var v = 0;
  for (var j = 0; j < p; j++) v += tr[j];
  v /= p;
  for (var m = p; m < tr.length; m++) v = (v * (p - 1) + tr[m]) / p;
  return v;
}
function tail(a, n) { return a.length > n ? a.slice(a.length - n) : a.slice(); }

/* ---------------- E1: هيكل القمم والقيعان ---------------- */
function e2pivots(bars, k) {
  var hi = [], lo = [];
  for (var i = k; i < bars.length - k; i++) {
    var H = true, L = true;
    for (var j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].h > bars[i].h) H = false;
      if (bars[j].l < bars[i].l) L = false;
    }
    if (H) hi.push(i);
    if (L) lo.push(i);
  }
  return { hi: hi, lo: lo };
}
function swingTrend(bars) {
  var w = tail(bars || [], E2.PIV_WIN);
  var pv = e2pivots(w, E2.PIV_K);
  if (pv.hi.length < 2 || pv.lo.length < 2) return 0;
  var H1 = w[pv.hi[pv.hi.length - 2]].h, H2 = w[pv.hi[pv.hi.length - 1]].h;
  var L1 = w[pv.lo[pv.lo.length - 2]].l, L2 = w[pv.lo[pv.lo.length - 1]].l;
  if (H2 > H1 && L2 > L1) return 1;
  if (H2 < H1 && L2 < L1) return -1;
  return 0;
}
/* واضح = لا فريم معاكس، واثنان على الأقل في الجهة */
function trendClear(t) {
  var up = 0, dn = 0;
  for (var i = 0; i < t.length; i++) { if (t[i] > 0) up++; else if (t[i] < 0) dn++; }
  if (up >= 2 && dn === 0) return 1;
  if (dn >= 2 && up === 0) return -1;
  return 0;
}
function frameTrend(f) {
  var tf = { "1h": swingTrend(f.h1), "4h": swingTrend(f.h4), "1d": swingTrend(f.d1) };
  return { tf: tf, dir: trendClear([tf["1h"], tf["4h"], tf["1d"]]) };
}

/* ---------------- E2: المتوسطات عاملٌ واحد ---------------- */
function maState(h1, d) {
  var w = tail(h1 || [], E2.MA_WIN);
  var c = w.map(function (b) { return b.c; });
  var e = E2.MA.map(function (p) { return e2ema(c, p)[c.length - 1]; });
  var px = c[c.length - 1];
  if (!(e.every(Number.isFinite) && Number.isFinite(px))) return { k: 0, e: e, px: px };
  var up = px > e[0] && e[0] > e[1] && e[1] > e[2];
  var dn = px < e[0] && e[0] < e[1] && e[1] < e[2];
  var dir = up ? 1 : (dn ? -1 : 0);
  return { k: dir === 0 ? 0 : (dir === d ? 1 : -1), dir: dir, e: e, px: px };
}

/* ---------------- مستويات المرجع ---------------- */
function prevDay(d1) {
  var b = d1 && d1.length ? d1[d1.length - 1] : null;
  return b ? { h: b.h, l: b.l, d: b.d } : null;
}
function prevWeek(d1, wk) {
  var best = null;
  for (var i = d1.length - 1; i >= 0; i--) {
    var b = d1[i];
    if (b.w >= wk) continue;
    if (best === null) best = { w: b.w, h: b.h, l: b.l };
    else if (b.w === best.w) { if (b.h > best.h) best.h = b.h; if (b.l < best.l) best.l = b.l; }
    else break;
  }
  return best;
}
/* VWAP الجلسة حتى آخر شمعة مغلقة ضمناً */
function vwapToday(b15) {
  if (!b15.length) return null;
  var day = b15[b15.length - 1].d, pv = 0, v = 0;
  for (var i = b15.length - 1; i >= 0 && b15[i].d === day; i--) {
    var b = b15[i];
    if (b.v > 0) { pv += (b.h + b.l + b.c) / 3 * b.v; v += b.v; }
  }
  return v > 0 ? pv / v : null;
}
function refLevels(pd, pw) {
  var L = [];
  if (pd) { L.push({ id: "PDH", p: pd.h }); L.push({ id: "PDL", p: pd.l }); }
  if (pw) { L.push({ id: "PWH", p: pw.h }); L.push({ id: "PWL", p: pw.l }); }
  return L;
}

/* ---------------- التأكيد والوقف والأهداف ---------------- */
function findTrigger(b15, levels, d, atr15) {
  if (b15.length < 2) return null;
  var b = b15[b15.length - 1], p = b15[b15.length - 2];
  if (!(b.h > b.l)) return null;
  var half = d > 0 ? (b.c - b.l) >= 0.5 * (b.h - b.l) : (b.h - b.c) >= 0.5 * (b.h - b.l);
  if (!half) return null;
  var buf = E2.TRIG_BUF * atr15, hit = [];
  for (var i = 0; i < levels.length; i++) {
    var L = levels[i].p;
    if (d > 0 ? (p.c <= L && b.c > L + buf) : (p.c >= L && b.c < L - buf)) hit.push(levels[i].id);
  }
  return hit.length ? hit : null;
}
function stopOf(b15, d, atr15) {
  var w = tail(b15, E2.STOP_BARS), x = d > 0 ? Infinity : -Infinity;
  for (var i = 0; i < w.length; i++) x = d > 0 ? Math.min(x, w[i].l) : Math.max(x, w[i].h);
  return x - d * E2.STOP_BUF * atr15;
}
function targetsOf(entry, d, levels, h1, atrD) {
  var w = tail(h1 || [], E2.PIV_WIN), pv = e2pivots(w, E2.PIV_K), c = [];
  levels.forEach(function (L) { c.push(L.p); });
  pv.hi.forEach(function (i) { c.push(w[i].h); });
  pv.lo.forEach(function (i) { c.push(w[i].l); });
  var ahead = c.filter(function (p) { return Number.isFinite(p) && (p - entry) * d > 0; })
               .sort(function (a, b) { return (a - b) * d; });
  var out = [];
  for (var i = 0; i < ahead.length && out.length < 3; i++) {
    if (out.length && Math.abs(ahead[i] - out[out.length - 1]) < E2.TGT_MERGE_ATR * atrD) continue;
    out.push(ahead[i]);
  }
  return out;
}

/* =====================================================================
   التقييم عند T — يعيد البوّابة والمراقبة والإشارة (أو سبب الرفض).
   ===================================================================== */
function evaluateAt(inp) {
  var out = { gate: null, watch: null, signal: null, reject: null };
  var b15 = inp.b15 || [], d1 = inp.d1 || [];
  if (b15.length < E2.ATR_P + 2 || d1.length < E2.ATR_P + 2) { out.reject = "data"; return out; }
  var mk = frameTrend(inp.mkt), sk = frameTrend(inp);
  var d = (mk.dir !== 0 && mk.dir === sk.dir) ? mk.dir : 0;
  out.gate = { d: d, mkt: mk, stk: sk };
  if (!d) { out.reject = "gate"; return out; }

  var atrD = e2atr(tail(d1, E2.ATR_WIN), E2.ATR_P);
  var atr15 = e2atr(tail(b15, E2.ATR_WIN), E2.ATR_P);
  if (!(atrD > 0 && atr15 > 0)) { out.reject = "atr"; return out; }
  var pd = prevDay(d1), pw = prevWeek(d1, inp.wk);
  var levels = refLevels(pd, pw);
  var b = b15[b15.length - 1];

  // المراقبة: مستوى أمام السعر ضمن 0.5×ATRd
  var near = levels.filter(function (L) { return (L.p - b.c) * d > 0 && Math.abs(L.p - b.c) <= E2.WATCH_ATR * atrD; });
  if (near.length) out.watch = { d: d, lv: near.map(function (L) { return L.id; }), px: b.c };

  var trig = findTrigger(b15, levels, d, atr15);
  if (!trig) { out.reject = "notrig"; return out; }

  var ma = maState(inp.h1, d);
  var vw = vwapToday(b15);
  var has = function (a, b2) { return trig.indexOf(a) >= 0 || trig.indexOf(b2) >= 0; };
  var el = {
    trend: 1,
    ma: ma.k === 1 ? 1 : 0,
    day: (pd && (has("PDH", "PDL") || (b.c - (d > 0 ? pd.h : pd.l)) * d > 0)) ? 1 : 0,
    vwap: (vw !== null && (b.c - vw) * d > 0) ? 1 : 0,
    week: (pw && (has("PWH", "PWL") || (b.c - (d > 0 ? pw.h : pw.l)) * d > 0)) ? 1 : 0
  };
  var count = el.trend + el.ma + el.day + el.vwap + el.week;
  var cl = pd && pw && [pd.h, pd.l].some(function (x) {
    return Math.abs(x - pw.h) < E2.CLUSTER_ATR * atrD || Math.abs(x - pw.l) < E2.CLUSTER_ATR * atrD;
  });

  var stop = stopOf(b15, d, atr15), risk = (b.c - stop) * d;
  var sig = { d: d, t: b.t, e: b.c, st: stop, risk: risk, count: count, el: el, trig: trig,
              cluster: cl ? 1 : 0, atrD: atrD, atr15: atr15, ma: ma.dir, vwap: vw,
              pdh: pd && pd.h, pdl: pd && pd.l, pwh: pw && pw.h, pwl: pw && pw.l, tg: [], rr1: null };
  if (!(risk > 0) || risk > E2.MAX_RISK_ATR * atrD) { out.reject = "risk"; out.signal = sig; return out; }
  var tg = targetsOf(b.c, d, levels, inp.h1, atrD);
  sig.tg = tg;
  if (!tg.length) { out.reject = "notgt"; out.signal = sig; return out; }
  sig.rr1 = (tg[0] - b.c) * d / risk;
  if (sig.rr1 < E2.MIN_RR1) { out.reject = "rr"; out.signal = sig; return out; }
  sig.ok = 1;
  sig.show = count >= E2.MIN_SHOW ? 1 : 0;
  out.signal = sig;
  return out;
}

/* =====================================================================
   إدارة الصفقة — شمعةً شمعة على شموع 15د الرسمية المغلقة.
   ===================================================================== */
function openTrade(sig, bar) {
  var d = sig.d, F = bar.o + d * E2.SLIP_ATR * sig.atrD;
  var tr = { d: d, e: sig.e, st0: sig.st, st: sig.st, risk0: (sig.e - sig.st) * d, tg: sig.tg.slice(), F: F, fillT: bar.t,
             fillDay: bar.d, day: bar.d, sess: 0, hit: 0, beNext: false, end: null, atrD: sig.atrD };
  if ((bar.o - sig.st) * d <= 0) { tr.end = { k: "stop", px: bar.o, t: bar.t }; return tr; }
  return stepTrade(tr, bar);
}
function stepTrade(tr, bar) {
  if (tr.end) return tr;
  var d = tr.d;
  if (bar.d !== tr.day) { tr.day = bar.d; tr.sess++; }
  if (tr.beNext) { tr.st = tr.F; tr.beNext = false; }
  var adv = d > 0 ? bar.l : bar.h, fav = d > 0 ? bar.h : bar.l;
  if ((adv - tr.st) * d <= 0) {
    var px = d > 0 ? Math.min(bar.o, tr.st) : Math.max(bar.o, tr.st);
    tr.end = { k: tr.hit ? "be" : "stop", px: px, t: bar.t };
    return tr;
  }
  while (tr.hit < tr.tg.length && (fav - tr.tg[tr.hit]) * d >= 0) {
    tr.hit++;
    if (tr.hit === 1) tr.beNext = true;
  }
  if (tr.hit >= tr.tg.length) { tr.end = { k: "tgt", px: tr.tg[tr.tg.length - 1], t: bar.t }; return tr; }
  if (bar.last && tr.sess >= E2.EXPIRY_SESS) tr.end = { k: "exp", px: bar.c, t: bar.t };
  return tr;
}
function tradeR(tr) {
  if (!tr.end) return null;
  var d = tr.d, x = tr.end.px - d * E2.SLIP_ATR * tr.atrD;
  /* المقام = المخاطرة المعلنة لحظة التأكيد (الدخول المعلن − الوقف)، لا مسافة
     التنفيذ: فجوةٌ تحت الوقف تجعل الثانية صفراً أو سالبة فيتضخّم R بلا معنى. */
  if (!(tr.risk0 > 0)) return null;
  return ((x - tr.F) * d - E2.FEE * (tr.F + x)) / tr.risk0;
}

/* الترتيب المجمّد: العدد ثم R للهدف الأوّل ثم الأسبق ثم الرمز */
function rankCmp(a, b) {
  return (b.count - a.count) || ((b.rr1 || 0) - (a.rr1 || 0)) || (a.t - b.t) ||
         (a.s < b.s ? -1 : (a.s > b.s ? 1 : 0));
}

var ENGINE2 = { E2: E2, e2ema: e2ema, e2atr: e2atr, e2pivots: e2pivots, swingTrend: swingTrend,
  trendClear: trendClear, frameTrend: frameTrend, maState: maState, prevDay: prevDay,
  prevWeek: prevWeek, vwapToday: vwapToday, refLevels: refLevels, findTrigger: findTrigger,
  stopOf: stopOf, targetsOf: targetsOf, evaluateAt: evaluateAt, openTrade: openTrade,
  stepTrade: stepTrade, tradeR: tradeR, rankCmp: rankCmp };
if (typeof module !== "undefined" && module.exports) module.exports = ENGINE2;
