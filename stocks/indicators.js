/* =====================================================================
   حسابات المؤشرات الفنية — نسخة واحدة يقرأها المتصفح والخادم معاً.

   كانت مكتوبة مرتين: هنا وفي `index.html` مضمَّنةً. والنسختان كانتا
   متطابقتين **بالحظّ** — فحصٌ للحرف أثبت تطابق `sma` و`ema` و`rsi`
   و`macd` و`bb`، واختلاف `atr` في الأقواس وحدها. لكن أوّل مؤشّرٍ جديد
   كان سيُكتب مرتين، وأوّل تصحيحٍ سيصيب واحدةً — فتقول القائمة رقماً
   ويقول الشارت غيره. وهي العلّة التي حذّر منها `CLAUDE.md` نفسه ووقعت
   رغم التحذير، لأن التحذير كان نصّاً ولم يكن فحصاً.

   يُحمَّل في المتصفح كسكربت كلاسيكي (‎<script src="indicators.js">‎)،
   ويُقرأ في Node عبر `module.exports` — نفس نمط `score.js` و`plan.js`.
   و`scripts/lib/indicators.mjs` غلافٌ رقيق يُعيد تصديره لمستوردي ES.
   ===================================================================== */

/* النتيجة الفنية في `score.js`. في Node تُطلب صراحةً، وفي المتصفح تكون
   عالميةً لأن السكربت الكلاسيكي يعرّف `var` على `window` — وترتيب
   الوسوم في `index.html` يضمن سبقَها. */
var _SC = (typeof module !== "undefined" && module.exports)
  ? require("./score.js")
  : (typeof window !== "undefined" ? window : globalThis);

function sma(a, p) {
  const o = new Array(a.length).fill(null);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= p) s -= a[i - p];
    if (i >= p - 1) o[i] = s / p;
  }
  return o;
}

function ema(a, p) {
  const o = new Array(a.length).fill(null), k = 2 / (p + 1);
  if (a.length < p) return o;
  let s = 0;
  for (let i = 0; i < p; i++) s += a[i];
  o[p - 1] = s / p;
  for (let i = p; i < a.length; i++) o[i] = a[i] * k + o[i - 1] * (1 - k);
  return o;
}

function rsi(a, p = 14) {
  const o = new Array(a.length).fill(null);
  if (a.length <= p) return o;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = a[i] - a[i - 1]; d >= 0 ? g += d : l -= d; }
  g /= p; l /= p;
  o[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = p + 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
    l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
    o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return o;
}

function macd(a, f = 12, s = 26, sg = 9) {
  const ef = ema(a, f), es = ema(a, s);
  const line = a.map((_, i) => (ef[i] !== null && es[i] !== null) ? ef[i] - es[i] : null);
  const vals = line.filter(v => v !== null);
  const sigVals = ema(vals, sg);
  const off = line.length - vals.length;
  const signal = new Array(a.length).fill(null);
  sigVals.forEach((v, i) => { if (v !== null) signal[i + off] = v; });
  const hist = line.map((v, i) => (v !== null && signal[i] !== null) ? v - signal[i] : null);
  return { line, signal, hist };
}

function bb(a, p = 20, m = 2) {
  const mid = sma(a, p);
  const up = new Array(a.length).fill(null), lo = new Array(a.length).fill(null);
  for (let i = p - 1; i < a.length; i++) {
    let v = 0;
    for (let j = i - p + 1; j <= i; j++) v += Math.pow(a[j] - mid[i], 2);
    const sd = Math.sqrt(v / p);
    up[i] = mid[i] + m * sd; lo[i] = mid[i] - m * sd;
  }
  return { mid, up, lo };
}

function atr(h, l, c, p = 14) {
  const tr = [];
  for (let i = 0; i < c.length; i++) {
    tr.push(i === 0 ? h[i] - l[i]
      : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  const o = new Array(c.length).fill(null);
  if (tr.length < p) return o;
  let s = 0;
  for (let i = 0; i < p; i++) s += tr[i];
  o[p - 1] = s / p;
  for (let i = p; i < tr.length; i++) o[i] = (o[i - 1] * (p - 1) + tr[i]) / p;
  return o;
}

const last = (a) => {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null && isFinite(a[i])) return a[i];
  return null;
};

/* =====================================================================
   ADX — قوّة الاتجاه، لا جهته. وهو البعد الغائب عن النتيجة الفنية.

   النتيجة تقول «صاعد» أو «هابط»، ولا تقول **هل هناك اتجاهٌ أصلاً**.
   سهمٌ يتذبذب في نطاقٍ ضيّق قد يخرج بنتيجة ‎+60‎ لأن متوسّطاته مرتَّبة،
   ثم لا يذهب إلى أيّ مكان. ADX يفصل الاثنين: تحت ‎20‎ لا اتجاه، و
   ‎20–25‎ ناشئ، وفوق ‎25‎ قائم، وفوق ‎55‎ متطرّف وربما مُنهَك.

   وهذه هي المعلومة التي تحوّل «توافق الفريمات» من شرطٍ يُحقَّق كثيراً
   إلى شرطٍ يُحقَّق حين يعني شيئاً: توافقٌ بلا قوّة اتجاه تذبذبٌ مرتَّب.

   الحساب بطريقة Wilder الأصلية — تمهيدٌ تراكمي لا متوسّط متحرّك بسيط.
   البسيط يعطي أرقاماً أعلى بانتظام فتبدو كلّ الأسهم ذات اتجاه.
   ===================================================================== */
function adx(h, l, c, p) {
  p = p || 14;
  var n = c.length;
  var out = { adx: new Array(n).fill(null), pdi: new Array(n).fill(null), mdi: new Array(n).fill(null) };
  if (n < p * 2 + 1) return out;

  var tr = new Array(n).fill(0), pDM = new Array(n).fill(0), mDM = new Array(n).fill(0);
  for (var i = 1; i < n; i++) {
    tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    var up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    /* الحركة الاتجاهية للجانب الأكبر وحده: يومٌ يوسّع الطرفين معاً
       (شمعةٌ مُبتلِعة) ليس يوماً اتجاهياً في أيّ جهة */
    pDM[i] = (up > dn && up > 0) ? up : 0;
    mDM[i] = (dn > up && dn > 0) ? dn : 0;
  }

  // التمهيد الأوّل مجموعٌ صريح، ثم تراكمٌ بطريقة Wilder
  var str = 0, sp = 0, sm = 0;
  for (var j = 1; j <= p; j++) { str += tr[j]; sp += pDM[j]; sm += mDM[j]; }

  var dxs = [];
  for (var t = p; t < n; t++) {
    if (t > p) {
      str = str - str / p + tr[t];
      sp  = sp  - sp  / p + pDM[t];
      sm  = sm  - sm  / p + mDM[t];
    }
    if (!(str > 0)) continue;
    var pdi = 100 * sp / str, mdi = 100 * sm / str;
    out.pdi[t] = pdi; out.mdi[t] = mdi;
    var sum = pdi + mdi;
    var dx = sum > 0 ? 100 * Math.abs(pdi - mdi) / sum : 0;
    dxs.push(dx);
    // ADX تمهيدُ DX نفسه: أوّل قيمة متوسّطُ أوّل p، ثم تراكم
    if (dxs.length === p) {
      var s2 = 0;
      for (var q = 0; q < dxs.length; q++) s2 += dxs[q];
      out.adx[t] = s2 / p;
    } else if (dxs.length > p) {
      out.adx[t] = (out.adx[t - 1] * (p - 1) + dx) / p;
    }
  }
  return out;
}

/* وصفُ قوّة الاتجاه — عتبات Wilder المعروفة، لا اختراع */
function adxLabel(v) {
  if (!Number.isFinite(v)) return { t: "—", k: "na" };
  if (v < 20) return { t: "بلا اتجاه — تذبذب", k: "chop" };
  if (v < 25) return { t: "اتجاه ناشئ", k: "weak" };
  if (v < 40) return { t: "اتجاه قائم", k: "trend" };
  if (v < 55) return { t: "اتجاه قويّ", k: "strong" };
  return { t: "اتجاه متطرّف — احذر الانعكاس", k: "extreme" };
}

/* =====================================================================
   التباعد — السعر يسجّل طرفاً جديداً والمؤشّر لا يتبعه.

   أقوى ما في التحليل الفني الكلاسيكي وأكثره تعرّضاً للتلفيق: من يرسم
   خطّين على شارت يجد تباعداً في كلّ سهم. فالتعريف هنا **آليّ وصارم**:

     ١) قمّتان (أو قاعان) **محلّيان مؤكَّدان** — أعلى من `k` شمعات على
        كلّ جانب. بلا تأكيد الجانبين تصير كلّ شمعة قمّة.
     ٢) بينهما فاصلٌ زمنيّ أدنى — قمّتان متجاورتان ضجيج.
     ٣) السعر تجاوز الطرف السابق بهامشٍ من ATR — تجاوزٌ بمليمتر ليس
        قمّةً جديدة. نفس منطق المنطقة الميتة في `score.js`.
     ٤) والمؤشّر تحرّك في الجهة المعاكسة فعلاً لا بصفر.

   والعائد يحمل **موضع** القمّتين كي ترسم الواجهة ما تدّعيه: رقمٌ يقول
   «تباعد» بلا موضعٍ يُريه لا يمكن تكذيبه.
   ===================================================================== */
function pivots(arr, k, kind) {
  var out = [];
  for (var i = k; i < arr.length - k; i++) {
    var v = arr[i];
    if (v === null || !Number.isFinite(v)) continue;
    var ok = true;
    for (var j = i - k; j <= i + k && ok; j++) {
      if (j === i || arr[j] === null) continue;
      if (kind === "high" ? arr[j] > v : arr[j] < v) ok = false;
    }
    if (ok) out.push(i);
  }
  return out;
}

function divergence(h, l, ind, atrSeries, opt) {
  var o = opt || {};
  var k = o.k || 3, minGap = o.minGap || 5, lookback = o.lookback || 60;
  var minMove = (o.minMove === undefined || o.minMove === null) ? 0.5 : o.minMove;
  var n = ind.length, from = Math.max(0, n - lookback), res = [];

  var kinds = ["high", "low"];
  for (var ki = 0; ki < kinds.length; ki++) {
    var kind = kinds[ki];
    var px = kind === "high" ? h : l;
    var idx = pivots(px, k, kind).filter(function (i) { return i >= from; });
    if (idx.length < 2) continue;
    // آخر قمّتين مؤكَّدتين وبينهما فاصل
    var b = idx[idx.length - 1], a = null;
    for (var t = idx.length - 2; t >= 0; t--) if (b - idx[t] >= minGap) { a = idx[t]; break; }
    if (a === null) continue;
    var ia = ind[a], ib = ind[b];
    if (!Number.isFinite(ia) || !Number.isFinite(ib)) continue;
    var tol = (Number.isFinite(atrSeries && atrSeries[b]) ? atrSeries[b] : 0) * minMove;
    var dPx = px[b] - px[a];
    if (Math.abs(dPx) <= tol) continue;                 // لم يتجاوز الطرف فعلاً
    var dInd = ib - ia;
    if (dInd === 0) continue;
    // هابط: قمّةٌ أعلى ومؤشّرٌ أدنى. صاعد: قاعٌ أدنى ومؤشّرٌ أعلى.
    var bear = kind === "high" && dPx > 0 && dInd < 0;
    var bull = kind === "low"  && dPx < 0 && dInd > 0;
    if (!bear && !bull) continue;
    res.push({ dir: bear ? -1 : 1, kind: kind, at: b, prev: a,
               px: [px[a], px[b]], ind: [ia, ib], bars: b - a });
  }
  // الأحدث أوّلاً: تباعدٌ عمره عشرون شمعة أضعف من تباعد شمعتين
  return res.sort(function (x, y) { return y.at - x.at; });
}

/* =====================================================================
   انضغاط بولنجر — تمهيدٌ للحركة لا حركة.

   عرض النطاق منسوباً إلى وسطه، ثم **رتبته** داخل نافذةٍ ماضية. الرتبة
   لا القيمة المطلقة: نطاقٌ عرضه ‎2%‎ ضيّقٌ لسهمٍ مرافق وواسعٌ لسهمٍ
   هادئ، فالمقارنة تكون مع تاريخ السهم نفسه.

   وقيمتُه أنه **يسبق** الحركة، لكنه لا يقول جهةً — فيُقرن باتجاه
   النتيجة أو بـ ‎+DI/−DI‎. وحده ليس إشارة.
   ===================================================================== */
function bbWidth(c, p, m) {
  var b = bb(c, p || 20, m || 2);
  var w = new Array(c.length).fill(null);
  for (var i = 0; i < c.length; i++)
    if (b.up[i] !== null && b.mid[i] > 0) w[i] = (b.up[i] - b.lo[i]) / b.mid[i];
  return w;
}

/* الرتبة المئوية لآخر قيمة داخل نافذة.
   الاسم `rankInWindow` لا `pctRank`: الثانية موجودة في `index.html`
   بدلالةٍ أخرى ‎(sorted, v)‎ للأساسيات، والسكربتات الكلاسيكية تتشارك
   نطاقاً واحداً — فالأخيرُ تحميلاً يغلب بلا أيّ خطأ ظاهر. كان
   `analyze` يستدعي دالّة الأساسيات ويحسب الانضغاط منها.
   الأصل — ‎0‎ = الأضيق على الإطلاق.
   المقام `length - 1` لا `length`: الرتبة نسبةُ ما دونها إلى ما عداها،
   فبقيمةٍ هي الأدنى تخرج صفراً وبالأعلى مئةً بالضبط. */
function rankInWindow(series, win) {
  var a = [];
  for (var i = Math.max(0, series.length - (win || 120)); i < series.length; i++)
    if (Number.isFinite(series[i])) a.push(series[i]);
  if (a.length < 20) return null;
  var cur = a[a.length - 1], below = 0;
  for (var j = 0; j < a.length; j++) if (a[j] < cur) below++;
  return below / (a.length - 1) * 100;
}

/* =====================================================================
   تحليل فريم واحد.

   `adx` و`squeeze` و`div` **إضافاتٌ لا تمسّ `score`**: تعريفُ النتيجة
   في `score.js`، وتغييرُه يُبطل الأرشيف والسجلّ معاً. فقوّة الاتجاه
   والتباعد والانضغاط تُعرَض وتُستعمل في الشروط، ولا تُدمج في الرقم.
   فصلٌ مقصود: رقمٌ واحد يحمل ستّ معلومات لا يمكن تكذيبه في أيّها.
   ===================================================================== */
function analyze(k) {
  if (!k || k.length < 30) return null;
  var c = k.map(function (x) { return x.c; });
  var h = k.map(function (x) { return x.h; });
  var l = k.map(function (x) { return x.l; });
  var e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
  var r = rsi(c, 14), m = macd(c), b = bb(c, 20, 2), at = atr(h, l, c, 14);
  var px = c[c.length - 1];
  var E20 = last(e20), E50 = last(e50), E200 = last(e200);
  var R = last(r), H = last(m.hist), A = last(at);
  var hi = m.hist.filter(function (v) { return v !== null; });
  // القيمة السابقة تُمرَّر لا الرايةُ وحدها: `scoreFrom` تحتاجها لتطبيق
  // المنطقة الميتة على الميل أيضاً — فرقٌ في الخانة الرابعة كان يقلبه
  var hPrev = hi.length > 1 ? hi[hi.length - 2] : null;
  var rising = hi.length > 1 ? hi[hi.length - 1] > hi[hi.length - 2] : false;

  var norm = _SC.scoreFrom({ px: px, e20: E20, e50: E50, e200: E200, rsi: R,
                             hist: H, histPrev: hPrev, histRising: rising,
                             bbMid: last(b.mid), atr: A });

  var ax = adx(h, l, c, 14);
  var w = bbWidth(c, 20, 2);
  /* التباعد على RSI: أكثر المؤشّرات استعمالاً له، ونطاقه محدود (0..100)
     فالمقارنة بين نقطتين فيه ذاتُ معنى بلا تطبيع. وعلى MACD hist تخرج
     أرقامٌ بمقياس السعر فيلزم تطبيعها — تعقيدٌ بلا مقابل هنا. */
  var dv = divergence(h, l, r, at, { lookback: 60 });

  return {
    score: norm, px: px, e20: E20, e50: E50, e200: E200, rsi: R,
    hist: H, histPrev: hPrev, histRising: rising, atr: A,
    bbUp: last(b.up), bbLo: last(b.lo), bbMid: last(b.mid),
    adx: last(ax.adx), pdi: last(ax.pdi), mdi: last(ax.mdi),
    bbw: last(w), squeeze: rankInWindow(w, 120),
    div: dv.length ? { dir: dv[0].dir, bars: dv[0].bars, kind: dv[0].kind } : null,
    series: { e20: e20, e50: e50, e200: e200 }
  };
}
function aggregate(candles, factor) {
  const out = [];
  for (let i = 0; i < candles.length; i += factor) {
    const grp = candles.slice(i, i + factor);
    if (!grp.length) continue;
    out.push({
      t: grp[0].t,
      o: grp[0].o,
      h: Math.max(...grp.map(x => x.h)),
      l: Math.min(...grp.map(x => x.l)),
      c: grp[grp.length - 1].c,
      v: grp.reduce((a, x) => a + (x.v || 0), 0)
    });
  }
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { sma: sma, ema: ema, rsi: rsi, macd: macd, bb: bb, atr: atr,
                     last: last, adx: adx, adxLabel: adxLabel, pivots: pivots,
                     divergence: divergence, bbWidth: bbWidth, rankInWindow: rankInWindow,
                     analyze: analyze, aggregate: aggregate };
}
