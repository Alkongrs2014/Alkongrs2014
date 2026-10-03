#!/usr/bin/env node
/* =====================================================================
   المسار الحيّ للمحرّك V3 ← trades.json (docs/ENGINE_V3_SPEC.md §4ب)

   **لقطة الساعة — قرار المالك 2026-10-01**: كلُّ ساعة بدايةٌ جديدة بالكامل.
   عند كل حدّ ساعة تُصفَّر الفرص كلُّها، ويُحلَّل كلُّ رمزٍ من الصفر على آخر
   الشموع المغلقة، وما تحقّق فيه شرطُ فرصةٍ الآن يُنشأ فرصةً جديدة بجهتها
   ودرجتها ودخولها ووقفها وأهدافها. **لا يُقرأ شيءٌ من لقطة الساعة السابقة** —
   لا حالة ولا ملفّ: البناء دالّةٌ في (الشموع المغلقة، حدّ الساعة) وحدهما.

   الأسهم: 05:15 نيويورك ثم كلَّ 30 دقيقة حتى نهاية نافذة SIP (20:00) — قرار المالك
   2026-10-01؛ الشموع المغلقة من ما قبل الافتتاح والرسمية وما بعد الإغلاق (مخزن Alpaca SIP).
   الكريبتو: كلُّ ساعة UTC، ويومُه 03:00→03:00 الرياض = يوم UTC (ملفّات Binance).
   وداخل الساعة الواحدة لا يُعاد البناء: اللقطة ثابتةٌ حتى الحدّ التالي.

   --out DIR   مجلّد البيانات (data للأسهم · data/crypto للكريبتو)
   --book stocks|crypto   (الافتراضي من المجلّد)
   --check     فحصٌ ذاتي بلا شبكة
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readSeries, storeDir } from "./lib/bars-store.mjs";
import { prep, prepCrypto, evalSlot, stepOver, prevSlotOf, inputAt, stockSlotAt, cryptoSlotAt } from "./lib/engine3-run.mjs";
import { rp } from "./lib/round.mjs";

const require = createRequire(import.meta.url);
const E = require("../stocks/engine3.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg("out", path.join(ROOT, "data")));
const M15 = 15 * 60000, KEEP_DAYS = 150;

/* نسخة المحرّك: بصمة الشيفرة التي تشكّل القرار (نصٌّ موحّد النهايات) */
export function engineVersion() {
  const h = crypto.createHash("sha256");
  for (const f of ["stocks/engine3.js", "scripts/lib/engine3-run.mjs", "scripts/build-trades.mjs"])
    h.update(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n"));
  return h.digest("hex").slice(0, 12);
}
/* الأسعار بالأرقام المعنوية (`rp`) لا بخاناتٍ ثابتة — التقريب الثابت يمحو الأصول
   الرخيصة (شيبا إينو 0.0000051 ⇒ صفر)، مصيدةٌ موثّقة */
const r4 = (x) => x == null || !Number.isFinite(x) ? null : rp(x);
const r2 = (x) => x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100;
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

/* حالة الفريمات مضغوطةً للنشر (§4ج) — لكل فريم [أمس، المتوسطات، الاتجاه، VWAP، الأسبوع]:
     أمس/الأسبوع: "b.hb" عبورٌ على آخر شمعة · "h.hb" ثباتٌ بعد عبورٍ سابق · "k.hb" عاد السعر عبره ·
       "a" فوق المستوى منذ الافتتاح بلا عبور · "w" تحته · "i" داخل النطاق · "n" لا شمعة مغلقة بعد ·
       "r1"/"r-1"/"r0" اليومي مصدرُ المستوى وافتتاح اليوم فوقه/تحته/بينهما
       ورمز الحدث: hb كسر القمة · lr استعادة القاع · lb كسر القاع · hl فقد القمة
     المتوسطات: 1/-1/0 ترتيبٌ، و2/-2 انقلابٌ بإغلاق آخر شمعة · الاتجاه 1/-1/0 · VWAP 1/-1/0 أو null */
const EVC = { h_break: "hb", l_reclaim: "lr", l_break: "lb", h_loss: "hl" };
const kindCode = (x) => {
  if (!x || x.kind === "none") return "n";
  if (x.kind === "ref") return "r" + x.open;
  const e = x.evt ? "." + EVC[x.evt.slice(2)] : "";
  return ({ break: "b", hold: "h", back: "k", open_above: "a", open_below: "w", inside: "i" })[x.kind] + e;
};
function frPack(fa) {
  if (!fa) return null;
  const o = {};
  for (const tf of E.E3_TFS) {
    const r = fa.fr[tf];
    o[tf] = [kindCode(r.day), r.ma.ok ? (r.ma.flip ? 2 : 1) * r.ma.dir : null, r.trend,
      r.vwap ? r.vwap.side : null, kindCode(r.week)];
  }
  return o;
}

/* الصفقة كما تُنشر — الخطة (دخول/وقف/أهداف) مثبّتةٌ لحظة الإصدار ولا تُعاد حسابها */
const sec = (ms) => Number.isFinite(ms) ? Math.round(ms / 1000) : null;
/* القائمة والمنتهية بصيغةٍ مختصرة: حالة الفريمات الحالية في `bySym` أصلاً، فتكرارها لكل
   صفقة ضاعف ملفّ الكريبتو ستّ مرّات (1.3 م.ب مقيسة بـ350 قائمة و715 منتهية) */
const SLIM = ["conflict", "fr", "opp", "tfs", "ma", "trend", "trendTf", "vwap", "pdh", "pdl", "pwh", "pwl", "dq", "rr1"];
function pubSlim(tr) {
  const o = pubTrade(tr);
  for (const k of SLIM) delete o[k];
  return o;
}
/* المنتهية: الهوية والنتيجة وحدهما — تُعرض سطراً «انتهت بسبب كذا» */
function pubEnded(tr) {
  return { id: tr.id, s: tr.s, h: tr.h, d: tr.d, status: tr.status, base: tr.base, score: tr.score,
    e: r4(tr.e), hit: tr.hit || 0, fill: tr.fill ? { t: sec(tr.fill.t), px: r4(tr.fill.px) } : null,
    end: { k: tr.end.k, t: sec(tr.end.t), px: r4(tr.end.px) }, ...(tr.low ? { low: 1 } : {}) };
}
function pubTrade(tr) {
  const o = { id: tr.id, s: tr.s, h: tr.h, d: tr.d, status: tr.status, t: sec(tr.t),
    base: tr.base, baseTf: tr.baseTf, baseTfs: tr.baseTfs, evAt: sec(tr.evAt), evt: tr.evt || null, weekEvt: tr.weekEvt || null,
    conflict: tr.conflict, el: tr.el, pts: tr.pts, score: tr.score, tfs: tr.tfs, opp: tr.opp, fr: tr.fr,
    e: r4(tr.e), st: r4(tr.st), risk: r4(tr.risk), rr1: r2(tr.rr1),
    tg: tr.tg.map((x) => ({ p: r4(x.p), src: x.src })), hit: tr.hit || 0,
    ma: tr.ma, trend: tr.trend, trendTf: tr.trendTf, vwap: r4(tr.vwap),
    pdh: r4(tr.pdh), pdl: r4(tr.pdl), pwh: r4(tr.pwh), pwl: r4(tr.pwl), atrD: r4(tr.atrD) };
  if (tr.stNow !== undefined && tr.stNow !== tr.st) o.stNow = r4(tr.stNow);
  if (tr.fill) o.fill = { t: sec(tr.fill.t), px: r4(tr.fill.px) };
  if (Number.isFinite(tr.sess)) o.sess = tr.sess;
  if (tr.end) o.end = { k: tr.end.k, t: sec(tr.end.t), px: r4(tr.end.px) };
  if (tr.dq) o.dq = tr.dq;
  if (tr.low) o.low = 1;
  return o;
}
/* الصفقة الداخلية (حالة المحرّك بدقّةٍ كاملة) من إشارة اللقطة */
function newTrade(s, H, sig, extra) {
  return { id: `${s}|${Math.round(H / 1000)}`, s, h: Math.round(H / 1000), d: sig.d, status: "confirmed", t: sig.t,
    base: sig.base, baseTf: sig.baseTf, baseTfs: sig.baseTfs, evAt: sig.evAt, evt: sig.evt || null, weekEvt: sig.weekEvt || null,
    conflict: sig.conflict, el: sig.el, pts: sig.pts, score: sig.score, tfs: sig.tfs, opp: sig.opp,
    e: sig.e, st: sig.st, risk: sig.risk, rr1: sig.rr1, tg: sig.tg, atrD: sig.atrD,
    ma: sig.ma, trend: sig.trend, trendTf: sig.trendTf, vwap: sig.vwap,
    pdh: sig.pdh, pdl: sig.pdl, pwh: sig.pwh, pwl: sig.pwl, ...extra };
}
/* التوافق الحالي لصفقةٍ قائمة وتحذيراتها — عرضٌ لا قرار: لا يُغلقها ولا يغيّر خطتها.
     drop  التوافق الحالي أقلّ من التوافق عند الإصدار
     core  لم تعد أيٌّ من الأساسيتين (أمس/المتوسطات) متحقّقةً في جهتها على أيّ فريم
     opp   إحدى الأساسيتين متحقّقةٌ في الجهة المعاكسة الآن، أو إشارةٌ جديدة معاكسة في هذه اللقطة
     nodata  لا شموع حديثة للرمز في هذه اللقطة */
function nowOf(tr, r) {
  if (!r || !r.fa) return { warn: ["nodata"] };
  const sc = E.scoreFrames(r.fa, tr.d), op = E.scoreFrames(r.fa, -tr.d), warn = [];
  if (sc.score < tr.score) warn.push("drop");
  if (!sc.el.day && !sc.el.ma) warn.push("core");
  if (op.el.day || op.el.ma || (r.sig && r.sig.d === -tr.d)) warn.push("opp");
  return { score: sc.score, el: sc.el, pts: sc.pts, tfs: sc.tfs, opp: sc.opp, warn };
}
/* كفاية البيانات لكل استراتيجية على فريمها (لبطاقة «الاستراتيجيات حسب الفريم») —
   عرضٌ لا قرار: نفس مدخلات الفرصة (`inputAt`) ونفس دوالّ المحرّك (`e3pivots`)،
   فـ«بيانات غير كافية» تعني أن المحرّك نفسه لم يملك ما يحكم به، لا «محايد».
     ma   ‎≥ 200‎ شمعة ساعة في نافذة المتوسطات (EMA200 تحتاجها)
     tr   لكل فريم: قمّتان وقاعان مؤكّدان على الأقل في نافذة الاتجاه
     vw · wk   VWAP اليوم ومستويا الأسبوع السابق موجودة */
function dataQuality(S, i, st) {
  const inp = inputAt(S, i), tail = (a, n) => a.slice(Math.max(0, a.length - n));
  const piv = (bars) => { const p = E.e3pivots(tail(bars || [], E.E3.PIV_WIN), E.E3.PIV_K); return p.hi.length >= 2 && p.lo.length >= 2 ? 1 : 0; };
  return { ma: tail(inp.h1, E.E3.MA_WIN).length >= E.E3.MA[2] ? 1 : 0,
           tr: { "1h": piv(inp.h1), "4h": piv(inp.h4), "1d": piv(inp.d1) },
           vw: st.vwap !== null ? 1 : 0, wk: st.pw ? 1 : 0 };
}
function stateRow(st) {
  return { px: r4(st.px), ma: st.ma.dir, trend: st.trend.dir, trendTf: st.trend.tf,
    vwap: r4(st.vwap), pdh: r4(st.pd && st.pd.h), pdl: r4(st.pd && st.pd.l),
    pwh: r4(st.pw && st.pw.h), pwl: r4(st.pw && st.pw.l),
    day: st.day ? { evt: st.day.evt, d: st.day.d, holds: st.day.holds } : null,
    week: st.week ? { evt: st.week.evt, d: st.week.d, holds: st.week.holds } : null,
    up: E.scoreFor(st, 1).score, dn: E.scoreFor(st, -1).score };
}

/* مصدر الشموع لكل دفتر */
function loadBook(book, out, barsDir, now) {
  const S = {};
  if (book === "crypto") {
    const sum = readJ(path.join(out, "summary.json"));
    for (const r of (sum && sum.rows) || []) {
      const rec = readJ(path.join(out, "sym", r.s + ".json"));
      if (rec) S[r.s] = prepCrypto(rec);
    }
    return S;
  }
  const U = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
  const from = now - KEEP_DAYS * 86400000;
  for (const s of U.symbols.map((x) => x.s).slice(0, U.top || 50)) {
    const a = readSeries(barsDir, s, "15m"), b = readSeries(barsDir, s, "1d");
    if (!a || !b) continue;
    S[s] = prep(a.bars.filter((x) => x.t >= from), b.bars.filter((x) => x.t >= from - 400 * 86400000));
  }
  return S;
}

/* =====================================================================
   البناء عند حدّ اللقطة H (§4ج — قرار المالك 2026-10-03):
     ١) كلُّ صفقةٍ قائمة في `trades-state.json` تُمشى على شموع 15د المغلقة منذ
        اللقطة السابقة بدوالّ المحرّك (`fillTrade`/`stepTrade`): تنفيذٌ ثم وقف أو آخر
        هدف أو 5 جلسات (§6). خطتُها مثبّتة، وتغيّرُ الاستراتيجيات يُعرض تحذيراً لا إغلاقاً.
     ٢) الرمز بلا صفقةٍ قائمة يُقيَّم لإشارةٍ **جديدة** في (اللقطة السابقة، H] —
        فلا تتكرّر إشارةٌ قديمة ولا تتولّد صفقةٌ ثانية للرمز خلال دورة حياة الأولى.
   الحالة تبدأ فارغةً (لا صفقات بأثرٍ رجعي)، و`fresh` يتجاهلها (للاختبار).
   `state` يمرَّر في الاختبار بدل القراءة من القرص، وتُعاد الحالة الجديدة في `state`.
   ===================================================================== */
const CLOSED_KEEP_MS = 24 * 3600000;
export function build({ now = Date.now(), out = OUT, barsDir, book, fresh = false, state: st0, S: S0 } = {}) {
  book = book || (path.basename(out) === "crypto" ? "crypto" : "stocks");
  barsDir = barsDir || storeDir(out);
  const ver = engineVersion();
  const H = book === "crypto" ? cryptoSlotAt(now) : stockSlotAt(now);
  if (!H) return { ok: false, why: "لا حدّ لقطة" };
  const prev = fresh || S0 ? null : readJ(path.join(out, "trades.json"));
  if (prev && prev.mode === "hourly" && prev.life && prev.version === ver && prev.hour === Math.round(H / 1000))
    return { ok: true, same: true, doc: prev, why: "نفس اللقطة — ثابتة حتى الحدّ التالي" };
  const state = st0 !== undefined ? st0 : (fresh ? null : readJ(path.join(out, "trades-state.json")));
  if (state && state.hour * 1000 > H) return { ok: false, why: `حالةٌ أحدث ${state.hour} > ${Math.round(H / 1000)}` };

  const S = S0 || loadBook(book, out, barsDir, now);
  const syms = Object.keys(S);
  if (!syms.length) return { ok: false, why: "لا شموع" };
  /* طزاجة الرمز: شمعتُه الأخيرة المغلقة من جلسة الساعة نفسها (الأسهم) أو من
     الساعة الأخيرة (الكريبتو) — رمزٌ متوقّف لا يُقيَّم على شموعٍ قديمة. */
  let refDay = 0;
  if (book !== "crypto") for (const s of syms) {
    const r = S[s].r15; let i = r.length - 1;
    while (i >= 0 && r[i].end > H) i--;
    if (i >= 0) refDay = Math.max(refDay, r[i].d);
  }
  /* الكريبتو: عملاتٌ دون حدّ السيولة (`low` من الكون) تُحلَّل كغيرها وتُوسَم فرصُها —
     تصنيفٌ منفصل بتحذير في الواجهة، لا تغييرٌ في القرار (قرار المالك 2026-10-03) */
  const lowSet = new Set();
  if (book === "crypto") for (const r of (readJ(path.join(out, "summary.json")) || {}).rows || []) if (r.low) lowSet.add(r.s);
  /* ١) الصفقات القائمة: تُمشى من اللقطة السابقة حتى H */
  const lastH = state && Number.isFinite(state.hour) ? state.hour * 1000 : null;
  const active = new Map(), closed = [];
  for (const tr of (state && state.active) || []) {
    if (S[tr.s] && lastH !== null) stepOver(tr, S[tr.s], lastH, H);
    if (tr.status === "closed" || tr.status === "cancelled") closed.push(tr); else active.set(tr.s, tr);
  }
  for (const tr of (state && state.closed) || []) closed.push(tr);
  const prevH = prevSlotOf(book, H);
  const open = [], bySym = {}, rej = {}, nowBy = {};
  for (const s of syms) {
    const { i, r } = evalSlot(S[s], H, prevH);
    if (i < 0) { rej.data = (rej.data || 0) + 1; continue; }
    const bar = S[s].r15[i];
    const fresh1 = book === "crypto" ? bar.end > H - 3600000 : bar.d === refDay;
    if (!fresh1) { rej.stale = (rej.stale || 0) + 1; continue; }
    if (r.st) bySym[s] = { ...stateRow(r.st), fr: frPack(r.fa) };
    /* رمزٌ له صفقةٌ قائمة: لا صفقة ثانية — توافقُه الحالي وتحذيراته فقط */
    if (active.has(s)) { nowBy[s] = nowOf(active.get(s), r); rej.held = (rej.held || 0) + 1; continue; }
    /* قرار المالك 2026-10-01: لا فرصة بلا تداولٍ في آخر 15 دقيقة. في التداول الممتد قد
       لا يُتداول السهم ساعتين، فتكون آخر شمعةٍ مغلقة أقدم من شمعة اللقطة ويُعرض دخولٌ عمره
       ساعتان على أنه «الآن» (قِيس: CDNS دخول 321.22 من 06:30 في لقطة 08:45، والصفقة التالية
       327). تُستبعد الفرصة وحدها — التحليل في bySym باقٍ — وتعود من تلقاء نفسها في أوّل
       لقطةٍ شمعتُها الأخيرة فيها تداول، لأن كلَّ لقطةٍ تُبنى من الصفر. المحرّك لم يُمسّ. */
    if (!r.reject && bar.t !== H - M15) { rej.notrade = (rej.notrade || 0) + 1; continue; }
    rej[r.reject || "ok"] = (rej[r.reject || "ok"] || 0) + 1;
    if (!r.reject) {
      const tr = newTrade(s, H, r.sig, { fr: frPack(r.fa), dq: dataQuality(S[s], i, r.st), ...(lowSet.has(s) ? { low: 1 } : {}) });
      open.push(tr); active.set(s, tr);
    }
  }
  /* صفقاتٌ وُلدت في هذه اللقطة (إعادة بناءٍ بعد تغيّر النسخة) تبقى «جديدة» */
  const Hs = Math.round(H / 1000);
  for (const tr of active.values()) if (tr.h === Hs && !open.includes(tr)) open.push(tr);
  // الجديدة: قوة التوافق ثم الأحدث حدثاً ثم الرمز — بلا أيّ أثرٍ للصفقات القائمة
  open.sort((a, b) => (b.score - a.score) || ((b.evAt || 0) - (a.evAt || 0)) || (a.s < b.s ? -1 : 1));
  const running = [...active.values()].filter((tr) => tr.h !== Hs)
    .sort((a, b) => ((nowBy[b.s] && nowBy[b.s].score) || 0) - ((nowBy[a.s] && nowBy[a.s].score) || 0) || (b.h - a.h) || (a.s < b.s ? -1 : 1));
  const keep = closed.filter((tr) => tr.end && tr.end.t >= H - CLOSED_KEEP_MS).sort((a, b) => b.end.t - a.end.t);
  const pubOpen = open.map(pubTrade);
  const pubAct = running.map((tr) => {
    const n = nowBy[tr.s];
    return { ...pubSlim(tr), now: n ? { score: n.score, el: n.el, warn: n.warn } : { warn: ["nodata"] } };
  });
  // مفتاح الشمعة = بداية آخر شمعة 15د مغلقة عند الحدّ (على شبكة ربع الساعة)
  const doc = { engine: "v3", mode: "hourly", life: 1, book, version: ver, generatedAt: new Date(now).toISOString(),
    hour: Hs, candleKey: Math.round((H - M15) / 1000), weights: E.E3.W,
    count: pubOpen.length, open: pubOpen, active: pubAct, closed: keep.map(pubEnded), bySym, stats: rej };
  doc.rowsHash = crypto.createHash("sha256").update(JSON.stringify({ open: pubOpen, active: pubAct, bySym })).digest("hex").slice(0, 12);
  if (prev && prev.version === ver && prev.hour > doc.hour)
    return { ok: false, why: `لقطةٌ أقدم ${doc.hour} < ${prev.hour}` };
  const nstate = { book, hour: Hs, version: ver, active: [...active.values()], closed: keep };
  return { ok: true, doc, state: nstate };
}

function writeAtomic(file, doc) {
  const tmp = path.join(path.dirname(file), "." + path.basename(file) + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, file);
}

function selfCheck() {
  const W = E.E3.W, sum = W.day + W.ma + W.trend + W.vwap + W.week;
  if (Math.abs(sum - 100) > 1e-9) throw new Error("مجموع الأوزان ليس 100");
  const ev = (o, c) => E.crossEvents({ o, c }, 100, 90, "pd");
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m + ": " + JSON.stringify(a)); };
  eq(ev(99, 101), ["pdh_break"], "كسر قمة");
  eq(ev(100, 101), ["pdh_break"], "كسر قمة من عندها");
  eq(ev(101, 102), [], "فوق القمة أصلاً");
  eq(ev(89, 91), ["pdl_reclaim"], "استعادة قاع");
  eq(ev(90, 91), [], "من القاع نفسه ليس استعادة");
  eq(ev(91, 89), ["pdl_break"], "كسر قاع");
  eq(ev(101, 99), ["pdh_loss"], "فقد قمة");
  eq(ev(95, 96), [], "داخل النطاق");
  console.log("✓ build-trades --check");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) { selfCheck(); process.exit(0); }
  const r = build({ book: arg("book") });
  if (!r.ok) { console.error("✗ build-trades: " + r.why); process.exit(1); }
  if (r.same) { console.log(`= trades.json: ${r.why} (${new Date(r.doc.hour * 1000).toISOString()})`); process.exit(0); }
  // الحالة قبل المنشور: إن انقطع التشغيل بينهما أعادت اللقطة نفسها البناءَ من حالةٍ صحيحة
  writeAtomic(path.join(OUT, "trades-state.json"), r.state);
  writeAtomic(path.join(OUT, "trades.json"), r.doc);
  console.log(`✓ trades.json (${r.doc.book}) · لقطة ${new Date(r.doc.hour * 1000).toISOString()} · جديدة ${r.doc.open.length} · قائمة ${r.doc.active.length} · منتهية ${r.doc.closed.length} · ${JSON.stringify(r.doc.stats)} · ${r.doc.rowsHash}`);
}
