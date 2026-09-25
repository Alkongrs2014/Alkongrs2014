#!/usr/bin/env node
/* =====================================================================
   إعادة تشغيل محرّك الفرص على الجلسات الماضية — بلا نظرٍ إلى المستقبل.

   لماذا لا `replay.mjs`: ذاك يعيد الاستراتيجيات وإجماعها وحده ولا يمرّ
   بـ`SCANS` ولا بالترتيب ولا بدورة حياة الفرصة — أي أنه لا يجيب «ماذا
   كانت القائمة ستعرض، ومتى؟». وهذا يمرّ بـ`buildSnapshot` نفسه (المدخلات
   تُحقن من الذاكرة) فلا نسخةَ ثانية من المنطق.

   ساعةٌ افتراضية تخطو عند إغلاق كل شمعة ‎15د‎ في الجلسة الرسمية. وفي كل
   خطوة لا يُقرأ إلا ما **أُغلق** قبلها: ‎15د‎ و‎1س‎ بطولها، و‎4س‎ مجمَّعةً
   من الساعة المغلقة، واليوميّ بتاريخه (`closedBars` نفسها). والنتائج
   (أقصى حركةٍ بعد الظهور) تُقاس **بعد** انتهاء المحاكاة من شمعاتٍ لاحقة
   — تقييمٌ لا قرار.

   حدود معلنة: شرطا «أرخص من قطاعه» و«أرباح خلال أسبوع» خارج الإعادة
   (أساسياتُ اليوم نظرٌ إلى المستقبل)، و`low52` يقرأ إشارة ROE الحالية.
   وإجماعُ الاستراتيجيات لا يُعاد (±15 نقطة على الدرجة) — الترتيبُ هنا
   بالمسح والطزاجة وما جرى من الحركة.

   node scripts/replay-opps.mjs [--sessions=10] [--warm=2]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import "./lib/env.mjs";
import { fetchChart, pool } from "./lib/yahoo.mjs";
import { analyze, overallScore, aggregate, bandStable, closedBars } from "./lib/indicators.mjs";
import { buildSnapshot } from "./build-opportunities.mjs";
const require = createRequire(import.meta.url);
const { SCANS, scanRow } = require("../stocks/scans.js");
const { sessionOf, etParts } = require("../stocks/session.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const NSESS = Number(arg("sessions", "10")), WARM = Number(arg("warm", "2"));
const CACHE = path.join(ROOT, "data", ".archive", "replay-cache");
const OUTF = path.join(ROOT, "data", ".monitor", "replay-opps.json");
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(path.dirname(OUTF), { recursive: true });
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks", "symbols.json"), "utf8"));
const FUND = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "fundamentals.json"), "utf8")).f; } catch { return {}; } })();
const KEEP = 260, AW = 259;   // AN_WIN
const r2 = (x) => Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
const pack = (a) => a.map(b => [Math.round(b.t / 1000), b.o, b.h, b.l, b.c, b.v]);
const nyDate = (ms) => { const p = etParts(ms); return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };

async function load(sym) {
  const f = path.join(CACHE, sym + ".json");
  if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 6 * 3600e3) return JSON.parse(fs.readFileSync(f, "utf8"));
  const get = async (rg, iv) => (await fetchChart(sym, { range: rg, interval: iv })).candles;
  let h1;
  try { h1 = await get("730d", "1h"); } catch { h1 = await get("1y", "1h"); }
  const d = { m15: await get("60d", "15m"), h1, d1: await get("5y", "1d") };
  // الجلسة الرسمية وحدها بحجمٍ حقيقي — كما `tradingOnly` في fetch-market
  d.m15 = d.m15.filter(b => sessionOf(b.t + 1) === "REGULAR" && (b.v || 0) > 0);
  fs.writeFileSync(f, JSON.stringify(d));
  return d;
}

const upto = (arr, T, len) => { let n = 0; while (n < arr.length && arr[n].t < T) n++; return arr.slice(Math.max(0, n - (len || n)), n); };

function stepRow(meta, D, T, prevBand) {
  const s15 = closedBars(upto(D.m15, T, KEEP), "15m", T).slice(-AW);
  const all1h = upto(D.h1, T);
  const s1h = closedBars(all1h.slice(-KEEP), "1h", T).slice(-AW);
  const s4h = closedBars(aggregate(all1h, 4).slice(-KEEP), "4h", T).slice(-AW);
  const s1d = closedBars(upto(D.d1, T, KEEP), "1d", T).slice(-AW);
  if (s15.length < 50 || s1d.length < 50) return null;
  const an = {};
  for (const [tf, k] of [["15m", s15], ["1h", s1h], ["4h", s4h], ["1d", s1d]]) {
    const a = k.length ? analyze(k) : null;
    if (a) { const { series, ...rest } = a; an[tf] = rest; }
  }
  const score = r2(overallScore(an));
  const band = bandStable(score, prevBand);
  const b = s15[s15.length - 1], d1 = an["1d"] || {};
  const last252 = s1d.slice(-252);
  const vols = s1d.slice(-20).map(x => x.v).filter(Number.isFinite);
  const row = {
    s: meta.s, ar: meta.ar, en: meta.en, sec: meta.sec,
    p: b.c, pc: b.c, cbar: Math.round(b.t / 1000), ctf: "15m",
    volc: s1d[s1d.length - 1].v, vol: s1d[s1d.length - 1].v,
    score, band, atr: d1.atr ?? null, rsi: d1.rsi ?? null, e20: d1.e20 ?? null, e50: d1.e50 ?? null, e200: d1.e200 ?? null,
    adx: d1.adx ?? null, pdi: d1.pdi ?? null, mdi: d1.mdi ?? null, squeeze: d1.squeeze ?? null,
    ...(d1.div && d1.div.dir ? { div: d1.div.dir } : {}),
    tfScore: Object.fromEntries(Object.entries(an).map(([t, a]) => [t, +a.score.toFixed(1)])),
    w52h: last252.length >= 200 ? Math.max(...last252.map(x => x.h)) : null,
    w52l: last252.length >= 200 ? Math.min(...last252.map(x => x.l)) : null
  };
  const rec = { s: meta.s, tf: { "15m": { c: pack(s15) }, "4h": { c: pack(s4h) }, "1d": { c: pack(s1d) } }, an };
  const f = { avgVol: vols.length ? vols.reduce((x, y) => x + y, 0) / vols.length : null,
              roe: FUND[meta.s] && FUND[meta.s].roe };
  return { row, rec, f };
}

async function main() {
  const syms = cfg.symbols;
  console.log(`▶ إعادة تشغيل الفرص · ${syms.length} سهماً · ${NSESS} جلسات (+${WARM} إحماء)`);
  const data = {};
  let fails = 0;
  await pool(syms, 6, async (m) => { try { data[m.s] = await load(m.s); } catch (e) { fails++; console.log(`  ✗ ${m.s}: ${e.message}`); } });
  console.log(`  ✓ بيانات ${Object.keys(data).length}/${syms.length}${fails ? ` · إخفاقات ${fails}` : ""}`);

  // الجلسات: أيامٌ تامّة (26 شمعة) قبل اليوم
  const today = nyDate(Date.now());
  const byDay = {};
  for (const b of data.NVDA.m15) { const d = nyDate(b.t); (byDay[d] ||= []).push(b.t); }
  // `--today`: بعد الإغلاق تُضمّ جلسةُ اليوم نفسها (مكتملةً) إلى الإعادة
  const TODAY_OK = process.argv.includes("--today");
  const days = Object.keys(byDay).filter(d => (TODAY_OK ? d <= today : d < today) && byDay[d].length >= 13).sort().slice(-(NSESS + WARM));
  const steps = [];
  for (const d of days) for (const t of byDay[d]) steps.push({ day: d, T: t + 900e3 });
  console.log(`  الجلسات: ${days.join(" · ")} · ${steps.length} خطوة`);

  let prevDoc = null;
  const band = {}, timeline = [], fired = {};
  const t0 = Date.now();
  for (const st of steps) {
    const rows = [], recs = {}, F = {};
    for (const m of syms) {
      if (!data[m.s]) continue;
      const x = stepRow(m, data[m.s], st.T, band[m.s]);
      if (!x) continue;
      band[m.s] = x.row.band;
      rows.push(x.row); recs[m.s] = x.rec; F[m.s] = x.f;
      // ما أطلقه أيُّ شرطٍ **قبل** الترشيح بالاتجاه ودورة الحياة — لتشخيص الفائت
      for (const sc of SCANS) {
        let ok = false; try { ok = !!sc.test(scanRow(x.row), x.f, { secMed: {} }); } catch { /* */ }
        if (ok) (fired[`${m.s}|${st.day}`] ||= []).push([st.T, sc.id, sc.dir === -1 ? -1 : 1]);
      }
    }
    const K = Math.max(...rows.map(r => r.cbar));
    const io = {
      rd: (f) => f === "summary.json" ? { rows } : f === "strategies.json" ? { confBar: K, rows: [] }
        : f === "fundamentals.json" ? { f: F } : f === "opportunities.json" ? prevDoc : null,
      sym: (s) => recs[s] || null
    };
    const doc = buildSnapshot(st.T, io);
    if (!doc.ok) { console.log(`  ⚠ ${new Date(st.T).toISOString()} ${doc.why}`); continue; }
    prevDoc = { candleKey: doc.candleKey, scans: doc.scans, life: doc.life, bySym: doc.bySym };
    const list = [];
    for (const [id, rs] of Object.entries(doc.scans))
      rs.forEach((r, i) => list.push({ s: r.s, scan: id, sd: r.sd, q: r.q, i, since: r.since, px0: r.px0, e: r.e, st: r.st, t: r.t, hit: r.hit, fk: r.fk, pc: r.pc }));
    const ended = Object.entries(doc.life).filter(([, L]) => L.end).map(([k, L]) => [k, L.end.k, L.since]);
    timeline.push({ day: st.day, T: st.T, list, closed: doc.closedNow, ended });
  }
  console.log(`  ⏱ ${((Date.now() - t0) / 1000).toFixed(1)}ث`);

  fs.writeFileSync(OUTF, JSON.stringify({ days, warm: WARM, generated: Date.now(), timeline, fired,
    bars: Object.fromEntries(Object.entries(data).map(([s, d]) => [s, d.m15.filter(b => nyDate(b.t) >= days[0]).map(b => [b.t, b.o, b.h, b.l, b.c])])),
    daily: Object.fromEntries(Object.entries(data).map(([s, d]) => [s, d.d1.slice(-30).map(b => [b.t, b.o, b.h, b.l, b.c])])) }));
  console.log(`  ✓ كُتب ${path.relative(ROOT, OUTF)}`);
}

main().catch(e => { console.error("✗", e.stack || e.message); process.exit(1); });
