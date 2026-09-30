#!/usr/bin/env node
/* =====================================================================
   التحقّق التاريخي — قراءةٌ لناتج `replay-stocks.mjs`، بلا أيّ قرار.

   كلُّ ما هنا **يُقاس بعد** المحاكاة من شمعاتٍ لاحقة. والمحرّك لا يُعدَّل
   بناءً عليه: الأرقام تُعرض على صاحب المنتَج أولاً.

   التعريفات (ثابتةٌ ومعلنة قبل القراءة):
   · **ناجحة** = بلغت T1 بقواعد دورة حياة المحرّك نفسه (دخولٌ عند `e`، والوقف
     لا يُحسب قبل الدخول، ووقفٌ وهدفٌ في شمعةٍ واحدة = وقف).
   · **فاشلة** = دخلت ثم ضُرب وقفُها قبل T1.
   · **لم تُحسم** = دخلت ولم تبلغ T1 ولا الوقف (انتهت بالقِدَم/زوال السبب
     أو ما زالت مفتوحة)، و**لم تُفعَّل** = لم يُلمس سعرُ الدخول.
   · **الدقّة** = ناجحة ÷ (ناجحة + فاشلة).
   · **إيجابيٌّ كاذب** = فاشلة، أو أقصى حركةٍ معها أقلّ من 0.5 ATR خلال خمس جلسات.
   · قياسٌ مستقلّ لخمس جلسات بوحدة ATR اليومي، وخطُّ أساسٍ عشوائيّ (كل رمز عند
     كل افتتاح بالجهتين) لكل مقياس عائد — فرقٌ عن الأساس لا رقمٌ مطلق.

     node scripts/validation-report.mjs <replay.json> [--warm=5] [--out=report.json]
   ===================================================================== */
import fs from "node:fs";
import { createRequire } from "node:module";
const SES = createRequire(import.meta.url)("../stocks/session.js");

/* ملفٌّ واحد أو أكثر: الإعادة تُقسَّم مقاطع متتالية تُشغَّل بالتوازي، وكلُّ
   مقطعٍ يبدأ بـ`--warm` جلساتٍ من آخر سابقه (إحماءُ الهيستريسس ودورة الحياة)
   فلا يتداخل يومُ تقييمٍ بين مقطعين. */
const INS = process.argv.slice(2).filter(a => !a.startsWith("--"));
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const WARM = Number(arg("warm", "5"));
const FILES = INS.map(f => JSON.parse(fs.readFileSync(f, "utf8")));
const nyDate = (t) => SES.etParts(t).date;
const pct = (x) => Number.isFinite(x) ? (x >= 0 ? "+" : "") + x.toFixed(2) : "—";
const f1 = (x) => Number.isFinite(x) ? x.toFixed(2) : "—";
const P = (a, b) => b ? (100 * a / b).toFixed(1) + "%" : "—";
const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN; };
const mean = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; };

const bars = {};
{
  const byS = {};
  for (const F of FILES) for (const [s, arr] of Object.entries(F.bars)) { const m = (byS[s] ||= new Map()); for (const b of arr) m.set(b[0], b); }
  for (const [s, m] of Object.entries(byS))
    bars[s] = [...m.values()].sort((a, b) => a[0] - b[0]).map(b => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }));
}
const allDays = [...new Set(Object.values(bars).flatMap(a => a.map(b => nyDate(b.t))))].sort();
const dayIdx = Object.fromEntries(allDays.map((d, i) => [d, i]));
/* أيام التقييم لكل ملفّ = جلساتُه بعد إحمائه؛ والمجموع اتّحادها (بلا تداخل) */
const evalOf = FILES.map(F => new Set(allDays.filter(d => d >= F.from && d <= F.to).slice(WARM)));
const evalDays = new Set(evalOf.flatMap(e => [...e]).sort());
const repDays = [...new Set(FILES.flatMap(F => allDays.filter(d => d >= F.from && d <= F.to)))].sort();
const R = {
  from: FILES.map(F => F.from).sort()[0], to: FILES.map(F => F.to).sort().at(-1),
  engine: FILES[0].engine, limits: FILES[0].limits, symbols: FILES[0].symbols,
  stepsRun: FILES.reduce((a, F) => a + F.stepsRun, 0), skips: FILES.reduce((a, F) => a + F.skips, 0),
  atrDay: {}, fired: {}, stratEvents: [], opps: [], chunks: FILES.length,
  versions: [...new Set(FILES.map(F => F.engine.strategyVersion + "/" + F.engine.pipelineVersion))]
};
FILES.forEach((F, i) => {
  const E = evalOf[i];
  for (const [s, m] of Object.entries(F.atrDay || {})) for (const [d, v] of Object.entries(m)) if (E.has(d)) (R.atrDay[s] ||= {})[d] = v;
  for (const [k, v] of Object.entries(F.fired || {})) if (E.has(k.split("|")[1])) R.fired[k] = v;
  for (const e of F.stratEvents) if (E.has(nyDate(e[0]))) R.stratEvents.push(e);
  /* المحرّك **يحذف** دورة حياة الأسهم حين يزول سببها (وسمُ `gone` للكريبتو
     وحده)، فآخرُ حالةٍ رُئيت قبل آخر خطوةٍ في ملفّها = انتهت بزوال السبب. */
  const lastStep = Math.max(...Object.values(F.lifeFinal).map(L => L.at || 0));
  for (const o of F.opps) {
    if (!(E.has(nyDate(o.since)) && E.has(nyDate(o.T0)))) continue;
    o.L = { ...(F.lifeFinal[`${o.s}|${o.scan}|${o.d}|${o.since / 1000}`] || {}) };
    if (!o.L.end && o.L.at && o.L.at < lastStep) o.L.end = { k: "gone", at: o.L.at / 1000 };
    R.opps.push(o);
  }
});
const firstEval = [...evalDays][0], lastEval = repDays[repDays.length - 1];
const H = 5;

function forward(s, T, h) {
  const a = bars[s] || [], d0 = dayIdx[nyDate(T)];
  if (d0 === undefined) return { bars: [], complete: false };
  const endDay = allDays[Math.min(allDays.length - 1, d0 + h)];
  const out = [];
  for (const b of a) { if (b.t < T) continue; if (nyDate(b.t) > endDay) break; out.push(b); }
  return { bars: out, complete: d0 + h <= allDays.length - 1 };
}
const atrOf = (s, T) => R.atrDay?.[s]?.[nyDate(T)] ?? null;
function measure(s, T, d, px, atr) {
  const { bars: w, complete } = forward(s, T, H);
  if (!w.length || !(px > 0)) return null;
  let mfe = 0, mae = 0, win = null;
  for (const b of w) {
    const fav = d === 1 ? b.h : b.l, adv = d === 1 ? b.l : b.h;
    mae = Math.min(mae, (adv - px) * d);
    if (atr > 0 && win === null && mae <= -atr) win = 0;               // الضدّ في الشمعة نفسها يغلب
    mfe = Math.max(mfe, (fav - px) * d);
    if (atr > 0 && win === null && mfe >= atr) win = 1;
  }
  const d1 = forward(s, T, 1).bars;
  return { complete, mfeA: atr > 0 ? mfe / atr : NaN, maeA: atr > 0 ? mae / atr : NaN,
           r1: d1.length ? (d1[d1.length - 1].c / px - 1) * 100 * d : NaN, r5: (w[w.length - 1].c / px - 1) * 100 * d, win };
}
const summ = (ms) => { ms = ms.filter(m => m && m.complete); const d = ms.filter(m => m.win !== null);
  return { n: ms.length, r1: mean(ms.map(m => m.r1)), r5: mean(ms.map(m => m.r5)), r5med: med(ms.map(m => m.r5)),
           win: d.length ? d.filter(m => m.win).length / d.length * 100 : NaN, mfeA: med(ms.map(m => m.mfeA)), maeA: med(ms.map(m => m.maeA)) }; };

/* ── خط الأساس ── */
const base = { 1: [], [-1]: [] };
for (const [s, a] of Object.entries(bars)) {
  const firsts = {};
  for (const b of a) { const d = nyDate(b.t); if (evalDays.has(d) && !firsts[d]) firsts[d] = b; }
  for (const b of Object.values(firsts)) for (const d of [1, -1]) base[d].push(measure(s, b.t + 15 * 60e3, d, b.c, atrOf(s, b.t)));
}
const baseAll = summ([...base[1], ...base[-1]]), baseUp = summ(base[1]), baseDn = summ(base[-1]);

/* ── الفرص ── */
const list = R.opps;
/* المحرّك **يحذف** دورة حياة الأسهم حين يزول سببها (وسمُ `gone` للكريبتو وحده)،
   فآخرُ حالةٍ رُئيت قبل آخر خطوة = انتهت بزوال السبب عند تلك الخطوة. */
for (const o of list) {
  o.m = measure(o.s, o.T0, o.d, o.px, o.atr);
}
const cls = (o) => { const L = o.L;
  if (!L.in) return "unfilled";
  if ((L.hit || 0) >= 1) return "win";
  if (L.end?.k === "stop") return "loss";
  return "undecided"; };
for (const o of list) o.c = cls(o);
const cnt = (set, c) => set.filter(o => o.c === c).length;
const prec = (set) => { const w = cnt(set, "win"), l = cnt(set, "loss"); return { w, l, p: (w + l) ? w / (w + l) * 100 : NaN }; };
/* عائدٌ بوحدة R (المخاطرة = الدخول − الوقف): وقفٌ −1، وإلا إغلاق الأفق */
const rMult = (o) => {
  if (!o.L.in || !(Math.abs(o.e - o.stp) > 0)) return NaN;
  if (o.L.end?.k === "stop" && !(o.L.hit >= 1)) return -1;
  const w = forward(o.s, (o.L.inAt || o.T0 / 1000) * 1000, H).bars;
  if (!w.length) return NaN;
  const ex = o.L.end?.k === "tgt" && o.t.length ? o.t[o.t.length - 1] : w[w.length - 1].c;
  return (ex - o.e) * o.d / Math.abs(o.e - o.stp);
};
for (const o of list) o.R = rMult(o);

const lines = [];
const out = (s = "") => { lines.push(s); console.log(s); };
const row = (lbl, set) => {
  const s = summ(set.map(o => o.m)), p = prec(set);
  return `   ${lbl.padEnd(24)} n=${String(set.length).padStart(4)} · دقّة ${f1(p.p)}% (${p.w}✓/${p.l}✗) · R وسيط ${f1(med(set.map(o => o.R)))} · ${H}ج ${pct(s.r5)}% · +1ATR أولاً ${f1(s.win)}% · MFE ${f1(s.mfeA)} · MAE ${f1(s.maeA)}`;
};

out(`▶ التحقّق التاريخي — محرّك الإنتاج الحالي كما هو · البيانات alpaca_sip وحدها`);
out(`  نسخة المحرّك: ${R.versions.join(" · ")} · ${R.chunks} مقطعاً متوازياً`);
out(`  الإعادة: ${R.from} → ${R.to} · ${repDays.length} جلسة (${WARM} إحماء) · التقييم ${firstEval} → ${lastEval} · ${evalDays.size} جلسة`);
out(`  العيّنة: ${R.symbols.length} سهماً · ${R.stepsRun} خطوة (بعد كل إغلاق ‎15د‎ رسمي +3د) · تُخطّي ${R.skips}`);
out(`  حدودٌ معلنة: ${R.limits.join(" · ")}`);
out(`  القياس المستقلّ: ${H} جلسات بوحدة ATR اليومي · خطّ الأساس: ${baseAll.n} (رمز × افتتاح × جهة)`);
out("");
const c = { win: cnt(list, "win"), loss: cnt(list, "loss"), und: cnt(list, "undecided"), unf: cnt(list, "unfilled") };
out(`١) الفرص الفريدة المعروضة (رمز × مسح × جهة × لحظة بدء): ${list.length} — صعود ${list.filter(o => o.d === 1).length} · هبوط ${list.filter(o => o.d === -1).length}`);
out(`   بلا تكرار المسوح: ${new Set(list.map(o => o.s + "|" + o.d + "|" + nyDate(o.since))).size} (رمز × جهة × يوم) · ${new Set(list.map(o => o.s)).size} رمزاً · ${(list.length / evalDays.size).toFixed(1)} فرصة/جلسة`);
out(`   لم تُفعَّل (لم يُلمس الدخول) ${c.unf} (${P(c.unf, list.length)}) · دخلت ${list.length - c.unf}`);
out(`   من دخلت: ناجحة (T1) ${c.win} (${P(c.win, list.length - c.unf)}) · فاشلة (وقفٌ قبل T1) ${c.loss} (${P(c.loss, list.length - c.unf)}) · لم تُحسم ${c.und} (${P(c.und, list.length - c.unf)})`);
const endK = {}; for (const o of list) if (o.L.in) { const k = o.L.end?.k || "open"; endK[k] = (endK[k] || 0) + 1; }
out(`   كيف انتهت ما دخلت: ${Object.entries(endK).map(([k, v]) => `${{ stop: "وقف", tgt: "كلّ الأهداف", old: "قِدَم", gone: "زال السبب", open: "مفتوحة" }[k] || k} ${v}`).join(" · ")}`);
out(`   الدقّة ${f1(prec(list).p)}% · R وسيط ${f1(med(list.map(o => o.R)))} · R متوسّط ${f1(mean(list.map(o => o.R)))}`);
out(row("الكل", list));
out(`   خطّ الأساس (الكل):       ${H}ج ${pct(baseAll.r5)}% · +1ATR أولاً ${f1(baseAll.win)}% · MFE ${f1(baseAll.mfeA)} · MAE ${f1(baseAll.maeA)}`);
out("");
out("٢) التجزئة");
out(row("صعود", list.filter(o => o.d === 1)) + `  [أساس ▲: ${H}ج ${pct(baseUp.r5)}% · ${f1(baseUp.win)}%]`);
out(row("هبوط", list.filter(o => o.d === -1)) + `  [أساس ▼: ${H}ج ${pct(baseDn.r5)}% · ${f1(baseDn.win)}%]`);
for (const sc of [...new Set(list.map(o => o.scan))].sort()) out(row(`مسح ${sc}`, list.filter(o => o.scan === sc)));
const al = (o) => (o.score ?? 0) * o.d;
out("   — النتيجة الفنية بجهة الفرصة:");
out(row("≥ 45", list.filter(o => al(o) >= 45)));
out(row("15 … 45", list.filter(o => al(o) >= 15 && al(o) < 45)));
out(row("−15 … 15", list.filter(o => Math.abs(al(o)) < 15)));
out(row("≤ −15 (ضدّها)", list.filter(o => al(o) <= -15)));
out("   — إجماع الاستراتيجيات:");
out(row("موافق", list.filter(o => o.cdir === o.d && !o.mixed)));
out(row("معاكس", list.filter(o => o.cdir === -o.d && !o.mixed)));
out(row("متعارض", list.filter(o => o.mixed)));
out(row("بلا إجماع", list.filter(o => !o.cdir && !o.mixed)));
out(row("استراتيجيتان فأكثر معه", list.filter(o => o.cdir === o.d && (o.n || 0) >= 2)));
out("   — الترتيب والجودة:");
out(row("رتبة 1–3 في مسحها", list.filter(o => o.rank <= 2)));
out(row("رتبة 4+", list.filter(o => o.rank > 2)));
out(row("أعلى 5 رموز إجمالاً", list.filter(o => o.symRank >= 0 && o.symRank < 5)));
const qs = list.map(o => o.q).filter(Number.isFinite).sort((a, b) => a - b);
const q1 = qs[Math.floor(qs.length / 3)], q3 = qs[Math.floor(qs.length * 2 / 3)];
out(row(`q العليا (≥${f1(q3)})`, list.filter(o => o.q >= q3)));
out(row("q الوسطى", list.filter(o => o.q >= q1 && o.q < q3)));
out(row(`q الدنيا (<${f1(q1)})`, list.filter(o => o.q < q1)));
out("");

/* ── ٣ الاستراتيجيات ── */
const sig = R.stratEvents.filter(e => evalDays.has(nyDate(e[0]))).map(([T, s, st, dir, sc, n]) => {
  const a = bars[s] || []; let px = null; for (const b of a) { if (b.t + 15 * 60e3 > T) break; px = b.c; }
  return { s, st, dir, sc, n, m: measure(s, T, dir, px, atrOf(s, T)) };
});
out(`٣) الاستراتيجيات — تفعيلٌ مؤكَّد جديد = إشارة · ${sig.length} إشارة`);
const srow = (lbl, set) => { const s = summ(set.map(x => x.m));
  return `   ${lbl.padEnd(24)} n=${String(s.n).padStart(5)} · 1ج ${pct(s.r1)}% · ${H}ج ${pct(s.r5)}% (وسيط ${pct(s.r5med)}) · +1ATR أولاً ${f1(s.win)}% · MFE ${f1(s.mfeA)} · MAE ${f1(s.maeA)}`; };
for (const st of [...new Set(sig.map(x => x.st))].sort()) {
  out(srow(`${st} ▲`, sig.filter(x => x.st === st && x.dir === 1)));
  out(srow(`${st} ▼`, sig.filter(x => x.st === st && x.dir === -1)));
}
out(srow("منفردة (1 بالجهة)", sig.filter(x => x.n === 1)));
out(srow("اثنتان بالجهة", sig.filter(x => x.n === 2)));
out(srow("ثلاث فأكثر بالجهة", sig.filter(x => x.n >= 3)));
out(`   [أساس: +1ATR أولاً ${f1(baseAll.win)}% · ${H}ج ${pct(baseAll.r5)}%]`);
out("");

/* ── ٤ الإيجابيات الكاذبة ── */
const done = list.filter(o => o.m && o.m.complete);
const fp = done.filter(o => o.c === "loss" || o.m.mfeA < 0.5);
out(`٤) الإيجابيات الكاذبة (فاشلة، أو أقصى حركةٍ معها < 0.5 ATR في ${H} جلسات): ${fp.length} من ${done.length} (${P(fp.length, done.length)})`);
out(`   صعود ${fp.filter(o => o.d === 1).length}/${done.filter(o => o.d === 1).length} · هبوط ${fp.filter(o => o.d === -1).length}/${done.filter(o => o.d === -1).length}`);
out("");

/* ── ٥ الحركات القوية الفائتة ── */
const miss = { early: 0, late: 0, filtered: 0, gap: 0, none: 0 }, ex = [];
let nBig = 0;
for (const day of evalDays) for (const s of Object.keys(bars)) {
  const a = bars[s];
  const i0 = a.findIndex(b => nyDate(b.t) === day); if (i0 <= 0) continue;
  const dayB = []; for (let i = i0; i < a.length && nyDate(a[i].t) === day; i++) dayB.push(a[i]);
  const pc0 = a[i0 - 1].c, atr = atrOf(s, dayB[0].t), mv = dayB[dayB.length - 1].c - pc0;
  if (!(atr > 0) || Math.abs(mv) < 1.5 * atr) continue;
  nBig++;
  const d = Math.sign(mv), gap = dayB[0].o - pc0;
  const half = dayB.find(b => (b.c - pc0) * d >= Math.abs(mv) / 2);
  const halfT = half ? half.t + 15 * 60e3 : dayB[dayB.length - 1].t;
  const endT = dayB[dayB.length - 1].t + 15 * 60e3;
  const mine = list.filter(o => o.s === s && o.d === d && o.T0 <= endT && (o.lastT || o.T0) >= dayB[0].t);
  if (mine.some(o => o.T0 <= halfT)) miss.early++;
  else if (mine.length) miss.late++;
  else if (Object.entries(R.fired[`${s}|${day}`] || {}).some(([k, T]) => Number(k.split("|")[1]) === d && T <= halfT)) { miss.filtered++; ex.push(`${day} ${s} ${pct(mv / pc0 * 100)}%`); }
  else if (Math.abs(gap) >= 0.6 * Math.abs(mv)) miss.gap++;
  else miss.none++;
}
out(`٥) الحركات القوية (إغلاق يومٍ عن إغلاق سابقه ≥ 1.5 ATR اليومي للسهم نفسه): ${nBig}`);
out(`   التُقطت مبكّراً (فرصةٌ بالاتجاه قبل منتصف الحركة) ${miss.early} (${P(miss.early, nBig)}) · متأخّرة ${miss.late} (${P(miss.late, nBig)})`);
out(`   أطلق شرطٌ ولم يُعرض (رشّحه الاتجاه/دورة الحياة) ${miss.filtered} (${P(miss.filtered, nBig)}) · فجوة افتتاح ≥60% ${miss.gap} (${P(miss.gap, nBig)}) · بلا إعداد ${miss.none} (${P(miss.none, nBig)})`);
out(`   أمثلة «أطلق ولم يُعرض»: ${ex.slice(0, 6).join(" · ")}`);
out("");

/* ── ٦ التوقيت ── */
for (const o of done) {
  const a = bars[o.s] || [], i = a.findIndex(b => b.t + 15 * 60e3 > o.T0);
  const back = i > 0 ? a[Math.max(0, i - 26 * 5)] : null;
  o.pre = back && o.atr > 0 ? (o.px - back.c) * o.d / o.atr : NaN;
}
out(`٦) التوقيت — حركة السهم باتجاه الفرصة في الجلسات الخمس **قبل** ظهورها (ATR): وسيط ${f1(med(done.map(o => o.pre)))}`);
out(row("متأخّرة (≥2 ATR قبلها)", done.filter(o => o.pre >= 2)));
out(row("وسط (0.5–2 ATR)", done.filter(o => o.pre >= 0.5 && o.pre < 2)));
out(row("مبكّرة (<0.5 ATR قبلها)", done.filter(o => o.pre < 0.5)));
const toT1 = list.filter(o => o.c === "win" && o.L.inAt).map(o => {
  const a = bars[o.s] || []; const i0 = a.findIndex(b => b.t >= o.L.inAt * 1000);
  const i1 = a.findIndex(b => b.t >= o.L.inAt * 1000 && (((o.d === 1 ? b.h : b.l) - o.t[0]) * o.d >= 0));
  return i0 >= 0 && i1 >= 0 ? (i1 - i0) : NaN; });
out(`   من الدخول إلى T1: وسيط ${f1(med(toT1))} شمعة ‎15د‎ (~${f1(med(toT1) / 26)} جلسة)`);
out("");

/* ── ٧ الأهداف ── */
const filled = list.filter(o => o.L.in);
const dist = (o, x) => o.atr > 0 && Number.isFinite(x) ? Math.abs(x - o.e) / o.atr : NaN;
out(`٧) الأهداف — المسافة عن سعر الدخول بوحدة ATR اليومي (وسيط) ونسبة البلوغ بين ما دخل (${filled.length}):`);
for (let i = 0; i < 3; i++) {
  const has = filled.filter(o => o.t.length > i), got = has.filter(o => (o.L.hit || 0) > i);
  out(`   T${i + 1}: ${f1(med(list.filter(o => o.t.length > i).map(o => dist(o, o.t[i]))))} ATR · لها T${i + 1} ${has.length} · بلغته ${got.length} (${P(got.length, has.length)})`);
}
const stops = filled.filter(o => o.L.end?.k === "stop");
out(`   الوقف: ${f1(med(list.map(o => dist(o, o.stp))))} ATR · ضُرب ${stops.length} (${P(stops.length, filled.length)}) — منها بعد T1 ${stops.filter(o => o.L.hit >= 1).length}`);
out(`   بلا هدفٍ واحد: ${list.filter(o => !o.t.length).length} من ${list.length} · نسبة المكافأة/المخاطرة لـT1 (وسيط): ${f1(med(list.filter(o => o.t.length).map(o => Math.abs(o.t[0] - o.e) / Math.abs(o.e - o.stp))))}`);
out(`   أقصى حركة معها بعد الدخول (MFE) مقابل T1 — وسيط نسبة MFE÷مسافة T1: ${f1(med(filled.filter(o => o.t.length && Number.isFinite(o.L.mfe)).map(o => Math.abs(o.L.mfe - o.e) / Math.abs(o.t[0] - o.e))))}`);

if (arg("out")) fs.writeFileSync(arg("out"), JSON.stringify({ lines, n: list.length, c, baseAll, miss, generated: Date.now() }));
