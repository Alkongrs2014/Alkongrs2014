#!/usr/bin/env node
/* =====================================================================
   مراجعة صفقات الكريبتو منذ V4 (2026-10-03 19:15Z، صفقة WLD) — قراءةٌ فقط.

   لكل صفقةٍ في سجلّ المحرّك (`data/crypto/trades-state.json` — كلُّ صفقات V4: القائمة
   والمنتهية، والمنتهية تُحفظ 24 ساعة بعد نهايتها فلا شيء منذ V4 سقط):
     ١) **صحّة الإصدار**: تُجلب من Binance مباشرةً الشموع المغلقة قبل الحدّ H وحدها
        (`endTime = H − 1`) بنفس أعماق `fetch-crypto` (15د 700 · غيرها 300)، ويُعاد
        `evalSlot` بنفس الشيفرة — فتُقارن الجهة والأساس والدرجة والدخول والوقف والأهداف.
     ٢) **ما جرى فعلاً**: شموع 1د من Binance من H حتى الآن — الدخول عند افتتاح H، ثم أوّل لمسٍ
        للوقف ولكل هدف بترتيبه الدقيق، وأقصى ربحٍ وأقصى تراجعٍ (MFE/MAE)، والسعر الآن.
     ٣) **قواعد المحرّك على بيانات Binance**: `fillTrade`/`stepTrade` على شموع 15د المجلوبة
        مستقلّةً، تُقارن بما سجّله المحرّك الحيّ.
   ولا يكتب شيئاً في data/: المخرجات في reports/crypto-review/.

   node scripts/audit/crypto-trades-review.mjs [--syms=WLD,JST,FF,VELODROME,PLUME] [--all]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prepCrypto, evalSlot } from "../lib/engine3-run.mjs";

const require = createRequire(import.meta.url);
const E = require("../../stocks/engine3.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ALL = process.argv.includes("--all");
const WANT = arg("syms", "WLD,JST,FF,VELODROME,PLUME").split(",").map((x) => x + "-USD");
const OUT = path.join(ROOT, "reports", "crypto-review");
fs.mkdirSync(OUT, { recursive: true });
const M1 = 60000, M15 = 900000, HALF = 1800000;
const V4_START = Date.parse("2026-10-03T19:15:00Z");

const pair = (s) => s.replace(/-USD$/, "") + "USDT";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function klines(sym, interval, { start, end, limit = 1000 } = {}) {
  const u = new URL("https://api.binance.com/api/v3/klines");
  u.searchParams.set("symbol", pair(sym)); u.searchParams.set("interval", interval); u.searchParams.set("limit", String(limit));
  if (start != null) u.searchParams.set("startTime", String(start));
  if (end != null) u.searchParams.set("endTime", String(end));
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
      if (r.status === 429 || r.status === 418) { await sleep(5000); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${pair(sym)} ${interval}`);
      return (await r.json()).map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], ct: k[6] }));
    } catch (e) { if (i >= 3) throw e; await sleep(1000 * (i + 1)); }
  }
}
async function range1m(sym, from, to) {
  const out = [];
  for (let t = from; t < to;) {
    const a = await klines(sym, "1m", { start: t, end: to - 1, limit: 1000 });
    if (!a.length) break;
    out.push(...a); t = a[a.length - 1].t + M1;
    if (a.length < 1000) break;
  }
  return out;
}
async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); } }));
  return res;
}

/* ١) إعادة الإصدار من Binance بشموعٍ مغلقة قبل H وحدها */
async function reissue(s, H) {
  const tf = {};
  for (const [k, iv, n] of [["15m", "15m", 700], ["1h", "1h", 300], ["4h", "4h", 300], ["1d", "1d", 300]]) {
    const a = (await klines(s, iv, { end: H - 1, limit: n })).filter((b) => b.ct < H);   // المغلقة وحدها
    tf[k] = { c: a.map((b) => [b.t / 1000, b.o, b.h, b.l, b.c, b.v]) };
  }
  const S = prepCrypto({ tf });
  const { i, r } = evalSlot(S, H, H - HALF);
  return { r, last15: S.r15[i] };
}

/* ٢) المسار الفعلي بالدقيقة: الدخول عند افتتاح H، ثم ترتيب اللمس */
function path1m(tr, bars) {
  const d = tr.d, b0 = bars.find((b) => b.t >= tr.h * 1000);
  if (!b0) return null;
  const fill = b0.o, ev = [];
  let mfe = 0, mae = 0, stopAt = null; const tgAt = tr.tg.map(() => null);
  for (const b of bars) {
    if (b.t < b0.t) continue;
    const fav = d > 0 ? b.h : b.l, adv = d > 0 ? b.l : b.h;
    mfe = Math.max(mfe, (fav - fill) * d / fill * 100); mae = Math.min(mae, (adv - fill) * d / fill * 100);
    if (stopAt === null && (adv - tr.st) * d <= 0) { stopAt = b.t; ev.push({ k: "stop", t: b.t }); }
    tr.tg.forEach((g, j) => { if (tgAt[j] === null && (fav - g.p) * d >= 0) { tgAt[j] = b.t; ev.push({ k: "T" + (j + 1), t: b.t }); } });
  }
  const last = bars[bars.length - 1];
  return { fill, fillT: b0.t, stopAt, tgAt, mfe: +mfe.toFixed(2), mae: +mae.toFixed(2),
    now: last.c, nowPct: +((last.c - fill) * d / fill * 100).toFixed(2), ev: ev.sort((a, b) => a.t - b.t) };
}

/* ٣) قواعد المحرّك على شموع 15د مستقلّة من Binance */
function engineOn15(tr, b15) {
  const t = { d: tr.d, e: tr.e, st: tr.st, tg: tr.tg.map((x) => ({ ...x })), atrD: tr.atrD, risk: tr.risk, status: "confirmed" };
  const day = (ms) => { const x = new Date(ms); return x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate(); };
  for (const b of b15) {
    if (b.t < tr.h * 1000 || b.ct > Date.now()) continue;                         // المغلقة من H
    const bar = { ...b, d: day(b.t), last: (b.t + M15) % 86400000 === 0 };
    if (t.status === "confirmed") E.fillTrade(t, bar); else if (t.status === "active") E.stepTrade(t, bar);
    if (t.status === "closed" || t.status === "cancelled") break;
  }
  return { status: t.status, hit: t.hit || 0, end: t.end || null, R: E.tradeR(t, true) };
}

const iso = (ms) => ms ? new Date(ms).toISOString().slice(5, 16).replace("T", " ") + "Z" : "—";
const rk = (ms) => ms ? new Date(ms + 3 * 3600000).toISOString().slice(5, 16).replace("T", " ") + " الرياض" : "—";

const st = JSON.parse(fs.readFileSync(path.join(ROOT, "data/crypto/trades-state.json"), "utf8"));
const trades = [...st.active, ...st.closed].filter((t) => t.h * 1000 >= V4_START).sort((a, b) => a.h - b.h);
console.log(`سجلّ المحرّك: ${trades.length} صفقة منذ V4 (${st.active.length} قائمة · ${st.closed.length} منتهية في الحالة) · نسخة ${st.version} · آخر لقطة ${iso(st.hour * 1000)}`);

const NOW = Date.now();
const focus = trades.filter((t) => WANT.includes(t.s));
const report = [];
for (const tr of focus) {
  const H = tr.h * 1000;
  const re = await reissue(tr.s, H);
  const b1 = await range1m(tr.s, H, NOW);
  const b15 = await klines(tr.s, "15m", { start: H, limit: 1000 });
  const p = path1m(tr, b1), eng = engineOn15(tr, b15);
  const sig = re.r && re.r.sig;
  const same = sig && sig.d === tr.d && sig.base === tr.base && sig.score === tr.score
    && Math.abs(sig.e - tr.e) < 1e-12 && Math.abs(sig.st - tr.st) < 1e-12 && JSON.stringify(sig.tg.map((x) => x.p)) === JSON.stringify(tr.tg.map((x) => x.p));
  const row = { id: tr.id, s: tr.s, issued: iso(H), issuedKsa: rk(H), dir: tr.d > 0 ? "شراء" : "بيع", base: tr.base, baseTf: tr.baseTf,
    score: tr.score, e: tr.e, stop: tr.st, stopPct: +((tr.st - tr.e) / tr.e * 100).toFixed(2), tg: tr.tg.map((x) => x.p),
    tgPct: tr.tg.map((x) => +((x.p - tr.e) / tr.e * 100).toFixed(2)), rr1: +((tr.tg[0].p - tr.e) * tr.d / tr.risk).toFixed(2),
    signalBar: re.last15 ? `${iso(re.last15.t)} أُغلقت ${iso(re.last15.end)}` : "—",
    reissue: same ? "مطابق" : (sig ? `مختلف: ${JSON.stringify({ d: sig.d, base: sig.base, score: sig.score, e: sig.e, st: sig.st })}` : `مرفوض: ${re.r && re.r.reject}`),
    live: { status: tr.status, hit: tr.hit || 0, end: tr.end ? { k: tr.end.k, t: iso(tr.end.t), px: tr.end.px } : null },
    binance15: { status: eng.status, hit: eng.hit, end: eng.end ? { k: eng.end.k, t: iso(eng.end.t), px: eng.end.px } : null, R: eng.R && +eng.R.toFixed(2) },
    path1m: p && { fill: p.fill, stopAt: iso(p.stopAt), tgAt: p.tgAt.map(iso), first: p.ev[0] ? `${p.ev[0].k} ${iso(p.ev[0].t)}` : "لا وقف ولا هدف حتى الآن",
      order: p.ev.map((x) => `${x.k}@${iso(x.t)}`).join(" → "), mfe: p.mfe, mae: p.mae, now: p.now, nowPct: p.nowPct } };
  report.push(row);
  console.log(`\n■ ${row.id} — ${row.dir} ${row.issued} (${row.issuedKsa}) · أساس ${row.base}/${row.baseTf} · درجة ${row.score}`);
  console.log(`  دخول ${row.e} · وقف ${row.stop} (${row.stopPct}%) · أهداف ${row.tg.join(" / ")} (${row.tgPct.join("% / ")}%) · R:R1 ${row.rr1}`);
  console.log(`  شمعة الإشارة ${row.signalBar} · إعادة الإصدار من Binance: ${row.reissue}`);
  console.log(`  المحرّك الحيّ: ${row.live.status} hit=${row.live.hit} ${row.live.end ? JSON.stringify(row.live.end) : ""}`);
  console.log(`  القواعد على 15د Binance: ${row.binance15.status} hit=${row.binance15.hit} ${row.binance15.end ? JSON.stringify(row.binance15.end) : ""} R=${row.binance15.R}`);
  if (p) console.log(`  بالدقيقة: دخول ${p.fill} · أوّل حدث: ${row.path1m.first} · الترتيب: ${row.path1m.order || "—"} · MFE +${p.mfe}% · MAE ${p.mae}% · الآن ${p.now} (${p.nowPct}%)`);
}
fs.writeFileSync(path.join(OUT, "focus.json"), JSON.stringify(report, null, 1));

/* المجتمع كلُّه: قواعد المحرّك على 15د Binance لكل صفقات V4، وسياق السوق */
if (ALL) {
  const bySym = {};
  for (const t of trades) (bySym[t.s] ||= []).push(t);
  const syms = Object.keys(bySym);
  const data = {};
  await pool(syms, 8, async (s) => { try { data[s] = await klines(s, "15m", { start: V4_START - M15, limit: 1000 }); } catch (e) { data[s] = null; } });
  const res = [];
  for (const t of trades) {
    const b = data[t.s]; if (!b) continue;
    const eng = engineOn15(t, b);
    const lastC = b.filter((x) => x.ct <= NOW).at(-1);
    res.push({ s: t.s, h: t.h, d: t.d, base: t.base, baseTf: t.baseTf, score: t.score, low: !!t.low,
      riskPct: t.risk / t.e * 100, eng, live: { status: t.status, hit: t.hit || 0, k: t.end && t.end.k },
      openPct: lastC ? (lastC.c - (eng.status === "confirmed" ? t.e : t.e)) * t.d / t.e * 100 : null });
  }
  // تطابق المحرّك الحيّ مع إعادة القواعد على بيانات Binance المستقلّة
  const mism = res.filter((r) => r.live.status !== r.eng.status || r.live.hit !== r.eng.hit || (r.live.k || null) !== ((r.eng.end && r.eng.end.k) || null));
  const btc = data["BTC-USD"] || await klines("BTC-USD", "15m", { start: V4_START - M15, limit: 1000 });
  fs.writeFileSync(path.join(OUT, "population.json"), JSON.stringify({ n: res.length, mism: mism.slice(0, 50), res }, null, 1));
  const grp = (f) => { const g = {}; for (const r of res) (g[f(r)] ||= []).push(r); return g; };
  const sum = (a) => {
    const closed = a.filter((r) => r.eng.status === "closed"), R = closed.map((r) => r.eng.R).filter(Number.isFinite);
    const k = (x) => closed.filter((r) => r.eng.end.k === x).length;
    return `n=${a.length} · منتهية ${closed.length} (وقف ${k("stop")} · تعادل ${k("be")} · هدف أخير ${k("tgt")} · انتهاء مدّة ${k("exp")}) · بلغت T1 ${a.filter((r) => r.eng.hit >= 1).length} · قائمة ${a.filter((r) => r.eng.status === "active").length} · ملغاة ${a.filter((r) => r.eng.status === "cancelled").length} · متوسط R للمنتهية ${R.length ? (R.reduce((x, y) => x + y, 0) / R.length).toFixed(2) : "—"}`;
  };
  console.log(`\n══ المجتمع: ${res.length} صفقة V4 على ${syms.length} عملة`);
  console.log(`  الكلّ: ${sum(res)}`);
  for (const [k, a] of Object.entries(grp((r) => r.d > 0 ? "شراء" : "بيع"))) console.log(`  ${k}: ${sum(a)}`);
  for (const [k, a] of Object.entries(grp((r) => r.base))) console.log(`  أساس ${k}: ${sum(a)}`);
  for (const [k, a] of Object.entries(grp((r) => r.low ? "سيولة منخفضة" : "عادية"))) console.log(`  ${k}: ${sum(a)}`);
  const rq = res.map((r) => r.riskPct).sort((a, b) => a - b);
  console.log(`  مسافة الوقف %: وسيط ${rq[rq.length >> 1].toFixed(2)} · ربيع أدنى ${rq[rq.length >> 2].toFixed(2)} · أدنى ${rq[0].toFixed(2)} · دون 0.5% ${rq.filter((x) => x < 0.5).length}`);
  console.log(`  تطابق المحرّك الحيّ مع قواعده على بيانات Binance المستقلّة: ${res.length - mism.length}/${res.length}${mism.length ? " — المختلف في population.json" : ""}`);
  const b0 = btc.find((b) => b.t >= V4_START), bl = btc.filter((b) => b.ct <= NOW).at(-1);
  const hi = Math.max(...btc.filter((b) => b.t >= V4_START).map((b) => b.h)), lo = Math.min(...btc.filter((b) => b.t >= V4_START).map((b) => b.l));
  console.log(`  BTC منذ V4: ${b0.o} → ${bl.c} (${((bl.c / b0.o - 1) * 100).toFixed(2)}%) · مدى ${lo}–${hi} (${((hi / lo - 1) * 100).toFixed(2)}%)`);
  // اتّساع السوق: نسبة العملات الصاعدة منذ V4، ووسيط عائدها
  const rets = syms.map((s) => { const b = data[s]; if (!b) return null; const a = b.find((x) => x.t >= V4_START), z = b.filter((x) => x.ct <= NOW).at(-1); return a && z ? (z.c / a.o - 1) * 100 : null; }).filter(Number.isFinite).sort((a, b) => a - b);
  console.log(`  العملات منذ V4: صاعدة ${rets.filter((x) => x > 0).length}/${rets.length} · وسيط ${rets[rets.length >> 1].toFixed(2)}%`);
}
