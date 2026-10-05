#!/usr/bin/env node
/* =====================================================================
   الأدوات الخمس الأساسية في قسم العقود — SPX · SPY · QQQ · XSP · NDX
   (طلب المالك 2026-10-05: ظاهرةٌ دائماً، مفتوحةً كانت الجلسة أو مغلقة).

   لكل أداة **ما يتوفّر فعلاً** في اشتراك Alpaca Algo Trader Plus، بلا تقدير:
     · سعر الأصل: SIP للصندوقين في 04:00–20:00، وBOATS في الليلي 20:00–04:00 (موسومٌ
       بمصدره). والمؤشرات النقدية بلا سعر — Alpaca لا يعطي بيانات المؤشرات
       (`/v1beta1/indices` ⇒ 403 مقيس، وتوثيقه يقول ذلك). ولا يُعرض سعر SPY على أنه SPX.
     · عقود الخيارات: OPRA بعرضها وطلبها الحقيقيين وعمرهما — للصندوقين حول السعر، وللمؤشرات
       عند السترايك الذي يتقارب فيه وسطا الكول والبوت (اختيارُ سترايك لا تقديرُ سعر).
     · جلسة كلّ سوق من `stocks/hours.js` (نيويورك ⇒ الرياض تلقائياً صيفاً وشتاءً).
     · التوصية: عقدٌ منفرد CALL/PUT من لقطة العقود (`contracts.json`) القابلة للتنفيذ وحدها؛
       وللمؤشرات **لا توصية** ما دام سعر الأصل وشموعه غائبة — لا تُبنى خطةٌ بلا أصل.

   مستقلٌّ عن العقود والمحرّك: يقرأ لقطتيهما ولا يكتب فيهما، وفشلُه لا يمسّ غيره.
   node scripts/build-core5.mjs [--out DIR] [--check]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as AO from "./providers/alpaca-options.mjs";
import { renameRetry } from "./lib/rename-retry.mjs";

const require = createRequire(import.meta.url);
const SES = require("../stocks/session.js");
const HRS = require("../stocks/hours.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(argOf("out", path.join(ROOT, "data")));
const MIN = 60000, DAY = 86400000;
export const FRESH_MS = 10 * MIN;       // عرضٌ أحدث من هذا = «حيّ» في جلسته
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const r2 = (x) => Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
const sec = (ms) => Number.isFinite(ms) ? Math.round(ms / 1000) : null;
function writeAtomic(f, doc) { const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(doc)); renameRetry(tmp, f); }

/* حالة سوقٍ لأداة: مفتوح/مغلق، اسم الجلسة، ومتى تنتهي أو تبدأ القادمة */
export function sessOf(kind, now) {
  const st = HRS.stateAt(kind, now);
  return { open: st.open, k: st.cur ? st.cur.k : null, until: st.cur ? sec(st.cur.end) : null,
           next: st.next ? { k: st.next.k, at: sec(st.next.start) } : null };
}

/* عقدٌ من لقطة OPRA بحقولٍ مختصرة */
function quoteOf(sym, sn) {
  const q = (sn && sn.latestQuote) || {}, p = AO.parseOcc(sym);
  const bid = q.bp > 0 ? q.bp : null, ask = q.ap > 0 ? q.ap : null;
  return { sym, K: p.K, exp: p.exp, type: p.type, bid, ask, mid: bid && ask ? r2((bid + ask) / 2) : null,
           spr: bid && ask ? r2((ask - bid) / ((ask + bid) / 2) * 100) : null, qt: q.t ? sec(Date.parse(q.t)) : null,
           last: sn && sn.latestTrade ? { p: sn.latestTrade.p, t: sec(Date.parse(sn.latestTrade.t)) } : null,
           vol: sn && sn.dailyBar ? sn.dailyBar.v : null, iv: sn && sn.impliedVolatility != null ? r2(sn.impliedVolatility * 100) : null,
           delta: sn && sn.greeks ? r2(sn.greeks.delta) : null };
}
/* أقرب انتهاءٍ فيه زوجُ كول/بوت بعرضٍ وطلبٍ على الجهتين، والسترايك المختار:
   للصندوق الأقربُ إلى سعره، وللمؤشر (بلا سعر) حيث يتقارب وسطا الكول والبوت */
export function atmPair(snaps, S) {
  const by = {};
  for (const [sym, sn] of Object.entries(snaps)) {
    const q = quoteOf(sym, sn);
    if (!q.bid || !q.ask) continue;
    ((by[q.exp] ||= {})[q.K] ||= {})[q.type] = q;
  }
  for (const exp of Object.keys(by).sort()) {
    const pairs = Object.entries(by[exp]).filter(([, v]) => v.call && v.put).map(([K, v]) => ({ K: +K, ...v }));
    if (!pairs.length) continue;
    const key = Number.isFinite(S) ? (x) => Math.abs(x.K - S) : (x) => Math.abs(x.call.mid - x.put.mid);
    const best = pairs.sort((a, b) => key(a) - key(b))[0];
    return { exp, K: best.K, call: best.call, put: best.put, by: Number.isFinite(S) ? "price" : "parity" };
  }
  return null;
}
/* أفضل توصية عقدٍ منفرد (CALL/PUT) للرمز من لقطة العقود — القابلة للتنفيذ وحدها */
export function recOf(s, C, now) {
  if (!C || !Array.isArray(C.picks)) return { rec: null, why: "لا لقطة عقود" };
  const mine = C.picks.filter((p) => p.s === s && p.kind === "single").sort((a, b) => (b.score || 0) - (a.score || 0));
  const fresh = C.hour && now - C.hour * 1000 <= 45 * MIN;
  const ok = mine.filter((p) => p.exec);
  if (ok.length && fresh) {
    const p = ok[0], l = p.legs[0];
    return { rec: { id: p.id, type: l.type, K: l.K, exp: l.exp, dte: l.dte, sym: l.sym, bid: l.bid, ask: l.ask, mid: l.mid,
      entry: p.entry, stop: p.stop, tg: p.tg, uT: p.uT, inv: p.inv, rr: p.rr, score: p.score, cat: p.cat, at: p.at, S: p.S,
      qt: l.qt, oi: l.oi, vol: l.vol, spr: l.spr, delta: l.delta, iv: l.iv, v3: p.v3 || null, why: p.why || [] }, why: null };
  }
  /* NDX: تحليلٌ من بياناتٍ حقيقية حديثة صالح، والتنفيذ عبر Alpaca غير مدعوم — يُعرض موسوماً لا مخلوطاً */
  const an = mine.filter((p) => p.anOnly);
  if (an.length && fresh) { const r = recOf(s, { ...C, picks: an.map((p) => ({ ...p, exec: true })) }, now).rec; if (r) return { rec: { ...r, brokerOK: false }, why: null }; }
  const sig = C.sigs && C.sigs[s];
  if (!fresh) return { rec: null, why: "لقطة العقود ليست من الجلسة الجارية" };
  if (mine.length) return { rec: null, why: mine[0].execWhy || "غير قابلة للتنفيذ الآن" };
  return { rec: null, why: (sig && sig.why && sig.why[0]) || (C.skip && C.skip[s]) || "لا عقد يستوفي الشروط في هذه اللقطة" };
}

/* توصيتان على صندوقين يتبعان السوق نفسه (SPY وQQQ) بنفس النوع في نفس اللقطة ليستا فرصتين مستقلّتين —
   تُوسَم الأضعف `sameAs` بالأقوى وتبقى ظاهرة (عرضٌ لا قرار) */
export function markSame(rows) {
  const by = {};
  for (const r of rows) if (r.rec) (by[r.rec.type] ||= []).push(r);
  for (const g of Object.values(by)) {
    g.sort((a, b) => (b.rec.score || 0) - (a.rec.score || 0));
    for (const r of g.slice(1)) r.sameAs = g[0].s;
  }
  return rows;
}

export async function build({ now = Date.now(), out = OUT } = {}) {
  const C = readJ(path.join(out, "contracts.json"));
  const IX = readJ(path.join(out, "idx-trades.json"));
  const today = SES.etParts(now).date;
  const expLte = new Date(now + 8 * DAY).toISOString().slice(0, 10);
  const boats = HRS.stateAt("boats", now).open;
  const etf = HRS.CORE5.filter((x) => x.type === "etf").map((x) => x.s);
  const errs = {};
  /* سعر الصندوقين: SIP دائماً (آخر صفقة في 04:00–20:00)، وBOATS فوقه حين يكون الليلي مفتوحاً */
  let sip = {}, night = {};
  try { sip = await AO.stockSnapshots(etf, "sip"); } catch (e) { errs.sip = e.message; }
  if (boats) { try { night = await AO.stockSnapshots(etf, "boats"); } catch (e) { errs.boats = e.message; } }
  const rows = [];
  for (const x of HRS.CORE5) {
    const row = { s: x.s, ar: x.ar, type: x.type, note: x.note, roots: x.roots, opt: sessOf(x.opt, now) };
    if (x.type === "etf") {
      row.under = sessOf("stock", now);
      row.night = sessOf("boats", now);
      const a = sip[x.s], b = night[x.s];
      const ta = a && a.latestTrade ? Date.parse(a.latestTrade.t) : 0, tb = b && b.latestTrade ? Date.parse(b.latestTrade.t) : 0;
      const use = tb > ta ? { sn: b, src: "BOATS" } : a ? { sn: a, src: "SIP" } : null;
      if (use && use.sn.latestTrade) {
        const prev = use.sn.prevDailyBar ? use.sn.prevDailyBar.c : null;
        const reg = a && a.dailyBar ? a.dailyBar.c : null;      // إغلاق آخر يومٍ رسمي (SIP)
        row.px = { p: use.sn.latestTrade.p, t: sec(Date.parse(use.sn.latestTrade.t)), src: use.src,
          bid: use.sn.latestQuote ? use.sn.latestQuote.bp : null, ask: use.sn.latestQuote ? use.sn.latestQuote.ap : null,
          ref: use.src === "BOATS" ? reg : prev, chg: null };
        if (row.px.ref > 0) row.px.chg = r2((row.px.p / row.px.ref - 1) * 100);
      } else row.px = null;
      row.trade = { alpaca: true };
    } else {
      /* المؤشر: المستوى المشتقّ من تعادل عقوده (fetch-contracts) — حين تكون لقطة العقود من الجلسة الجارية */
      const sg = C && C.sigs && C.sigs[x.s], freshC = C && C.hour && now - C.hour * 1000 <= 45 * MIN;
      row.px = sg && sg.S && freshC ? { p: sg.S, t: sg.qAt, src: "PARITY", ref: sg.prev, chg: sg.chg, disp: sg.disp, pairs: sg.pairs, iv: sg.iv, move: sg.move } : null;
      row.pxWhy = row.px ? null : sg && sg.why && sg.why[0] && freshC ? sg.why[0]
        : "يُشتقّ مستوى المؤشر من عروض عقوده في الجلسة الرسمية وحدها (لا تتجدّد ليلاً) — Alpaca بلا بيانات مؤشرات";
      row.trade = { alpaca: x.s !== "NDX" };
    }
    /* سلسلة العقود حول السعر — أقرب انتهاءين أو ثلاثة */
    const snaps = {};
    for (const root of x.roots) {
      try {
        const S = row.px ? row.px.p : null;
        const o = { expGte: today, expLte, maxPages: 4 };
        if (S) { o.kLo = Math.floor(S * 0.97); o.kHi = Math.ceil(S * 1.03); }
        Object.assign(snaps, (await AO.chainSnapshots(root, o)).snaps);
      } catch (e) { errs[`${x.s}/${root}`] = e.message; }
    }
    row.chainN = Object.keys(snaps).length;
    row.atm = atmPair(snaps, row.px ? row.px.p : null);
    if (row.atm) {
      const qts = [row.atm.call.qt, row.atm.put.qt].filter(Boolean);
      row.atm.age = qts.length ? Math.round(now / 1000 - Math.min(...qts)) : null;
      row.atm.live = row.atm.age !== null && row.atm.age * 1000 <= FRESH_MS;
    }
    /* حالة البيانات في الجلسة الجارية — تُقاس ولا تُفترض (لا يُستنتج دعمُ GTH من دعم الرسمية) */
    if (row.opt.open) row.optData = row.atm && row.atm.live ? "live" : "stale";
    else row.optData = "closed";
    if (x.type === "etf") {
      const r = recOf(x.s, C, now);
      row.rec = row.opt.open ? r.rec : null;
      row.recWhy = row.rec ? null : !row.opt.open ? "سوق خيارات الصندوق مغلق الآن" : r.why;
      const v3 = IX ? [...(IX.open || []), ...(IX.active || [])].find((t) => t.s === x.s) : null;
      row.v3 = v3 ? { d: v3.d, score: v3.now && Number.isFinite(v3.now.score) ? v3.now.score : v3.score, h: v3.h, isNew: (IX.open || []).includes(v3), same: v3.same || null } : null;
    } else {
      const r = recOf(x.s, C, now);
      row.rec = row.opt.open ? r.rec : null;
      row.recWhy = row.rec ? null : !row.opt.open ? "سوق خيارات المؤشر مغلق الآن" : !row.px ? row.pxWhy : r.why;
      row.v3 = null;
    }
    rows.push(row);
  }
  markSame(rows);
  const fut = sessOf("fut", now);
  return { v: 1, generatedAt: new Date(now).toISOString(), at: sec(now), rows, errs,
    fut: { ...fut, why: "العقود الآجلة (ES/NQ) غير متاحة في Alpaca — للاطّلاع على موعدها فقط، ولا توصيات عليها" },
    src: { etf: "Alpaca SIP · BOATS (الليلي)", opt: "Alpaca OPRA", idx: "غير متاح في الاشتراك" } };
}

function selfCheck() {
  let n = 0; const ok = (c, m) => { if (!c) throw new Error(m); n++; };
  const mk = (sym, bp, ap) => [sym, { latestQuote: { bp, ap, t: "2026-10-05T14:00:00Z" } }];
  const sn = Object.fromEntries([mk("SPXW261005C06700000", 20, 21), mk("SPXW261005P06700000", 25, 26),
    mk("SPXW261005C06705000", 17, 18), mk("SPXW261005P06705000", 17.5, 18.5), mk("SPXW261005C06710000", 14, 15), mk("SPXW261005P06710000", 21, 22),
    mk("SPXW261006C06705000", 30, 31)]);
  const a = atmPair(sn, null);
  ok(a && a.exp === "2026-10-05" && a.K === 6705 && a.by === "parity", "سترايك المؤشر: " + JSON.stringify(a && a.K));
  ok(atmPair(sn, 6699).K === 6700, "سترايك الصندوق الأقرب إلى السعر");
  ok(atmPair({ [mk("SPY261005C00700000", 0, 1)[0]]: { latestQuote: { bp: 0, ap: 1 } } }, 700) === null, "زوجٌ بلا عرضٍ قُبل");
  const C = { hour: 1000, picks: [{ s: "SPY", kind: "single", exec: true, score: 2, legs: [{ type: "call", K: 700, exp: "2026-10-09" }], entry: 2 },
    { s: "SPY", kind: "debit", exec: true, score: 9, legs: [{}, {}] }, { s: "QQQ", kind: "single", exec: false, execWhy: "عرض/طلب قديم", legs: [{}] }] };
  ok(recOf("SPY", C, 1000e3 + 60e3).rec.K === 700, "توصية الصندوق المنفردة");
  ok(recOf("QQQ", C, 1000e3).rec === null && recOf("QQQ", C, 1000e3).why === "عرض/طلب قديم", "غير القابلة للتنفيذ لا تُعرض توصية");
  ok(recOf("SPY", C, 1000e3 + 50 * MIN).rec === null, "لقطةٌ قديمة أُعطيت توصية");
  const ms = markSame([{ s: "SPY", rec: { type: "call", score: 2 } }, { s: "QQQ", rec: { type: "call", score: 3 } }, { s: "SPX", rec: null }]);
  ok(ms[0].sameAs === "QQQ" && !ms[1].sameAs && !ms[2].sameAs, "نفس الحركة");
  ok(sessOf("eqopt", Date.parse("2026-10-05T03:00:00Z")).open === false && sessOf("spxopt", Date.parse("2026-10-05T03:00:00Z")).open === true, "جلسات الخيارات ليلاً");
  console.log(`✓ build-core5 --check · ${n} فحصاً`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (argv.includes("--check")) { selfCheck(); process.exit(0); }
  if (!AO.available()) { console.error("✗ build-core5: مفاتيح Alpaca غائبة"); process.exit(1); }
  const t0 = Date.now();
  const doc = await build({});
  const okRows = doc.rows.filter((r) => r.atm).length;
  if (!okRows) { console.error("✗ build-core5: لا سلسلة عقود لأيّ أداة — " + JSON.stringify(doc.errs).slice(0, 300)); process.exit(1); }
  writeAtomic(path.join(OUT, "core5.json"), doc);
  console.log(`✓ core5.json · ${doc.rows.map((r) => `${r.s}:${r.optData}${r.rec ? "+rec" : ""}${r.px ? "@" + r.px.src : ""}`).join(" ")} · ${((Date.now() - t0) / 1000).toFixed(1)}ث`);
}
