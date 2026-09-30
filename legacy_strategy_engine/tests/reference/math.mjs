/* =====================================================================
   المحرّك المرجعيّ — الرياضيات القياسية.

   **مستقلٌّ عن الإنتاج بالبناء**: لا يستورد شيئاً من `stocks/` ولا من
   `scripts/` (اختبار `independence.test.mjs` يقرأ هذا المجلّد ويرفض أيّ
   استيراد). ومكتوبٌ من التعريف الرياضي في `docs/STRATEGY_SPECS.md` §1 لا
   من شيفرة الإنتاج، وبأسلوبٍ مختلف عمداً (دوالّ على مصفوفات، بلا حالةٍ
   متدحرجة حيث يمكن) — كي لا تنتقل زلّةُ تنفيذٍ من نسخةٍ إلى أخرى.

   وهو نفسه يُختبر أولاً على حالاتٍ ذهبية محسوبةٍ يدوياً
   (`tests/golden/math.json`) قبل أن يُستعمل لتوسيع الاختبار: المرجعُ الذي
   لا يُثبَت على حالاتٍ مستقلّة دائرةٌ لا مرجع.

   الاصطلاحات (من المواصفة، لا من الشيفرة):
     · القيمة قبل اكتمال النافذة `null`.
     · EMA بذرتُها متوسّطٌ بسيط لأوّل p قيمة، ثم α = 2/(p+1).
     · RSI وATR وADX بتمهيد Wilder: بذرةٌ بمتوسّط بسيط ثم (قديم×(p−1)+جديد)/p.
     · بولنجر بانحراف **المجتمع** (القسمة على p).
   ===================================================================== */

export const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const nulls = (n) => Array.from({ length: n }, () => null);

export function smaRef(xs, p) {
  return xs.map((_, i) => {
    if (i < p - 1) return null;
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) s += xs[j];
    return s / p;
  });
}

export function emaRef(xs, p) {
  const out = nulls(xs.length);
  if (xs.length < p) return out;
  const a = 2 / (p + 1);
  let prev = xs.slice(0, p).reduce((s, x) => s + x, 0) / p;
  out[p - 1] = prev;
  for (let i = p; i < xs.length; i++) { prev = a * xs[i] + (1 - a) * prev; out[i] = prev; }
  return out;
}

/* RSI بتمهيد Wilder. تساوي السعرين يُعدّ ربحاً صفرياً (لا خسارة) في البذرة. */
export function rsiRef(xs, p = 14) {
  const out = nulls(xs.length);
  if (xs.length <= p) return out;
  const gains = [], losses = [];
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  let g = gains.slice(0, p).reduce((s, x) => s + x, 0) / p;
  let l = losses.slice(0, p).reduce((s, x) => s + x, 0) / p;
  const val = () => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[p] = val();
  for (let i = p + 1; i < xs.length; i++) {
    g = (g * (p - 1) + gains[i - 1]) / p;
    l = (l * (p - 1) + losses[i - 1]) / p;
    out[i] = val();
  }
  return out;
}

export function macdRef(xs, f = 12, s = 26, sg = 9) {
  const ef = emaRef(xs, f), es = emaRef(xs, s);
  const line = xs.map((_, i) => (ef[i] !== null && es[i] !== null) ? ef[i] - es[i] : null);
  const first = line.findIndex((v) => v !== null);
  const signal = nulls(xs.length);
  if (first >= 0) {
    const tail = emaRef(line.slice(first), sg);
    tail.forEach((v, j) => { signal[first + j] = v; });
  }
  const hist = line.map((v, i) => (v !== null && signal[i] !== null) ? v - signal[i] : null);
  return { line, signal, hist };
}

export function bbRef(xs, p = 20, m = 2) {
  const mid = smaRef(xs, p), up = nulls(xs.length), lo = nulls(xs.length);
  for (let i = p - 1; i < xs.length; i++) {
    const w = xs.slice(i - p + 1, i + 1);
    const sd = Math.sqrt(w.reduce((s, x) => s + (x - mid[i]) ** 2, 0) / p);
    up[i] = mid[i] + m * sd; lo[i] = mid[i] - m * sd;
  }
  return { mid, up, lo };
}

export function trueRange(h, l, c) {
  return c.map((_, i) => i === 0 ? h[0] - l[0]
    : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
}

export function atrRef(h, l, c, p = 14) {
  const tr = trueRange(h, l, c), out = nulls(c.length);
  if (tr.length < p) return out;
  let a = tr.slice(0, p).reduce((s, x) => s + x, 0) / p;
  out[p - 1] = a;
  for (let i = p; i < tr.length; i++) { a = (a * (p - 1) + tr[i]) / p; out[i] = a; }
  return out;
}

/* ADX بطريقة Wilder: TR و±DM تبدأ من الشمعة الثانية، البذرة **مجموع**
   أوّل p (لا متوسّط)، ثم المجموع − المجموع/p + الجديد. DX = 100·|+DI − −DI|/(+DI + −DI)،
   وADX بذرتُه متوسّطُ أوّل p قيمة DX ثم تمهيد Wilder. */
export function adxRef(h, l, c, p = 14) {
  const n = c.length;
  const out = { adx: nulls(n), pdi: nulls(n), mdi: nulls(n) };
  if (n < 2 * p + 1) return out;
  const tr = [0], pdm = [0], mdm = [0];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  let str = 0, sp = 0, sm = 0;
  for (let j = 1; j <= p; j++) { str += tr[j]; sp += pdm[j]; sm += mdm[j]; }
  const dx = [];
  for (let t = p; t < n; t++) {
    if (t > p) { str += tr[t] - str / p; sp += pdm[t] - sp / p; sm += mdm[t] - sm / p; }
    if (!(str > 0)) continue;
    const P = 100 * sp / str, M = 100 * sm / str;
    out.pdi[t] = P; out.mdi[t] = M;
    dx.push(P + M > 0 ? 100 * Math.abs(P - M) / (P + M) : 0);
    if (dx.length === p) out.adx[t] = dx.reduce((s, x) => s + x, 0) / p;
    else if (dx.length > p) out.adx[t] = (out.adx[t - 1] * (p - 1) + dx[dx.length - 1]) / p;
  }
  return out;
}

export function stochRef(h, l, c, p = 14, sm = 3) {
  const K = c.map((_, i) => {
    if (i < p - 1) return null;
    const hh = Math.max(...h.slice(i - p + 1, i + 1)), ll = Math.min(...l.slice(i - p + 1, i + 1));
    return hh - ll > 0 ? (c[i] - ll) / (hh - ll) * 100 : null;
  });
  const D = K.map((_, i) => {
    if (i < sm - 1) return null;
    const w = K.slice(i - sm + 1, i + 1);
    return w.every(isNum) ? w.reduce((s, x) => s + x, 0) / sm : null;
  });
  return { k: K, d: D };
}

/* MFI: تدفّقٌ = السعر النموذجي × الحجم، موجبٌ إن ارتفع النموذجي عن سابقه
   وسالبٌ إن انخفض وخارج الحساب إن تساوى. بلا سالب: 100 إن وُجد موجب وإلا null. */
export function mfiRef(h, l, c, v, p = 14) {
  const tp = c.map((_, i) => (h[i] + l[i] + c[i]) / 3);
  return c.map((_, j) => {
    if (j < p) return null;
    let pos = 0, neg = 0;
    for (let m = j - p + 1; m <= j; m++) {
      const flow = tp[m] * (v[m] || 0);
      if (!isNum(flow)) continue;
      if (tp[m] > tp[m - 1]) pos += flow; else if (tp[m] < tp[m - 1]) neg += flow;
    }
    return neg === 0 ? (pos > 0 ? 100 : null) : 100 - 100 / (1 + pos / neg);
  });
}

export function bbWidthRef(xs, p = 20, m = 2) {
  const b = bbRef(xs, p, m);
  return xs.map((_, i) => (b.up[i] !== null && b.mid[i] > 0) ? (b.up[i] - b.lo[i]) / b.mid[i] : null);
}

/* الرتبة المئوية لآخر قيمة: (عدد ما هو أصغر منها) ÷ (العدد − 1) × 100،
   على آخر `win` عنصراً المنتهية منها، وnull تحت عشرين قيمة. */
export function rankLastRef(series, win = 120) {
  const w = series.slice(Math.max(0, series.length - win)).filter(isNum);
  if (w.length < 20) return null;
  const cur = w[w.length - 1];
  return w.filter((x) => x < cur).length / (w.length - 1) * 100;
}

/* مئين قيمةٍ v: نسبةُ ما هو ≤ v إلى الكلّ × 100 (تختلف عن `rankLastRef` عمداً). */
export function pctLeRef(series, v, win = 120) {
  if (!Array.isArray(series) || !isNum(v)) return null;
  const w = series.slice(-win).filter(isNum);
  if (w.length < 20) return null;
  return w.filter((x) => x <= v).length / w.length * 100;
}

/* القمم/القيعان المحلية: قيمةٌ لا يتجاوزها أيٌّ من k جيرانها على كل جانب
   (التساوي مسموح، وnull يُتجاهل). */
export function pivotsRef(arr, k, kind) {
  const out = [];
  for (let i = k; i < arr.length - k; i++) {
    const v = arr[i];
    if (!isNum(v)) continue;
    let ok = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i || arr[j] === null) continue;
      if (kind === "high" ? arr[j] > v : arr[j] < v) { ok = false; break; }
    }
    if (ok) out.push(i);
  }
  return out;
}

export function divergenceRef(h, l, ind, atrS, { k = 3, minGap = 5, lookback = 60, minMove = 0.5 } = {}) {
  const n = ind.length, from = Math.max(0, n - lookback), res = [];
  for (const kind of ["high", "low"]) {
    const px = kind === "high" ? h : l;
    const idx = pivotsRef(px, k, kind).filter((i) => i >= from);
    if (idx.length < 2) continue;
    const b = idx[idx.length - 1];
    let a = null;
    for (let t = idx.length - 2; t >= 0; t--) if (b - idx[t] >= minGap) { a = idx[t]; break; }
    if (a === null) continue;
    if (!isNum(ind[a]) || !isNum(ind[b])) continue;
    const tol = (isNum(atrS && atrS[b]) ? atrS[b] : 0) * minMove;
    const dPx = px[b] - px[a], dInd = ind[b] - ind[a];
    if (Math.abs(dPx) <= tol || dInd === 0) continue;
    if (kind === "high" && dPx > 0 && dInd < 0) res.push({ dir: -1, kind, at: b, bars: b - a });
    if (kind === "low" && dPx < 0 && dInd > 0) res.push({ dir: 1, kind, at: b, bars: b - a });
  }
  return res.sort((x, y) => y.at - x.at);
}

export function obvRef(c, v) {
  const out = [0];
  for (let i = 1; i < c.length; i++) {
    const s = !isNum(c[i]) || !isNum(c[i - 1]) ? 0 : Math.sign(c[i] - c[i - 1]);
    out.push(out[i - 1] + s * (v[i] || 0));
  }
  return out;
}

export function volumeProfileRef(k, bins = 24, win = 120) {
  const s = k.slice(-win).filter((x) => isNum(x.c) && isNum(x.h));
  if (s.length < 20) return null;
  const lo = Math.min(...s.map((x) => x.l)), hi = Math.max(...s.map((x) => x.h));
  if (!(hi > lo)) return null;
  const step = (hi - lo) / bins, b = new Array(bins).fill(0);
  const clampB = (x) => Math.max(0, Math.min(bins - 1, Math.floor((x - lo) / step)));
  for (const x of s) {
    const a = clampB(x.l), z = clampB(x.h), share = (x.v || 0) / (z - a + 1);
    for (let j = a; j <= z; j++) b[j] += share;
  }
  let top = 0;
  for (let j = 1; j < bins; j++) if (b[j] > b[top]) top = j;
  const tot = b.reduce((x, y) => x + y, 0);
  return tot > 0 ? { poc: lo + step * (top + 0.5), share: b[top] / tot * 100 } : null;
}

/* آخر قيمة منتهية في سلسلة */
export function lastNum(a) {
  for (let i = a.length - 1; i >= 0; i--) if (isNum(a[i])) return a[i];
  return null;
}

/* ---------------------------------------------------------------------
   VWAP الجلسة ونطاق الافتتاح — من التعريف (§1.9–1.10).
   --------------------------------------------------------------------- */
function winOfRef(p) {
  if (!p) return null;
  if (isNum(p.start) && isNum(p.end)) return p;
  if (p.regular && isNum(p.regular.start)) return p.regular;
  return null;
}

export function vwapRef(k, period) {
  const w = winOfRef(period);
  if (!Array.isArray(k) || !w || !isNum(w.start) || !isNum(w.end)) return null;
  const rows = k.filter((x) => isNum(x.t) && x.t >= w.start && x.t <= w.end
    && isNum(x.h) && isNum(x.l) && isNum(x.c) && (x.v || 0) > 0)
    .map((x) => ({ tp: (x.h + x.l + x.c) / 3, v: x.v }));
  const V = rows.reduce((s, r) => s + r.v, 0);
  if (!(V > 0) || rows.length < 2) return null;
  const vw = rows.reduce((s, r) => s + r.tp * r.v, 0) / V;
  const sd = Math.sqrt(rows.reduce((s, r) => s + r.v * (r.tp - vw) ** 2, 0) / V);
  return { vwap: vw, sd, upper: vw + sd, lower: vw - sd, bars: rows.length };
}

export function openingRangeRef(k, period, minutes = 15) {
  const w = winOfRef(period);
  if (!Array.isArray(k) || !w || !isNum(w.start)) return null;
  const s1 = w.start + minutes * 60000;
  const inWin = k.filter((x) => isNum(x.t) && x.t >= w.start && x.t < s1 && isNum(x.h) && isNum(x.l));
  if (!inWin.length) return null;
  const hi = Math.max(...inWin.map((x) => x.h)), lo = Math.min(...inWin.map((x) => x.l));
  if (!(hi > lo)) return null;
  return { hi, lo, mid: (hi + lo) / 2, bars: inWin.length,
           complete: k.some((x) => isNum(x.t) && x.t >= s1) };
}

/* وسيط الحجم على آخر `win` شمعةً **قبل** الأخيرة (الأخيرة تُقاس به ولا تدخله). */
export function volMedianRef(k, win = 20) {
  if (!Array.isArray(k) || k.length < 2) return null;
  const v = k.slice(Math.max(0, k.length - win - 1), k.length - 1)
    .map((x) => x && x.v).filter((x) => isNum(x) && x > 0).sort((a, b) => a - b);
  if (v.length < 5) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/* ---------------------------------------------------------------------
   الشمعة المغلقة (§2) والتجميع الزمني (§1.11).
   --------------------------------------------------------------------- */
export const BAR_MS_REF = { "15m": 900000, "1h": 3600000, "4h": 14400000 };
const DAY = 86400000;

/* جاريةٌ إن لم يمضِ طولُها (اللحظية)، أو إن كان يومُها UTC ≥ يوم الساعة (اليومي).
   ختمٌ مجهول ⇒ تُعامَل جارية. */
export function liveRef(tf, t, now) {
  if (!isNum(t) || !isNum(now)) return true;
  const ms = BAR_MS_REF[tf] || ({ "1m": 6e4, "5m": 3e5, "30m": 18e5, "2h": 72e5 })[tf];
  if (ms) return t + ms > now;
  return Math.floor(t / DAY) >= Math.floor(now / DAY);
}

/* تُحذف من الذيل كلُّ شمعةٍ جارية أو ختمُها ليس دقيقةً كاملة، حتى أوّل
   شمعةٍ مغلقة — وتبقى شمعةٌ واحدة على الأقل. */
export function closedRef(k, tf, now) {
  if (!Array.isArray(k) || k.length < 2) return k || [];
  let n = k.length;
  const tOf = (x) => Array.isArray(x) ? x[0] * 1000 : x && x.t;
  while (n > 1) {
    const t = tOf(k[n - 1]);
    if (liveRef(tf, t, now) || !(isNum(t) && t % 60000 === 0)) { n--; continue; }
    break;
  }
  return k.slice(0, n);
}

/* تجميعٌ بمفتاح floor(t / (طولُ المصدر × العامل)) — طولُ المصدر وسيطُ الفروق
   الموجبة (العنصر ذو الفهرس ⌊n/2⌋ بعد الفرز). */
export function aggregateRef(bars, factor) {
  if (!Array.isArray(bars) || !bars.length) return [];
  const d = [];
  for (let i = 1; i < bars.length; i++) { const x = bars[i].t - bars[i - 1].t; if (isNum(x) && x > 0) d.push(x); }
  const fold = (g) => ({ t: g[0].t, o: g[0].o, h: Math.max(...g.map((x) => x.h)),
    l: Math.min(...g.map((x) => x.l)), c: g[g.length - 1].c, v: g.reduce((s, x) => s + (x.v || 0), 0) });
  if (d.length < 3) {
    const out = [];
    for (let i = 0; i < bars.length; i += factor) out.push(fold(bars.slice(i, i + factor)));
    return out;
  }
  d.sort((a, b) => a - b);
  const bucket = d[Math.floor(d.length / 2)] * factor;
  const out = [];
  let cur = null, key = null;
  for (const x of bars) {
    if (!isNum(x.t)) continue;
    const kk = Math.floor(x.t / bucket);
    if (kk !== key) { if (cur) out.push(fold(cur)); cur = [x]; key = kk; }
    else cur.push(x);
  }
  if (cur) out.push(fold(cur));
  return out;
}
