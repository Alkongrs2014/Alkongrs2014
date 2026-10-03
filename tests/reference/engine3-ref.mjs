/* =====================================================================
   مرجعٌ مستقلّ للمحرّك V3 — مكتوبٌ من docs/ENGINE_V3_SPEC.md مباشرةً،
   **بلا أيّ استيراد من الإنتاج** (اختبار الاستقلال في reference.test.mjs).
   يأخذ نفس كائن المدخلات (شموعٌ مغلقة) ويعيد نفس القرار.
   ===================================================================== */
const W = { day: 40, ma: 40, trend: 6.67, vwap: 6.67, week: 6.66 };
const K = 3, WIN = 120;
const last = (a, n) => a.slice(Math.max(0, a.length - n));

/* §2 — حدثُ العبور بجسم الشمعة، بترتيب الجدول */
export function crossRef(o, c, H, L, pre) {
  const out = [];
  if (o <= H && c > H) out.push(pre + "h_break");
  if (o < L && c > L) out.push(pre + "l_reclaim");
  if (o >= L && c < L) out.push(pre + "l_break");
  if (o > H && c < H) out.push(pre + "h_loss");
  return out;
}
const dirOfEvt = (e) => /h_break|l_reclaim/.test(e) ? 1 : -1;

function lastCrossRef(bars, H, L, pre) {
  for (let i = bars.length - 1; i >= 0; i--) {
    const ev = crossRef(bars[i].o, bars[i].c, H, L, pre);
    if (!ev.length) continue;
    const e = ev[0], d = dirOfEvt(e), lv = e.includes("h_") ? H : L;
    return { evt: e, d, holds: d * (bars[bars.length - 1].c - lv) > 0 };
  }
  return null;
}
function emaRef(xs, p) {
  if (xs.length < p) return null;
  let v = xs.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < xs.length; i++) v += (2 / (p + 1)) * (xs[i] - v);
  return v;
}
function atrRef(b, p = 14) {
  if (b.length < p + 1) return null;
  const tr = [];
  for (let i = 1; i < b.length; i++) tr.push(Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)));
  let a = tr.slice(0, p).reduce((x, y) => x + y, 0) / p;
  for (let i = p; i < tr.length; i++) a = (a * (p - 1) + tr[i]) / p;
  return a;
}
function pivRef(w) {
  const hi = [], lo = [];
  for (let i = K; i + K < w.length; i++) {
    let h = true, l = true;
    for (let j = i - K; j <= i + K; j++) if (j !== i) { if (w[j].h > w[i].h) h = false; if (w[j].l < w[i].l) l = false; }
    if (h) hi.push(i);
    if (l) lo.push(i);
  }
  return { hi, lo };
}
function swingRef(bars) {
  const w = last(bars || [], WIN), { hi, lo } = pivRef(w);
  if (hi.length < 2 || lo.length < 2) return 0;
  const h1 = w[hi[hi.length - 2]].h, h2 = w[hi[hi.length - 1]].h, l1 = w[lo[lo.length - 2]].l, l2 = w[lo[lo.length - 1]].l;
  return h2 > h1 && l2 > l1 ? 1 : (h2 < h1 && l2 < l1 ? -1 : 0);
}
function maRef(h1) {
  const c = last(h1 || [], 259).map((b) => b.c), px = c[c.length - 1];
  const [a, b, d] = [20, 50, 200].map((p) => emaRef(c, p));
  if ([a, b, d, px].some((x) => x === null || !Number.isFinite(x))) return 0;
  return px > a && a > b && b > d ? 1 : (px < a && a < b && b < d ? -1 : 0);
}

/* القرار عند شمعة القرار: `maPrev` كما في الإنتاج (undefined إن لم تكتمل ساعة) */
export function evaluateRef(inp, wkOf, maPrev) {
  const b15 = inp.b15, d1 = inp.d1;
  if (b15.length < 16 || d1.length < 16) return { reject: "data" };
  const b = b15[b15.length - 1];
  const pd = d1[d1.length - 1];
  let pw = null;
  for (const x of d1) if (x.w < inp.wk) {
    if (!pw || x.w > pw.w) pw = { w: x.w, h: x.h, l: x.l };
    else if (x.w === pw.w) { pw.h = Math.max(pw.h, x.h); pw.l = Math.min(pw.l, x.l); }
  }
  const today = b15.filter((x) => x.d === b.d);
  const weekB = b15.filter((x) => wkOf(x.d) === wkOf(b.d));
  const day = lastCrossRef(today, pd.h, pd.l, "pd");
  const week = pw ? lastCrossRef(weekB, pw.h, pw.l, "pw") : null;
  const ma = maRef(inp.h1);
  const ts = [swingRef(inp.h1), swingRef(inp.h4), swingRef(d1)];
  const up = ts.filter((x) => x === 1).length, dn = ts.filter((x) => x === -1).length;
  const trend = up >= 2 && !dn ? 1 : (dn >= 2 && !up ? -1 : 0);
  let pv = 0, vv = 0;
  for (const x of today) if (x.v > 0) { pv += x.v * (x.h + x.l + x.c) / 3; vv += x.v; }
  const vwap = vv > 0 ? pv / vv : null;

  const now = crossRef(b.o, b.c, pd.h, pd.l, "pd");
  let d = 0, base = null;
  if (now.length) { d = dirOfEvt(now[0]); base = "day"; }
  else if (maPrev !== undefined && ma !== 0 && ma !== maPrev) { d = ma; base = "ma"; }
  if (!d) return { reject: "nobase" };
  const atrD = atrRef(last(d1, 259)), atr15 = atrRef(last(b15, 259));
  if (!(atrD > 0 && atr15 > 0)) return { reject: "atr" };
  const el = {
    day: !!(day && day.d === d && day.holds), ma: ma === d, trend: trend === d,
    vwap: vwap !== null && d * (b.c - vwap) > 0, week: !!(week && week.d === d && week.holds)
  };
  const score = Math.round(Object.keys(W).reduce((a, k) => a + (el[k] ? W[k] : 0), 0) * 100) / 100;
  // الوقف: أحدثُ قاعٍ (قمّةٍ) مؤكَّد على الساعة خلف الدخول
  const hw = last(inp.h1, WIN), pv2 = pivRef(hw), list = d > 0 ? pv2.lo : pv2.hi;
  let stop = null;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = d > 0 ? hw[list[i]].l : hw[list[i]].h;
    if (d * (b.c - p) > 0) { stop = p - d * atr15 / 10; break; }
  }
  if (stop === null) return { reject: "nostop" };
  const risk = d * (b.c - stop);
  if (!(risk > 0) || risk > atrD) return { reject: "risk" };
  const cand = [pd.h, pd.l, ...(pw ? [pw.h, pw.l] : []), ...pv2.hi.map((i) => hw[i].h), ...pv2.lo.map((i) => hw[i].l)]
    .filter((x) => d * (x - b.c) > 0).sort((x, y) => d * (x - y));
  const merged = [];
  for (const x of cand) { if (merged.length && Math.abs(x - merged[merged.length - 1]) < atrD / 10) continue; merged.push(x); }
  const tg = merged.filter((x) => d * (x - b.c) / risk >= 1).slice(0, 3);
  while (tg.length < 2) {
    const lr = tg.length ? d * (tg[tg.length - 1] - b.c) / risk : 0;
    tg.push(b.c + d * (Math.floor(lr + 1e-9) + 1) * risk);
  }
  return { reject: null, d, base, el, score, e: b.c, st: stop, tg };
}

/* §6 — الإدارة مرجعياً: الإشارة وشموع ما بعد التأكيد */
export function manageRef(sig, bars) {
  const d = sig.d, f = bars[0];
  if (d * (f.o - sig.st) <= 0) return { k: "gap" };
  const F = f.o;
  let stop = sig.st, hit = 0, day = f.d, sess = 0, be = false;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i > 0 && b.d !== day) { day = b.d; sess++; }
    if (be) { stop = F; be = false; }
    if (d * ((d > 0 ? b.l : b.h) - stop) <= 0) return { k: hit ? "be" : "stop", px: d > 0 ? Math.min(b.o, stop) : Math.max(b.o, stop), hit };
    while (hit < sig.tg.length && d * ((d > 0 ? b.h : b.l) - sig.tg[hit]) >= 0) { hit++; if (hit === 1) be = true; }
    if (hit === sig.tg.length) return { k: "tgt", px: sig.tg[hit - 1], hit };
    if (b.last && sess >= 5) return { k: "exp", px: b.c, hit };
  }
  return null;
}

/* =====================================================================
   §4ب لقطة الساعة (قرار 2026-10-01) — مرجعياً من المواصفة:
   الجهة من عبور أمس القائم اليوم، وإلا من ترتيب المتوسطات؛ ثم نفس الدرجة
   والوقف والأهداف، والدخول إغلاق آخر شمعة مغلقة.
   ===================================================================== */
export function evaluateHourRef(inp, wkOf) {
  const b15 = inp.b15, d1 = inp.d1;
  if (b15.length < 16 || d1.length < 16) return { reject: "data" };
  const b = b15[b15.length - 1];
  const pd = d1[d1.length - 1];
  const today = b15.filter((x) => x.d === b.d);
  const day = lastCrossRef(today, pd.h, pd.l, "pd");
  const ma = maRef(inp.h1);
  let d = 0, base = null;
  if (day && day.holds) { d = day.d; base = "day"; }
  else if (ma !== 0) { d = ma; base = "ma"; }
  if (!d) return { reject: "nobase" };
  // بقية القرار كالحدث: نفس الدرجة والوقف والأهداف بجهة d — يُعاد استعمال المرجع
  // بفرض حدثٍ مكافئ: لا يوجد في المرجع إلا حسابٌ واحد للدرجة والخطة
  return planRef(inp, wkOf, d, base);
}
function planRef(inp, wkOf, d, base, elOver) {
  const b15 = inp.b15, d1 = inp.d1, b = b15[b15.length - 1], pd = d1[d1.length - 1];
  let pw = null;
  for (const x of d1) if (x.w < inp.wk) {
    if (!pw || x.w > pw.w) pw = { w: x.w, h: x.h, l: x.l };
    else if (x.w === pw.w) { pw.h = Math.max(pw.h, x.h); pw.l = Math.min(pw.l, x.l); }
  }
  const today = b15.filter((x) => x.d === b.d), weekB = b15.filter((x) => wkOf(x.d) === wkOf(b.d));
  const day = lastCrossRef(today, pd.h, pd.l, "pd"), week = pw ? lastCrossRef(weekB, pw.h, pw.l, "pw") : null;
  const ma = maRef(inp.h1);
  const ts = [swingRef(inp.h1), swingRef(inp.h4), swingRef(d1)];
  const up = ts.filter((x) => x === 1).length, dn = ts.filter((x) => x === -1).length;
  const trend = up >= 2 && !dn ? 1 : (dn >= 2 && !up ? -1 : 0);
  let pv = 0, vv = 0;
  for (const x of today) if (x.v > 0) { pv += x.v * (x.h + x.l + x.c) / 3; vv += x.v; }
  const vwap = vv > 0 ? pv / vv : null;
  const atrD = atrRef(last(d1, 259)), atr15 = atrRef(last(b15, 259));
  if (!(atrD > 0 && atr15 > 0)) return { reject: "atr" };
  const el = elOver || { day: !!(day && day.d === d && day.holds), ma: ma === d, trend: trend === d,
               vwap: vwap !== null && d * (b.c - vwap) > 0, week: !!(week && week.d === d && week.holds) };
  const score = Math.round(Object.keys(W).reduce((a, k) => a + (el[k] ? W[k] : 0), 0) * 100) / 100;
  const hw = last(inp.h1, WIN), pv2 = pivRef(hw), list = d > 0 ? pv2.lo : pv2.hi;
  let stop = null;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = d > 0 ? hw[list[i]].l : hw[list[i]].h;
    if (d * (b.c - p) > 0) { stop = p - d * atr15 / 10; break; }
  }
  if (stop === null) return { reject: "nostop" };
  const risk = d * (b.c - stop);
  if (!(risk > 0) || risk > atrD) return { reject: "risk" };
  const cand = [pd.h, pd.l, ...(pw ? [pw.h, pw.l] : []), ...pv2.hi.map((i) => hw[i].h), ...pv2.lo.map((i) => hw[i].l)]
    .filter((x) => d * (x - b.c) > 0).sort((x, y) => d * (x - y));
  const merged = [];
  for (const x of cand) { if (merged.length && Math.abs(x - merged[merged.length - 1]) < atrD / 10) continue; merged.push(x); }
  const tg = merged.filter((x) => d * (x - b.c) / risk >= 1).slice(0, 3);
  while (tg.length < 2) {
    const lr = tg.length ? d * (tg[tg.length - 1] - b.c) / risk : 0;
    tg.push(b.c + d * (Math.floor(lr + 1e-9) + 1) * risk);
  }
  return { reject: null, d, base, el, score, e: b.c, st: stop, tg };
}

/* =====================================================================
   §4ج الفريمات الأربعة (قرار 2026-10-03) — مرجعياً من المواصفة:
   كلُّ استراتيجيةٍ على شموع كلّ فريمٍ المغلقة، والنقاط مرّةً واحدة إن تحقّقت على
   فريمٍ واحد على الأقل؛ والاتجاه إجماع 1h/4h/1d كما كان. والفرصة من إشارةٍ جديدة
   أُغلقت شمعتُها في (prevH, H]: عبورُ أمس القائم على 15د/ساعة/4س، وإلا انقلابُ
   ترتيب المتوسطات على أيّ فريم. «أمس» أوّلاً، ثم الأحدث، ثم الأدقّ.
   ===================================================================== */
const TFR = ["15m", "1h", "4h", "1d"];
function lastCrossEndRef(bars, H, L, pre) {
  for (let i = bars.length - 1; i >= 0; i--) {
    const ev = crossRef(bars[i].o, bars[i].c, H, L, pre);
    if (!ev.length) continue;
    const d = dirOfEvt(ev[0]), lv = ev[0].includes("h_") ? H : L;
    return { evt: ev[0], d, end: bars[i].end, holds: d * (bars[bars.length - 1].c - lv) > 0 };
  }
  return null;
}
function maDirAt(bars) {
  const c = last(bars, 259).map((b) => b.c), px = c[c.length - 1];
  const e = [20, 50, 200].map((p) => emaRef(c, p));
  if (e.some((x) => x === null) || !Number.isFinite(px)) return { dir: 0, ok: false };
  return { dir: px > e[0] && e[0] > e[1] && e[1] > e[2] ? 1 : (px < e[0] && e[0] < e[1] && e[1] < e[2] ? -1 : 0), ok: true };
}
export function evaluateSlotRef(inp, wkOf, prevH) {
  const b15 = inp.b15, d1 = inp.d1;
  if (b15.length < 16 || d1.length < 16) return { reject: "data" };
  const b = b15[b15.length - 1], pd = d1[d1.length - 1];
  let pw = null;
  for (const x of d1) if (x.w < inp.wk) {
    if (!pw || x.w > pw.w) pw = { w: x.w, h: x.h, l: x.l };
    else if (x.w === pw.w) { pw.h = Math.max(pw.h, x.h); pw.l = Math.min(pw.l, x.l); }
  }
  const F = { "15m": b15, "1h": inp.h1 || [], "4h": inp.h4 || [], "1d": d1 };
  const today15 = b15.filter((x) => x.d === b.d);
  const per = {};
  TFR.forEach((tf) => {
    const bars = F[tf];
    const today = bars.filter((x) => x.d === b.d), wkb = bars.filter((x) => wkOf(x.d) === inp.wk);
    const tail = last(bars, 260);
    const now = maDirAt(tail), before = maDirAt(tail.slice(0, -1));
    let vw = null;
    if (tf !== "1d" && today.length) {
      const lb = today[today.length - 1];
      let pv = 0, vv = 0;
      for (const x of today15) if (x.end <= lb.end && x.v > 0) { pv += x.v * (x.h + x.l + x.c) / 3; vv += x.v; }
      if (vv > 0) { const v = pv / vv; vw = lb.c > v ? 1 : (lb.c < v ? -1 : 0); }
    }
    per[tf] = {
      day: tf === "1d" ? null : lastCrossEndRef(today, pd.h, pd.l, "pd"),
      week: pw ? lastCrossEndRef(wkb, pw.h, pw.l, "pw") : null,
      ma: now.dir, flip: now.ok && now.dir !== 0 && now.dir !== before.dir, maEnd: tail.length ? tail[tail.length - 1].end : null,
      vw
    };
  });
  const cands = [];
  TFR.forEach((tf, o) => {
    const p = per[tf];
    if (p.day && p.day.holds && p.day.end > prevH) cands.push({ base: "day", tf, d: p.day.d, end: p.day.end, o });
    if (p.flip && p.maEnd > prevH) cands.push({ base: "ma", tf, d: p.ma, end: p.maEnd, o });
  });
  if (!cands.length) return { reject: "nobase" };
  cands.sort((x, y) => (x.base !== y.base ? (x.base === "day" ? -1 : 1) : 0) || (y.end - x.end) || (x.o - y.o));
  const top = cands[0], d = top.d;
  const ts = [swingRef(inp.h1), swingRef(inp.h4), swingRef(d1)];
  const up = ts.filter((x) => x === 1).length, dn = ts.filter((x) => x === -1).length;
  const sat = (k) => TFR.filter((tf) => {
    const p = per[tf];
    if (k === "day" || k === "week") return !!(p[k] && p[k].d === d && p[k].holds);
    if (k === "ma") return p.ma === d;
    return p.vw === d;
  });
  const el = { day: sat("day").length > 0, ma: sat("ma").length > 0, trend: (up >= 2 && !dn ? 1 : (dn >= 2 && !up ? -1 : 0)) === d,
               vwap: sat("vwap").length > 0, week: sat("week").length > 0 };
  const r = planRef(inp, wkOf, d, top.base, el);
  if (r.reject) return r;
  return { ...r, baseTf: top.tf, tfs: { day: sat("day"), ma: sat("ma"), vwap: sat("vwap"), week: sat("week") } };
}
