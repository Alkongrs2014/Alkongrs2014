/* =====================================================================
   مرجعٌ مستقلّ للمحرّك V2 — مكتوبٌ من docs/ENGINE_V2_SPEC.md مباشرةً
   **بلا أيّ استيراد من الإنتاج** (اختبار الاستقلال في reference.test.mjs
   يمنع ذلك). يأخذ نفس كائن المدخلات (شموعٌ مغلقة) ويعيد نفس القرار.
   ===================================================================== */
const K = 3, WIN = 120;

function last(a, n) { return a.slice(Math.max(0, a.length - n)); }

function emaLast(xs, p) {
  if (xs.length < p) return null;
  let v = 0;
  for (let i = 0; i < p; i++) v += xs[i];
  v = v / p;
  const a = 2 / (p + 1);
  for (let i = p; i < xs.length; i++) v = v + a * (xs[i] - v);
  return v;
}
function atrRef(bars, p = 14) {
  if (bars.length < p + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const { h, l } = bars[i], pc = bars[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let a = trs.slice(0, p).reduce((s, x) => s + x, 0) / p;
  for (let i = p; i < trs.length; i++) a = (a * 13 + trs[i]) / 14;
  return a;
}
function isPivot(w, i, key, better) {
  for (let j = i - K; j <= i + K; j++) if (j !== i && better(w[j][key], w[i][key])) return false;
  return true;
}
function pivotsRef(w) {
  const hi = [], lo = [];
  for (let i = K; i + K < w.length; i++) {
    if (isPivot(w, i, "h", (a, b) => a > b)) hi.push(w[i].h);
    if (isPivot(w, i, "l", (a, b) => a < b)) lo.push(w[i].l);
  }
  return { hi, lo };
}
export function trendRef(bars) {
  const { hi, lo } = pivotsRef(last(bars || [], WIN));
  if (hi.length < 2 || lo.length < 2) return 0;
  const [h1, h2] = hi.slice(-2), [l1, l2] = lo.slice(-2);
  return h2 > h1 && l2 > l1 ? 1 : (h2 < h1 && l2 < l1 ? -1 : 0);
}
export function clearRef(ts) {
  const up = ts.filter(x => x === 1).length, dn = ts.filter(x => x === -1).length;
  return up >= 2 && !dn ? 1 : (dn >= 2 && !up ? -1 : 0);
}

export function evaluateRef(inp) {
  const b15 = inp.b15 || [], d1 = inp.d1 || [];
  if (b15.length < 16 || d1.length < 16) return { reject: "data" };
  const md = clearRef([trendRef(inp.mkt.h1), trendRef(inp.mkt.h4), trendRef(inp.mkt.d1)]);
  const sd = clearRef([trendRef(inp.h1), trendRef(inp.h4), trendRef(inp.d1)]);
  const d = md && md === sd ? md : 0;
  if (!d) return { d: 0, reject: "gate" };
  const atrD = atrRef(last(d1, 259)), atr15 = atrRef(last(b15, 259));
  if (!(atrD > 0 && atr15 > 0)) return { d, reject: "atr" };
  const pd = d1[d1.length - 1];
  let pw = null;
  for (const x of d1) if (x.w < inp.wk && (!pw || x.w >= pw.w)) {
    if (!pw || x.w > pw.w) pw = { w: x.w, h: x.h, l: x.l };
    else { pw.h = Math.max(pw.h, x.h); pw.l = Math.min(pw.l, x.l); }
  }
  const lv = [["PDH", pd.h], ["PDL", pd.l]];
  if (pw) lv.push(["PWH", pw.h], ["PWL", pw.l]);
  const b = b15[b15.length - 1], p = b15[b15.length - 2];
  const range = b.h - b.l;
  const pos = d > 0 ? (b.c - b.l) : (b.h - b.c);
  if (!(range > 0) || pos < range / 2) return { d, reject: "notrig" };
  const trig = lv.filter(([, L]) => d > 0 ? (p.c <= L && b.c > L + atr15 / 10) : (p.c >= L && b.c < L - atr15 / 10)).map(x => x[0]);
  if (!trig.length) return { d, reject: "notrig" };

  const c1 = last(inp.h1, 259).map(x => x.c);
  const e20 = emaLast(c1, 20), e50 = emaLast(c1, 50), e200 = emaLast(c1, 200), px = c1[c1.length - 1];
  const stacked = (e20 !== null && e50 !== null && e200 !== null) &&
    (d > 0 ? (px > e20 && e20 > e50 && e50 > e200) : (px < e20 && e20 < e50 && e50 < e200));
  let pv = 0, vv = 0;
  for (let i = b15.length - 1; i >= 0 && b15[i].d === b.d; i--) if (b15[i].v > 0) {
    pv += b15[i].v * (b15[i].h + b15[i].l + b15[i].c) / 3; vv += b15[i].v;
  }
  const vw = vv > 0 ? pv / vv : null;
  const beyond = (hi, lo) => d > 0 ? b.c > hi : b.c < lo;
  const el = {
    trend: 1,
    ma: stacked ? 1 : 0,
    day: (trig.includes("PDH") || trig.includes("PDL") || beyond(pd.h, pd.l)) ? 1 : 0,
    vwap: vw !== null && (d > 0 ? b.c > vw : b.c < vw) ? 1 : 0,
    week: pw && (trig.includes("PWH") || trig.includes("PWL") || beyond(pw.h, pw.l)) ? 1 : 0
  };
  const count = el.trend + el.ma + el.day + el.vwap + el.week;
  const w4 = last(b15, 4);
  const stop = d > 0 ? Math.min(...w4.map(x => x.l)) - atr15 / 10 : Math.max(...w4.map(x => x.h)) + atr15 / 10;
  const risk = d * (b.c - stop);
  if (!(risk > 0) || risk > atrD) return { d, reject: "risk", count };
  const hw = last(inp.h1, WIN), pvh = pivotsRef(hw);
  const cand = [pd.h, pd.l, ...(pw ? [pw.h, pw.l] : []), ...pvh.hi, ...pvh.lo]
    .filter(x => d * (x - b.c) > 0).sort((a, b2) => d * (a - b2));
  const tg = [];
  for (const x of cand) {
    if (tg.length === 3) break;
    if (tg.length && Math.abs(x - tg[tg.length - 1]) < atrD / 10) continue;
    tg.push(x);
  }
  if (!tg.length) return { d, reject: "notgt", count };
  const rr1 = d * (tg[0] - b.c) / risk;
  if (rr1 < 1) return { d, reject: "rr", count };
  return { d, reject: null, count, el, trig, stop, tg, rr1, atrD, e: b.c };
}

/* إدارة الصفقة مرجعياً: يأخذ الإشارة وشموع ما بعد التأكيد */
export function manageRef(sig, bars) {
  const d = sig.d, slip = 0.05 * sig.atrD;
  const f = bars[0];
  const F = f.o + d * slip;
  let stop = sig.st, hit = 0, day = f.d, sess = 0, be = false;
  const R = (px) => ((px - d * slip - F) * d - 0.0002 * (F + px - d * slip)) / (d * (sig.e - sig.st));
  if (d * (f.o - sig.st) <= 0) return { k: "stop", px: f.o, R: R(f.o), hit: 0 };
  for (const b of bars) {
    if (b.d !== day) { day = b.d; sess += 1; }
    if (be) { stop = F; be = false; }
    const worst = d > 0 ? b.l : b.h, best = d > 0 ? b.h : b.l;
    if (d * (worst - stop) <= 0) {
      const px = d > 0 ? Math.min(b.o, stop) : Math.max(b.o, stop);
      return { k: hit ? "be" : "stop", px, R: R(px), hit };
    }
    while (hit < sig.tg.length && d * (best - sig.tg[hit]) >= 0) { hit++; if (hit === 1) be = true; }
    if (hit === sig.tg.length) { const px = sig.tg[sig.tg.length - 1]; return { k: "tgt", px, R: R(px), hit }; }
    if (b.last && sess >= 5) return { k: "exp", px: b.c, R: R(b.c), hit };
  }
  return null;
}
