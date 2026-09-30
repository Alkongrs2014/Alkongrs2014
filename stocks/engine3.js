/* =====================================================================
   المحرّك V3 — محرّك الفرص المعتمد. المواصفة: docs/ENGINE_V3_SPEC.md

   خمس استراتيجيات بأوزانٍ ثابتة بقرار المالك: قمة/قاع أمس 40 · المتوسطات 40 ·
   الاتجاه 6.67 · VWAP 6.67 · قمة/قاع الأسبوع السابق 6.66. الفرصة تتولّد من إحدى
   الأساسيتين وحدها، والثلاث تأكيدات.

   الملفّ **نقيّ ومكتفٍ بذاته**: لا يستورد شيئاً ولا يعرف المحرّكين السابقين
   (أرشيف في legacy_strategy_engine/، واختبار عزلٍ يمنع استيرادهما). يستدعيه
   المسار الحيّ والتقييم التاريخي بنفس المدخلات (scripts/lib/engine3-run.mjs).

   المدخلات شموعٌ **مغلقة** فقط:
     b15  شموع 15د الرسمية {t,o,h,l,c,v,d,last,end} حتى شمعة القرار ضمناً
     h1 · h4  دلاءٌ منتهية {t,o,h,l,c,end}
     d1   جلساتٌ مكتملة أقدم من جلسة القرار {t,o,h,l,c,d,w}
     wk   مفتاح أسبوع جلسة القرار (ISO)
   ===================================================================== */

var E3 = {
  W: { day: 40, ma: 40, trend: 6.67, vwap: 6.67, week: 6.66 },
  PIV_K: 3, PIV_WIN: 120,
  MA: [20, 50, 200], MA_WIN: 259,
  ATR_P: 14, ATR_WIN: 259,
  STOP_BUF: 0.1, MAX_RISK_ATR: 1.0,
  TGT_MERGE_ATR: 0.1, MIN_RR: 1.0, MIN_TGTS: 2,
  EXPIRY_SESS: 5, SLIP_ATR: 0.05, FEE: 0.0002
};
var E3_EVT = {
  pdh_break:   { d: 1,  ar: "كسر قمة أمس" },
  pdl_reclaim: { d: 1,  ar: "استعادة قاع أمس" },
  pdl_break:   { d: -1, ar: "كسر قاع أمس" },
  pdh_loss:    { d: -1, ar: "فقد قمة أمس" },
  pwh_break:   { d: 1,  ar: "كسر قمة الأسبوع" },
  pwl_reclaim: { d: 1,  ar: "استعادة قاع الأسبوع" },
  pwl_break:   { d: -1, ar: "كسر قاع الأسبوع" },
  pwh_loss:    { d: -1, ar: "فقد قمة الأسبوع" }
};

/* ---------------- رياضيات ---------------- */
function e3ema(a, p) {
  if (a.length < p) return null;
  var s = 0;
  for (var i = 0; i < p; i++) s += a[i];
  var v = s / p, k = 2 / (p + 1);
  for (var j = p; j < a.length; j++) v = a[j] * k + v * (1 - k);
  return v;
}
function e3atr(bars, p) {
  if (!bars || bars.length < p + 1) return null;
  var v = 0, i;
  for (i = 1; i <= p; i++) v += e3tr(bars[i], bars[i - 1].c);
  v /= p;
  for (i = p + 1; i < bars.length; i++) v = (v * (p - 1) + e3tr(bars[i], bars[i - 1].c)) / p;
  return v;
}
function e3tr(b, pc) { return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); }
function e3tail(a, n) { return a.length > n ? a.slice(a.length - n) : a.slice(); }

/* ---------------- عبور المستويات بجسم الشمعة ---------------- */
/* يعيد أحداث الشمعة b على قمة H وقاع L (بادئة "pd" أو "pw") */
function crossEvents(b, H, L, pre) {
  var out = [];
  if (!(Number.isFinite(b.o) && Number.isFinite(b.c))) return out;
  if (Number.isFinite(H) && b.o <= H && b.c > H) out.push(pre + "h_break");
  if (Number.isFinite(L) && b.o < L && b.c > L) out.push(pre + "l_reclaim");
  if (Number.isFinite(L) && b.o >= L && b.c < L) out.push(pre + "l_break");
  if (Number.isFinite(H) && b.o > H && b.c < H) out.push(pre + "h_loss");
  return out;
}
function levelOf(evt, H, L) { return evt.indexOf("h_") >= 0 ? H : L; }
/* آخر حدث عبورٍ على (H, L) في bars، وهل ما زال الإغلاق الأخير في جهته */
function lastCross(bars, H, L, pre) {
  for (var i = bars.length - 1; i >= 0; i--) {
    var ev = crossEvents(bars[i], H, L, pre);
    if (ev.length) {
      var e = ev[0], d = E3_EVT[e].d, lv = levelOf(e, H, L), c = bars[bars.length - 1].c;
      return { evt: e, d: d, lv: lv, at: bars[i].t, holds: (c - lv) * d > 0 };
    }
  }
  return null;
}

/* ---------------- الاتجاه: هيكل القمم والقيعان ---------------- */
function e3pivots(bars, k) {
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
  var w = e3tail(bars || [], E3.PIV_WIN), pv = e3pivots(w, E3.PIV_K);
  if (pv.hi.length < 2 || pv.lo.length < 2) return 0;
  var H1 = w[pv.hi[pv.hi.length - 2]].h, H2 = w[pv.hi[pv.hi.length - 1]].h;
  var L1 = w[pv.lo[pv.lo.length - 2]].l, L2 = w[pv.lo[pv.lo.length - 1]].l;
  if (H2 > H1 && L2 > L1) return 1;
  if (H2 < H1 && L2 < L1) return -1;
  return 0;
}
function trendOf(inp) {
  var tf = { "1h": swingTrend(inp.h1), "4h": swingTrend(inp.h4), "1d": swingTrend(inp.d1) };
  var up = 0, dn = 0;
  for (var k in tf) { if (tf[k] > 0) up++; else if (tf[k] < 0) dn++; }
  return { tf: tf, dir: (up >= 2 && dn === 0) ? 1 : ((dn >= 2 && up === 0) ? -1 : 0) };
}

/* ---------------- المتوسطات: استراتيجيةٌ واحدة ---------------- */
function maOf(h1) {
  var w = e3tail(h1 || [], E3.MA_WIN), c = w.map(function (b) { return b.c; });
  var e = E3.MA.map(function (p) { return e3ema(c, p); }), px = c[c.length - 1];
  if (!(Number.isFinite(px) && e.every(Number.isFinite))) return { dir: 0, e: e, px: px };
  var dir = (px > e[0] && e[0] > e[1] && e[1] > e[2]) ? 1 : ((px < e[0] && e[0] < e[1] && e[1] < e[2]) ? -1 : 0);
  return { dir: dir, e: e, px: px };
}

/* ---------------- المستويات وVWAP ---------------- */
function prevDay(d1) { var b = d1 && d1.length ? d1[d1.length - 1] : null; return b ? { h: b.h, l: b.l, d: b.d } : null; }
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
function todayBars(b15) {
  var day = b15[b15.length - 1].d, i = b15.length - 1;
  while (i > 0 && b15[i - 1].d === day) i--;
  return b15.slice(i);
}
function weekBars(b15, wkOf) {
  var wk = wkOf(b15[b15.length - 1].d), i = b15.length - 1;
  while (i > 0 && wkOf(b15[i - 1].d) === wk) i--;
  return b15.slice(i);
}
function vwapOf(bars) {
  var pv = 0, v = 0;
  for (var i = 0; i < bars.length; i++) if (bars[i].v > 0) { pv += (bars[i].h + bars[i].l + bars[i].c) / 3 * bars[i].v; v += bars[i].v; }
  return v > 0 ? pv / v : null;
}

/* =====================================================================
   حالة الرمز عند شمعة القرار — الاستراتيجيات الخمس كما هي الآن، بلا جهة صفقة.
   `wkOf` تحوّل تاريخ الجلسة إلى مفتاح أسبوع (يمرّرها الباني).
   ===================================================================== */
function stateAt(inp, wkOf) {
  var b15 = inp.b15 || [], d1 = inp.d1 || [];
  if (b15.length < E3.ATR_P + 2 || d1.length < E3.ATR_P + 2) return null;
  var b = b15[b15.length - 1];
  var pd = prevDay(d1), pw = prevWeek(d1, inp.wk);
  var tb = todayBars(b15), wb = weekBars(b15, wkOf);
  return {
    t: b.t, px: b.c, b: b,
    pd: pd, pw: pw,
    dayEvtNow: pd ? crossEvents(b, pd.h, pd.l, "pd") : [],
    day: pd ? lastCross(tb, pd.h, pd.l, "pd") : null,
    week: pw ? lastCross(wb, pw.h, pw.l, "pw") : null,
    ma: maOf(inp.h1),
    trend: trendOf(inp),
    vwap: vwapOf(tb),
    atrD: e3atr(e3tail(d1, E3.ATR_WIN), E3.ATR_P),
    atr15: e3atr(e3tail(b15, E3.ATR_WIN), E3.ATR_P)
  };
}

/* النقاط لجهةٍ d من حالةٍ ما — مصدرٌ واحد للعرض والتحذيرات والتقييم */
function scoreFor(st, d) {
  var el = {
    day: !!(st.day && st.day.d === d && st.day.holds),
    ma: st.ma.dir === d,
    trend: st.trend.dir === d,
    vwap: st.vwap !== null && (st.px - st.vwap) * d > 0,
    week: !!(st.week && st.week.d === d && st.week.holds)
  };
  var pts = {}, sum = 0;
  for (var k in E3.W) { pts[k] = el[k] ? E3.W[k] : 0; sum += pts[k]; }
  return { el: el, pts: pts, score: Math.round(sum * 100) / 100 };
}

/* ---------------- الوقف والأهداف ---------------- */
function stopOf(e, d, h1, atr15) {
  var w = e3tail(h1 || [], E3.PIV_WIN), pv = e3pivots(w, E3.PIV_K), idx = d > 0 ? pv.lo : pv.hi;
  for (var i = idx.length - 1; i >= 0; i--) {
    var p = d > 0 ? w[idx[i]].l : w[idx[i]].h;
    if ((e - p) * d > 0) return { p: p - d * E3.STOP_BUF * atr15, at: w[idx[i]].t, pivot: p };
  }
  return null;
}
function targetsOf(e, d, risk, st, h1) {
  var w = e3tail(h1 || [], E3.PIV_WIN), pv = e3pivots(w, E3.PIV_K), c = [];
  if (st.pd) { c.push({ p: st.pd.h, src: "PDH" }); c.push({ p: st.pd.l, src: "PDL" }); }
  if (st.pw) { c.push({ p: st.pw.h, src: "PWH" }); c.push({ p: st.pw.l, src: "PWL" }); }
  pv.hi.forEach(function (i) { c.push({ p: w[i].h, src: "1h" }); });
  pv.lo.forEach(function (i) { c.push({ p: w[i].l, src: "1h" }); });
  var ahead = c.filter(function (x) { return Number.isFinite(x.p) && (x.p - e) * d > 0; })
               .sort(function (a, b) { return (a.p - b.p) * d; });
  var merged = [];
  for (var i = 0; i < ahead.length; i++) {
    if (merged.length && Math.abs(ahead[i].p - merged[merged.length - 1].p) < E3.TGT_MERGE_ATR * st.atrD) continue;
    merged.push(ahead[i]);
  }
  var out = merged.filter(function (x) { return (x.p - e) * d / risk >= E3.MIN_RR; }).slice(0, 3);
  // إكمالٌ بمضاعفات المخاطرة حتى هدفين — موسومةٌ صراحةً، ولا يُكمَّل الثالث بها
  while (out.length < E3.MIN_TGTS) {
    var lastR = out.length ? (out[out.length - 1].p - e) * d / risk : 0;
    var k = Math.floor(lastR + 1e-9) + 1;
    out.push({ p: e + d * k * risk, src: "R" + k });
  }
  return out;
}

/* =====================================================================
   التقييم عند شمعة القرار: هل تتولّد فرصة؟ يحتاج حالة الساعة السابقة لتحوّل
   المتوسطات (`maPrev`: جهة المتوسطات قبل اكتمال آخر شمعة ساعة، أو undefined
   إن لم تكتمل شمعة ساعة عند هذه الشمعة).
   ===================================================================== */
function evaluate(inp, wkOf, maPrev) {
  var st = stateAt(inp, wkOf);
  if (!st) return { reject: "data" };
  var base = null, d = 0, evt = null;
  if (st.dayEvtNow.length) { evt = st.dayEvtNow[0]; d = E3_EVT[evt].d; base = "day"; }
  else if (maPrev !== undefined && st.ma.dir !== 0 && st.ma.dir !== maPrev) { d = st.ma.dir; base = "ma"; }
  if (!d) return { reject: "nobase", st: st };
  if (!(st.atrD > 0 && st.atr15 > 0)) return { reject: "atr", st: st };
  var sc = scoreFor(st, d);
  var e = st.px, stop = stopOf(e, d, inp.h1, st.atr15);
  if (!stop) return { reject: "nostop", st: st };
  var risk = (e - stop.p) * d;
  if (!(risk > 0) || risk > E3.MAX_RISK_ATR * st.atrD) return { reject: "risk", st: st };
  var tg = targetsOf(e, d, risk, st, inp.h1);
  return { reject: null, st: st, sig: {
    d: d, base: base, evt: base === "day" ? evt : (st.day && st.day.d === d && st.day.holds ? st.day.evt : null),
    weekEvt: st.week && st.week.d === d && st.week.holds ? st.week.evt : null,
    t: st.t, e: e, st: stop.p, stopPivot: stop.pivot, risk: risk, tg: tg,
    rr1: (tg[0].p - e) * d / risk, atrD: st.atrD, atr15: st.atr15,
    el: sc.el, pts: sc.pts, score: sc.score,
    ma: st.ma.dir, trend: st.trend.dir, trendTf: st.trend.tf, vwap: st.vwap,
    pdh: st.pd && st.pd.h, pdl: st.pd && st.pd.l, pwh: st.pw && st.pw.h, pwl: st.pw && st.pw.l
  } };
}

/* =====================================================================
   **لقطة الساعة** — قرار المالك 2026-10-01 (§4ب في المواصفة).

   كلُّ ساعة بدايةٌ جديدة بالكامل: لا فرصة ولا خطة ولا هدف يُحمَل من الساعة
   السابقة. يُحلَّل الرمز من الصفر على آخر الشموع المغلقة، فإن تحقّق شرطُ فرصةٍ
   الآن أُنشئت فرصةٌ جديدة مستقلّة بجهتها ودرجتها ودخولها ووقفها وأهدافها.

   شرطُ الفرصة الآن = إحدى الأساسيتين **قائمةٌ الآن**:
     · قمة/قاع أمس: آخر عبورٍ بالجسم خلال جلسة اليوم ما زال قائماً ⇒ جهتُه، أو
     · المتوسطات: ترتيبٌ كامل شراءً أو بيعاً ⇒ جهتُه.
   و«أمس» يسبق عند اختلافهما (الأساس الأوّل). الدخول = إغلاق آخر شمعة مغلقة.
   ===================================================================== */
function evaluateHour(inp, wkOf) {
  var st = stateAt(inp, wkOf);
  if (!st) return { reject: "data" };
  var d = 0, base = null;
  if (st.day && st.day.holds) { d = st.day.d; base = "day"; }
  else if (st.ma.dir !== 0) { d = st.ma.dir; base = "ma"; }
  if (!d) return { reject: "nobase", st: st };
  if (!(st.atrD > 0 && st.atr15 > 0)) return { reject: "atr", st: st };
  var sc = scoreFor(st, d);
  var e = st.px, stop = stopOf(e, d, inp.h1, st.atr15);
  if (!stop) return { reject: "nostop", st: st };
  var risk = (e - stop.p) * d;
  if (!(risk > 0) || risk > E3.MAX_RISK_ATR * st.atrD) return { reject: "risk", st: st };
  var tg = targetsOf(e, d, risk, st, inp.h1);
  return { reject: null, st: st, sig: {
    d: d, base: base, evt: st.day && st.day.d === d && st.day.holds ? st.day.evt : null,
    weekEvt: st.week && st.week.d === d && st.week.holds ? st.week.evt : null,
    t: st.t, e: e, st: stop.p, stopPivot: stop.pivot, risk: risk, tg: tg,
    rr1: (tg[0].p - e) * d / risk, atrD: st.atrD, atr15: st.atr15,
    el: sc.el, pts: sc.pts, score: sc.score,
    ma: st.ma.dir, trend: st.trend.dir, trendTf: st.trend.tf, vwap: st.vwap,
    pdh: st.pd && st.pd.h, pdl: st.pd && st.pd.l, pwh: st.pw && st.pw.h, pwl: st.pw && st.pw.l
  } };
}

/* =====================================================================
   إدارة الصفقة على شموع 15د الرسمية المغلقة.
   ===================================================================== */
function fillTrade(tr, bar) {
  var d = tr.d;
  if ((bar.o - tr.st) * d <= 0) { tr.status = "cancelled"; tr.end = { k: "gap", t: bar.t, px: bar.o }; return tr; }
  tr.status = "active";
  tr.fill = { t: bar.t, px: bar.o };
  tr.day = bar.d; tr.sess = 0; tr.hit = 0; tr.beNext = false; tr.stNow = tr.st;
  return stepTrade(tr, bar, true);
}
function stepTrade(tr, bar, first) {
  if (tr.status !== "active") return tr;
  var d = tr.d;
  if (!first && bar.d !== tr.day) { tr.day = bar.d; tr.sess++; }
  if (tr.beNext) { tr.stNow = tr.fill.px; tr.beNext = false; }
  var adv = d > 0 ? bar.l : bar.h, fav = d > 0 ? bar.h : bar.l;
  if ((adv - tr.stNow) * d <= 0) {
    var px = d > 0 ? Math.min(bar.o, tr.stNow) : Math.max(bar.o, tr.stNow);
    return closeTrade(tr, tr.hit ? "be" : "stop", bar.t, px);
  }
  while (tr.hit < tr.tg.length && (fav - tr.tg[tr.hit].p) * d >= 0) {
    tr.hit++;
    if (tr.hit === 1) tr.beNext = true;
  }
  if (tr.hit >= tr.tg.length) return closeTrade(tr, "tgt", bar.t, tr.tg[tr.tg.length - 1].p);
  if (bar.last && tr.sess >= E3.EXPIRY_SESS) return closeTrade(tr, "exp", bar.t, bar.c);
  return tr;
}
function closeTrade(tr, k, t, px) {
  tr.status = "closed";
  tr.end = { k: k, t: t, px: px };
  delete tr.beNext;
  return tr;
}
/* R بعد التكلفة (للتقييم): المقام = المخاطرة المعلنة */
function tradeR(tr, costs) {
  if (tr.status !== "closed" || !tr.fill) return null;
  var d = tr.d, slip = costs ? E3.SLIP_ATR * tr.atrD : 0, fee = costs ? E3.FEE : 0;
  var F = tr.fill.px + d * slip, x = tr.end.px - d * slip;
  return ((x - F) * d - fee * (F + x)) / tr.risk;
}

var ENGINE3 = { E3: E3, E3_EVT: E3_EVT, e3ema: e3ema, e3atr: e3atr, crossEvents: crossEvents,
  lastCross: lastCross, e3pivots: e3pivots, swingTrend: swingTrend, trendOf: trendOf, maOf: maOf,
  prevDay: prevDay, prevWeek: prevWeek, vwapOf: vwapOf, stateAt: stateAt, scoreFor: scoreFor,
  stopOf: stopOf, targetsOf: targetsOf, evaluate: evaluate, evaluateHour: evaluateHour, fillTrade: fillTrade,
  stepTrade: stepTrade, tradeR: tradeR };
if (typeof module !== "undefined" && module.exports) module.exports = ENGINE3;
