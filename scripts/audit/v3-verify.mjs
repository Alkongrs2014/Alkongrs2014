#!/usr/bin/env node
/* =====================================================================
   المدقّق المستقلّ لفرص V3 — قراءةٌ فقط، لا يغيّر شيئاً في الإنتاج.

   الاستقلال شرطٌ بنيوي:
   · **لا استيراد** من stocks/ ولا scripts/lib ولا tests/reference — كلُّ رياضيات
     هنا مكتوبةٌ من docs/ENGINE_V3_SPEC.md (§2، §3، §4ب، §5).
   · **لا مخزن الإنتاج**: الشموع تُجلب من Alpaca مباشرةً بدقّة **دقيقة واحدة**
     (SIP، تعديل التقسيم) وتُجمَّع هنا إلى 15د وساعة و4س؛ واليومي من 1Day؛
     والجلسات وأنصاف الأيام من تقويم البورصة (/v2/calendar) لا من session.js.
   · **لا بيانات مستقبلية**: كلُّ حكمٍ عند حدّ اللقطة H يقرأ ما انتهى ≤ H فقط.

   المدخل: ملفّ ادّعاءات (v3-claims.mjs) أو trades.json منشور.
   المخرج: لكل فرصة — صحيحة / خاطئة (بالحقل والقيمتين) / غير قابلة للتحقق (بالسبب)،
   ومعها الفرص الفائتة (ما يقتضي المواصفةُ نشرَه ولم يُنشر).

   node scripts/audit/v3-verify.mjs --claims=FILE[,FILE] --out=FILE [--from=YYYY-MM-DD]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const CACHE = path.join(ROOT, "reports/v3-audit/cache");
fs.mkdirSync(CACHE, { recursive: true });

/* ---------------- المفاتيح (.env) بلا استيراد ---------------- */
const ENV = {};
for (const l of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) ENV[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const HDR = { "APCA-API-KEY-ID": ENV.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": ENV.ALPACA_SECRET_KEY };
async function getJ(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(30000) });
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 2000 * (i + 1))); continue; }
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
      return await r.json();
    } catch (e) { if (i === 4) throw e; await new Promise((s) => setTimeout(s, 1000 * (i + 1))); }
  }
}

/* ---------------- توقيت نيويورك (Intl، مستقلّ) ---------------- */
const FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const offC = new Map();
function etOffset(t) {                                   // ms تُضاف إلى UTC لتعطي ساعة نيويورك
  const k = Math.floor(t / 3600000); if (offC.has(k)) return offC.get(k);
  const p = Object.fromEntries(FMT.formatToParts(new Date(k * 3600000)).map((x) => [x.type, x.value]));
  const o = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - k * 3600000;
  offC.set(k, o); return o;
}
const etDate = (t) => new Date(t + etOffset(t)).toISOString().slice(0, 10);
const etToUtc = (date, hhmm) => {                        // "2026-10-02","04:00" ⇒ ms UTC
  const naive = Date.parse(`${date}T${hhmm}:00Z`);
  return naive - etOffset(naive + 5 * 3600000);
};
function isoWeekOf(date) {                               // "YYYY-MM-DD" ⇒ YYYYWW
  const t = new Date(date + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const y = t.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4));
  const wk = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return y * 100 + wk;
}

/* ---------------- التقويم الرسمي ---------------- */
async function calendar(from, to) {
  const f = path.join(CACHE, `cal-${from}-${to}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  const j = await getJ(`https://paper-api.alpaca.markets/v2/calendar?start=${from}&end=${to}`);
  const cal = j.map((d) => {
    const hm = (s) => s.length === 4 ? s.slice(0, 2) + ":" + s.slice(2) : s;
    return { date: d.date, pre: etToUtc(d.date, hm(d.session_open)), open: etToUtc(d.date, d.open),
             close: etToUtc(d.date, d.close), post: etToUtc(d.date, hm(d.session_close)) };
  });
  fs.writeFileSync(f, JSON.stringify(cal));
  return cal;
}

/* ---------------- الشموع الخام ---------------- */
async function bars(sym, tf, start, end) {
  const f = path.join(CACHE, `${sym}-${tf}-${start}-${end}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  const out = []; let tok = null;
  do {
    const u = new URL("https://data.alpaca.markets/v2/stocks/bars");
    u.searchParams.set("symbols", sym.replace("-", ".")); u.searchParams.set("timeframe", tf);
    u.searchParams.set("start", start + "T00:00:00Z"); u.searchParams.set("end", end + "T23:59:59Z");
    u.searchParams.set("feed", "sip"); u.searchParams.set("adjustment", "split"); u.searchParams.set("limit", "10000");
    if (tok) u.searchParams.set("page_token", tok);
    const j = await getJ(u.href);
    for (const b of (j.bars && j.bars[sym.replace("-", ".")]) || [])
      out.push([Date.parse(b.t), b.o, b.h, b.l, b.c, b.v]);
    tok = j.next_page_token;
  } while (tok);
  fs.writeFileSync(f, JSON.stringify(out));
  return out;
}

/* ---------------- البناء من دقيقة واحدة ---------------- */
const M15 = 900000;
function series(m1, d1raw, cal) {
  const day = new Map(cal.map((c) => [c.date, c]));
  const b15 = [], idx = new Map();
  for (const [t, o, h, l, c, v] of m1) {
    const dt = etDate(t), cd = day.get(dt);
    if (!cd || t < cd.pre || t >= cd.post || !(v > 0)) continue;
    const k = Math.floor(t / M15) * M15;
    let b = idx.get(k);
    if (!b) { b = { t: k, o, h, l, c, v: 0, date: dt, end: k + M15 }; idx.set(k, b); b15.push(b); }
    b.h = Math.max(b.h, h); b.l = Math.min(b.l, l); b.c = c; b.v += v;
  }
  b15.sort((a, b) => a.t - b.t);
  const bucket = (Hm) => {
    const out = [], m = new Map();
    for (const b of b15) {
      const cd = day.get(b.date), s = cd.pre + Math.floor((b.t - cd.pre) / Hm) * Hm;
      let x = m.get(s);
      if (!x) { x = { t: s, o: b.o, h: b.h, l: b.l, c: b.c, end: Math.min(s + Hm, cd.post) }; m.set(s, x); out.push(x); }
      else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; }
    }
    return out;
  };
  // اليومي الرسمي — Alpaca 1Day ومعه إعادة حسابه من الدقيقة لساعات الجلسة الرسمية
  const rth = new Map();
  for (const [t, , h, l, , v] of m1) {
    const dt = etDate(t), cd = day.get(dt);
    if (!cd || t < cd.open || t >= cd.close || !(v > 0)) continue;
    const r = rth.get(dt) || { h: -Infinity, l: Infinity };
    r.h = Math.max(r.h, h); r.l = Math.min(r.l, l); rth.set(dt, r);
  }
  const d1 = d1raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c, date: etDate(t + 6 * 3600000) }))
    .filter((b) => day.has(b.date)).map((b) => ({ ...b, wk: isoWeekOf(b.date) }));
  return { b15, h1: bucket(3600000), h4: bucket(4 * 3600000), d1, rth };
}

/* ---------------- رياضيات المواصفة ---------------- */
const W = { day: 40, ma: 40, trend: 6.67, vwap: 6.67, week: 6.66 };
const ORDER = ["h_break", "l_reclaim", "l_break", "h_loss"];
const DIR = { h_break: 1, l_reclaim: 1, l_break: -1, h_loss: -1 };
function events(b, H, L) {                                   // §2 بالترتيب
  const e = [];
  if (b.o <= H && b.c > H) e.push("h_break");
  if (b.o < L && b.c > L) e.push("l_reclaim");
  if (b.o >= L && b.c < L) e.push("l_break");
  if (b.o > H && b.c < H) e.push("h_loss");
  return e.sort((a, z) => ORDER.indexOf(a) - ORDER.indexOf(z));
}
function lastEvent(bs, H, L) {
  for (let i = bs.length - 1; i >= 0; i--) {
    const e = events(bs[i], H, L);
    if (e.length) {
      const lv = e[0].startsWith("h") ? H : L, d = DIR[e[0]];
      return { evt: e[0], d, holds: (bs[bs.length - 1].c - lv) * d > 0, at: bs[i].t };
    }
  }
  return null;
}
function ema(xs, p) {
  if (xs.length < p) return null;
  let v = 0; for (let i = 0; i < p; i++) v += xs[i]; v /= p;
  const k = 2 / (p + 1); for (let i = p; i < xs.length; i++) v = xs[i] * k + v * (1 - k);
  return v;
}
function atrW(bs, p = 14) {
  if (bs.length < p + 1) return null;
  const tr = (i) => Math.max(bs[i].h - bs[i].l, Math.abs(bs[i].h - bs[i - 1].c), Math.abs(bs[i].l - bs[i - 1].c));
  let v = 0; for (let i = 1; i <= p; i++) v += tr(i); v /= p;
  for (let i = p + 1; i < bs.length; i++) v = (v * (p - 1) + tr(i)) / p;
  return v;
}
/* محور مؤكَّد: 3 شموع على كل جانب لا تتجاوزه (التساوي لا يُسقطه — المواصفة صامتة
   عن التساوي؛ إن ظهر خلافٌ بسببه يُصنَّف «غموض مواصفة» لا خطأ) */
function pivots(bs, k = 3) {
  const hi = [], lo = [];
  for (let i = k; i < bs.length - k; i++) {
    let H = true, L = true;
    for (let j = i - k; j <= i + k; j++) if (j !== i) { if (bs[j].h > bs[i].h) H = false; if (bs[j].l < bs[i].l) L = false; }
    if (H) hi.push(i); if (L) lo.push(i);
  }
  return { hi, lo };
}
function swing(bs) {
  const w = bs.slice(-120), p = pivots(w);
  if (p.hi.length < 2 || p.lo.length < 2) return 0;
  const [h1, h2] = p.hi.slice(-2).map((i) => w[i].h), [l1, l2] = p.lo.slice(-2).map((i) => w[i].l);
  return h2 > h1 && l2 > l1 ? 1 : (h2 < h1 && l2 < l1 ? -1 : 0);
}
const upto = (a, ok) => { let lo = 0, hi = a.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (ok(a[m])) { r = m; lo = m + 1; } else hi = m - 1; } return r; };

/* الحالة المستقلّة عند حدّ اللقطة H */
function stateAt(S, H) {
  const i = upto(S.b15, (b) => b.end <= H);
  if (i < 0) return { why: "لا شموع 15د قبل الحدّ" };
  const b = S.b15[i], today = b.date, wk = isoWeekOf(today);
  const d1 = S.d1.filter((x) => x.date < today);
  if (d1.length < 16 || i < 16) return { why: "تاريخ يومي/15د غير كافٍ" };
  const pd = d1[d1.length - 1];
  let pwk = null, pwh = -Infinity, pwl = Infinity;
  for (let j = d1.length - 1; j >= 0; j--) {
    if (d1[j].wk >= wk) continue;
    if (pwk === null) pwk = d1[j].wk;
    if (d1[j].wk !== pwk) break;
    pwh = Math.max(pwh, d1[j].h); pwl = Math.min(pwl, d1[j].l);
  }
  let k0 = i; while (k0 > 0 && S.b15[k0 - 1].date === today) k0--;
  const tb = S.b15.slice(k0, i + 1);
  let w0 = i; while (w0 > 0 && isoWeekOf(S.b15[w0 - 1].date) === wk) w0--;
  const wb = S.b15.slice(w0, i + 1);
  const h1 = S.h1.slice(0, upto(S.h1, (x) => x.end <= H) + 1).slice(-259);
  const h4 = S.h4.slice(0, upto(S.h4, (x) => x.end <= H) + 1);
  const closes = h1.map((x) => x.c), e = [20, 50, 200].map((p) => ema(closes, p)), px1 = closes[closes.length - 1];
  const ma = e.every(Number.isFinite) ? (px1 > e[0] && e[0] > e[1] && e[1] > e[2] ? 1 : (px1 < e[0] && e[0] < e[1] && e[1] < e[2] ? -1 : 0)) : 0;
  const tf = { "1h": swing(h1), "4h": swing(h4), "1d": swing(d1) };
  const up = Object.values(tf).filter((x) => x > 0).length, dn = Object.values(tf).filter((x) => x < 0).length;
  let pv = 0, vv = 0; for (const x of tb) { pv += (x.h + x.l + x.c) / 3 * x.v; vv += x.v; }
  const rthPd = S.rth.get(pd.date);
  return {
    i, b, px: b.c, today, pd: { h: pd.h, l: pd.l, date: pd.date, rthH: rthPd && rthPd.h, rthL: rthPd && rthPd.l },
    pw: pwk === null ? null : { h: pwh, l: pwl, wk: pwk },
    day: lastEvent(tb, pd.h, pd.l), week: pwk === null ? null : lastEvent(wb, pwh, pwl),
    ma, maE: e, tf, trend: up >= 2 && dn === 0 ? 1 : (dn >= 2 && up === 0 ? -1 : 0),
    vwap: vv > 0 ? pv / vv : null,
    atr15: atrW(S.b15.slice(Math.max(0, i - 258), i + 1)), atrD: atrW(d1.slice(-259)), h1
  };
}
function scoreOf(st, d) {
  const el = { day: !!(st.day && st.day.d === d && st.day.holds), ma: st.ma === d, trend: st.trend === d,
               vwap: st.vwap !== null && (st.px - st.vwap) * d > 0, week: !!(st.week && st.week.d === d && st.week.holds) };
  let s = 0; for (const k in W) if (el[k]) s += W[k];
  return { el, score: Math.round(s * 100) / 100 };
}
/* §4ب + §5: هل تُنشر فرصة؟ وبأيّ خطة */
function decide(st, H) {
  let d = 0, base = null;
  if (st.day && st.day.holds) { d = st.day.d; base = "day"; } else if (st.ma) { d = st.ma; base = "ma"; }
  if (!d) return { pub: false, why: "nobase" };
  if (!(st.atrD > 0 && st.atr15 > 0)) return { pub: false, why: "atr" };
  const w = st.h1.slice(-120), p = pivots(w), list = d > 0 ? p.lo : p.hi;
  let piv = null;
  for (let j = list.length - 1; j >= 0; j--) { const v = d > 0 ? w[list[j]].l : w[list[j]].h; if ((st.px - v) * d > 0) { piv = v; break; } }
  if (piv === null) return { pub: false, why: "nostop", d, base };
  const stop = piv - d * 0.1 * st.atr15, risk = (st.px - stop) * d;
  if (!(risk > 0) || risk > st.atrD) return { pub: false, why: "risk", d, base };
  const c = [st.pd.h, st.pd.l, ...(st.pw ? [st.pw.h, st.pw.l] : []), ...p.hi.map((j) => w[j].h), ...p.lo.map((j) => w[j].l)]
    .filter((x) => Number.isFinite(x) && (x - st.px) * d > 0).sort((a, b) => (a - b) * d);
  const mg = []; for (const x of c) { if (mg.length && Math.abs(x - mg[mg.length - 1]) < 0.1 * st.atrD) continue; mg.push(x); }
  const tg = mg.filter((x) => (x - st.px) * d / risk >= 1).slice(0, 3);
  while (tg.length < 2) { const lr = tg.length ? (tg[tg.length - 1] - st.px) * d / risk : 0; tg.push(st.px + d * (Math.floor(lr + 1e-9) + 1) * risk); }
  const sc = scoreOf(st, d);
  return { pub: st.b.t === H - M15, notrade: st.b.t !== H - M15, d, base, stop, risk, tg, ...sc };
}

/* ---------------- المقارنة ---------------- */
const near = (a, b) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1.5e-4, 2e-6 * Math.abs(b)));
function judge(o, st, dec) {
  const bad = [], note = [];
  const chk = (f, got, want, eq = (x, y) => x === y) => { if (!eq(got, want)) bad.push({ f, got, want }); };
  chk("t = شمعة اللقطة", o.t * 1000, o.h * 1000 - M15);
  chk("شمعة التداول الأخيرة", st.b.t, o.h * 1000 - M15);
  chk("الدخول = إغلاق آخر 15د", o.e, st.px, near);
  chk("PDH", o.pdh, st.pd.h, near); chk("PDL", o.pdl, st.pd.l, near);
  if (st.pd.rthH != null && !(near(st.pd.h, st.pd.rthH) && near(st.pd.l, st.pd.rthL)))
    note.push(`يوميّ Alpaca ${st.pd.h}/${st.pd.l} ≠ الرسمية من الدقيقة ${st.pd.rthH}/${st.pd.rthL}`);
  chk("PWH", o.pwh, st.pw && st.pw.h, near); chk("PWL", o.pwl, st.pw && st.pw.l, near);
  chk("VWAP", o.vwap, st.vwap, (a, b) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(2e-4, 2e-5 * Math.abs(b))));
  chk("الجهة", o.d, dec.d); chk("الأساس", o.base, dec.base);
  chk("حدث أمس", o.evt, st.day && st.day.d === o.d && st.day.holds ? "pd" + st.day.evt : null);
  chk("حدث الأسبوع", o.weekEvt, st.week && st.week.d === o.d && st.week.holds ? "pw" + st.week.evt : null);
  for (const k of Object.keys(W)) chk(`✓/✗ ${k}`, o.el[k], dec.el[k]);
  chk("الدرجة", o.score, dec.score);
  chk("مجموع النقاط", Math.round(Object.values(o.pts).reduce((a, b) => a + b, 0) * 100) / 100, o.score);
  chk("المتوسطات", o.ma, st.ma); chk("الاتجاه", o.trend, st.trend);
  for (const k of ["1h", "4h", "1d"]) chk(`اتجاه ${k}`, o.trendTf[k], st.tf[k]);
  chk("الوقف", o.st, dec.stop, near);
  chk("عدد الأهداف", o.tg.length, dec.tg.length);
  o.tg.forEach((x, j) => chk(`T${j + 1}`, x.p, dec.tg[j], near));
  return { bad, note };
}

/* ---------------- التشغيل ---------------- */
const files = (arg("claims") || "").split(",").filter(Boolean);
const docs = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  if (j.docs) docs.push(...j.docs.filter((d) => d.open).map((d) => ({ ...d, src: path.basename(f) })));
  else docs.push({ hour: j.hour, candleKey: j.candleKey, open: j.open, bySym: j.bySym, stats: j.stats, src: path.basename(f) + " (منشور)" });
}
if (!docs.length) { console.error("لا ادّعاءات"); process.exit(2); }
const minH = Math.min(...docs.map((d) => d.hour)) * 1000, maxH = Math.max(...docs.map((d) => d.hour)) * 1000;
const day0 = new Date(minH).toISOString().slice(0, 10), day1 = new Date(maxH).toISOString().slice(0, 10);
const warm = new Date(minH - 45 * 86400000).toISOString().slice(0, 10);
const U = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8")).symbols.map((x) => x.s).slice(0, 50);
const cal = await calendar("2024-01-01", day1);
const calSet = new Set(cal.map((c) => c.date));

const S = {};
let n = 0;
await Promise.all([0, 1, 2, 3].map(async (w) => {
  for (let k = w; k < U.length; k += 4) {
    const s = U[k];
    const [m1, d1] = await Promise.all([bars(s, "1Min", warm, day1), bars(s, "1Day", "2024-06-01", day1)]);
    S[s] = series(m1, d1, cal);
    process.stdout.write(`\r  شموع ${++n}/${U.length}`);
  }
}));
console.log();

const res = { ok: [], bad: [], unver: [], missed: [], notes: [], slots: 0 };
const slotErr = [];
for (const doc of docs) {
  const H = doc.hour * 1000; res.slots++;
  const date = etDate(H), cd = cal.find((c) => c.date === date);
  // التوقيت: الحدّ على جدول المواصفة (05:15 + 30د حتى نهاية النافذة − 15د)
  const slotOk = cd && H >= cd.pre + 75 * 60000 && H <= cd.post - M15 && (H - (cd.pre + 75 * 60000)) % 1800000 === 0;
  if (!slotOk) slotErr.push({ hour: new Date(H).toISOString(), why: "حدٌّ خارج جدول المواصفة" });
  if (doc.candleKey !== doc.hour - 900) slotErr.push({ hour: new Date(H).toISOString(), why: "candleKey ≠ الحدّ − 15د" });
  const pubSet = new Set(doc.open.map((o) => o.s));
  for (const o of doc.open) {
    const st = S[o.s] && stateAt(S[o.s], H);
    const id = { s: o.s, hour: new Date(H).toISOString(), d: o.d, score: o.score, base: o.base, src: doc.src };
    if (!st || st.why) { res.unver.push({ ...id, why: st ? st.why : "لا شموع" }); continue; }
    const dec = decide(st, H);
    const { bad, note } = judge(o, st, dec);
    if (note.length) res.notes.push({ ...id, note });
    if (bad.length) res.bad.push({ ...id, bad }); else res.ok.push(id);
  }
  // الفائت: رمزٌ تقتضي المواصفة نشرَه ولم يُنشر
  for (const s of U) {
    if (pubSet.has(s) || !S[s]) continue;
    const st = stateAt(S[s], H);
    if (!st || st.why || st.b.date !== date) continue;
    const dec = decide(st, H);
    if (dec.pub) res.missed.push({ s, hour: new Date(H).toISOString(), d: dec.d, base: dec.base, score: dec.score, src: doc.src });
  }
}

const sum = { slots: res.slots, opps: res.ok.length + res.bad.length + res.unver.length, correct: res.ok.length,
  wrong: res.bad.length, unverifiable: res.unver.length, missed: res.missed.length, slotErrors: slotErr.length,
  dataNotes: res.notes.length };
const byField = {};
for (const x of res.bad) for (const b of x.bad) byField[b.f] = (byField[b.f] || 0) + 1;
const out = arg("out");
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), files, summary: sum, byField, slotErr, ...res }, null, 1));
console.log(JSON.stringify(sum), "\nحقول الخلاف:", JSON.stringify(byField));
