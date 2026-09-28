#!/usr/bin/env node
/* =====================================================================
   ماسح «افتتاح 5m عند خط 200» — دفتر الكريبتو وحده. **قائمة مراقبة لا فرصة.**

   السؤال: أيُّ عملةٍ افتتحت شمعةَ ‎5د‎ الجديدة قرب EMA200 أو SMA200؟
   والمطابقة نطاقٌ لا تساوٍ (‎±0.20%‎) — التساوي الحرفيّ نادر.

   ثلاث قواعد:
   ١) **الخطّان من الشموع المغلقة وحدها**: `closedBars` نفسها، و
      EMA200 بـ`ema` نفسها على نافذة `AN_WIN` نفسها التي يمرّ بها
      `analyzeRec` — فيطابق الرقمُ `an["5m"].e200` المعروض في تحليل العملة
      بالحرف. SMA200 متوسّطُ آخر ‎200‎ إغلاقٍ مغلق.
   ٢) **من الشمعة الجارية الافتتاحُ وحده**: لا إغلاقها ولا قمّتها ولا
      قاعها ولا حجمها. والافتتاح لا يتغيّر بعد بدء الشمعة، فالقائمة ثابتةٌ
      داخلها بالبناء. وليس السعرَ اللحظي: يُؤخذ من الشمعة المخزَّنة إن كانت
      هي الجارية فعلاً، وإلا من `klines` مباشرةً (طلبٌ مستقلّ لهذا الماسح).
   ٣) **لا يكتب إلا ملفَّه** (`ma200-open.json`). لا يدخل `opportunities`
      ولا `strategies` ولا الدرجة ولا اللقطة، ولا يعدّل ملفّات الرموز.
      يقرأ درجةَ الفرصة الحالية من اللقطة **للعرض وحده**.

   يُشغَّل آخرَ دورة الكريبتو (بعد `build-opportunities`) عبر run.mjs crypto،
   أي بعد بدء الشمعة الجديدة بدقيقة — وقتٌ كافٍ لأن تُنشئها Binance.
     node scripts/scan-ma200-open.mjs --out data/crypto
     node scripts/scan-ma200-open.mjs --check
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fetchCandles } from "./lib/binance.mjs";
import { rp } from "./lib/round.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { ema, closedBars, AN_WIN } = require("../stocks/indicators.js");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const oi = args.indexOf("--out");
const OUT = oi >= 0 ? path.resolve(args[oi + 1]) : path.join(ROOT, "data", "crypto");

export const BAND_PCT = 0.20;        // مبدئيّ بطلب المالك — نطاقٌ لا تساوٍ
const BAR = 3e5;                      // ‎5د‎
const LEN = 200;

const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const unpack = (c) => (Array.isArray(c) && Array.isArray(c[0]))
  ? c.map(a => ({ t: a[0] * 1000, o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] })) : (c || []);
const last = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };

/* الخطّان من المغلق وحده. `now` بدايةُ الشمعة الجارية ⇒ كلُّ ما قبلها مغلق.
   ويُشترط أن يكون آخرُ مغلقٍ هو الشمعةَ السابقة مباشرةً: فجوةٌ تعني أن
   الخطّ يصف لحظةً أقدم من الافتتاح الذي يُقارن به. */
export function linesAt(candles, barStart) {
  const closed = closedBars(candles.filter(x => x.t < barStart), "5m", barStart + 1);
  if (closed.length < LEN) return null;
  if (closed[closed.length - 1].t !== barStart - BAR) return null;
  const win = closed.slice(-AN_WIN);                       // نافذة analyzeRec نفسها
  const e = last(ema(win.map(x => x.c), LEN));
  let s = 0;
  for (const x of closed.slice(-LEN)) s += x.c;
  return { ema: e, sma: s / LEN, lastClosed: closed[closed.length - 1].t };
}

/* المطابقة: لكل خطٍّ مسافتُه بالنسبة المئوية من الخطّ. */
export function matchLines(open, L, band = BAND_PCT) {
  const out = [];
  for (const [k, v] of [["EMA", L.ema], ["SMA", L.sma]]) {
    if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(open)) continue;
    const d = (open - v) / v * 100;
    if (Math.abs(d) <= band + 1e-9) out.push({ k, v: rp(v), d: Math.round(d * 1000) / 1000 });
  }
  return out;
}

export function sortRows(rows) {
  return rows.sort((a, b) => Math.abs(a.dmin) - Math.abs(b.dmin) || (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
}

/* درجةُ الفرصة الحالية للعرض: من «الأقوى الآن» إن وُجدت، وإلا أعلى درجةٍ
   للعملة في قوائم الإعدادات. غيابُها «—» لا صفر. */
function oppScores(opp) {
  const m = new Map();
  const put = (r, scan) => {
    if (!Number.isFinite(r.q)) return;
    const q = Math.round(r.q * 100), cur = m.get(r.s);
    if (!cur || q > cur.q) m.set(r.s, { q, scan: r.scan || scan, sd: r.sd });
  };
  const S = (opp && opp.scans) || {};
  for (const r of S.best || []) put(r, "best");
  for (const [k, list] of Object.entries(S)) if (k !== "best") for (const r of list) if (!m.has(r.s)) put(r, k);
  return m;
}

async function pool(items, n, fn) {
  let i = 0;
  const run = async () => { while (i < items.length) { const k = i++; await fn(items[k]); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

async function main() {
  const now = Date.now();
  const barStart = Math.floor(now / BAR) * BAR;
  const U = readJSON(path.join(OUT, "universe.json"));
  if (!U || !Array.isArray(U.rows) || !U.rows.length) throw new Error("لا كون كريبتو — شغّل fetch-crypto أولاً");
  const mkt = readJSON(path.join(OUT, "market.json"), {});
  const scores = oppScores(readJSON(path.join(OUT, "opportunities.json")));

  const rows = [];
  let eligible = 0, fromStore = 0, fromApi = 0, staleN = 0, fails = [];
  await pool(U.rows, 8, async (u) => {
    const rec = readJSON(path.join(OUT, "sym", u.s + ".json"));
    /* ملفٌّ لم يُجلب بعد بدء الشمعة الجارية يحمل الشمعةَ السابقة **جزئيةً**
       (كانت جاريةً لحظة جلبه) — والخطُّ منها ليس خطَّ المغلق. لا نعرف ⇒ لا نعرض. */
    if (!(rec?.tf?.["5m"]?.updated >= barStart)) { staleN++; return; }
    const c = unpack(rec.tf["5m"].c);
    const L = c.length ? linesAt(c, barStart) : null;
    if (!L) return;
    eligible++;
    // الافتتاح: الشمعةُ المخزَّنة إن كانت الجارية فعلاً، وإلا Binance مباشرةً
    let bar = c.find(x => x.t === barStart), src = "store";
    if (!bar) {
      try {
        const { candles } = await fetchCandles(u.s, { interval: "5m", limit: 1 });
        bar = candles.find(x => x.t === barStart);
        src = "api";
      } catch (e) { fails.push(`${u.s}: ${e.message}`); return; }
    }
    if (!bar || !Number.isFinite(bar.o)) return;
    src === "store" ? fromStore++ : fromApi++;
    const lines = matchLines(bar.o, L);
    if (!lines.length) return;
    const near = lines.reduce((a, b) => Math.abs(b.d) < Math.abs(a.d) ? b : a);
    const sc = scores.get(u.s);
    rows.push({ s: u.s, ar: u.ar, en: u.en, o: rp(bar.o), lines, dmin: near.d, near: near.k,
                side: near.d > 0 ? 1 : near.d < 0 ? -1 : 0,
                e200: rp(L.ema), s200: rp(L.sma), q: sc ? sc.q : null, qs: sc ? sc.scan : null });
  });
  sortRows(rows);

  const R = mkt.regime || {};
  const out = {
    updated: now, bar: barStart / 1000, barIso: new Date(barStart).toISOString(),
    bandPct: BAND_PCT, scanned: U.rows.length, eligible, count: rows.length,
    openSrc: { store: fromStore, api: fromApi, fail: fails.length }, stale: staleN,
    btc: { dir: Number.isFinite(R.dir) ? R.dir : 0, pct: Number.isFinite(R.pct) ? R.pct : null },
    rows
  };
  const p = path.join(OUT, "ma200-open.json"), tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, p);
  console.log(`✔ افتتاح 5m عند خط 200: ${rows.length} من ${eligible} عملة مؤهّلة · شمعة ${out.barIso}` +
    ` · الافتتاح من المخزَّن ${fromStore} ومن Binance ${fromApi}${staleN ? ` · ${staleN} ملفّاً لم يُجدَّد لهذه الشمعة` : ""}${fails.length ? ` · ${fails.length} فشل (أول: ${fails[0]})` : ""}`);
}

/* ---------- الفحص الذاتي — بلا شبكة ---------- */
function selfCheck() {
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n} — ${e.message}`); fail++; } };
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const bs = Math.floor(Date.now() / BAR) * BAR;
  const mk = (n) => Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 7) * 3 + i * 0.01;
    return { t: bs - (n - 1 - i) * BAR, o: c - 0.1, h: c + 0.5, l: c - 0.5, c, v: 10 };
  });

  t("الشمعة الجارية لا تدخل الخطّين — تشويه إغلاقها وقمّتها وقاعها وحجمها لا يغيّر شيئاً", () => {
    const a = mk(300), b = mk(300);
    Object.assign(b[b.length - 1], { c: 999, h: 1500, l: 1, v: 1e9 });
    const A = linesAt(a, bs), B = linesAt(b, bs);
    ok(A && B && A.ema === B.ema && A.sma === B.sma, `${A?.ema}/${B?.ema}`);
  });
  t("ضابطٌ سلبيّ: لو دخلت الجارية لتغيّر الخطّ", () => {
    const a = mk(300), b = mk(300); b[b.length - 1].c = 999;
    // نفس الحساب **بلا** استبعاد الجارية — يجب أن يختلف، وإلا فالفحص الأوّل لا يقيس شيئاً
    const E = (k) => last(ema(k.slice(-AN_WIN).map(x => x.c), LEN));
    ok(E(a) !== E(b), "الحساب لا يتأثّر بإغلاقٍ شاذّ — الفحص الأوّل لا يقيس شيئاً");
  });
  t("EMA200 = نفس analyze على نفس النافذة", () => {
    const { analyze } = require("../stocks/indicators.js");
    const a = mk(300), cl = closedBars(a.filter(x => x.t < bs), "5m", bs + 1).slice(-AN_WIN);
    const an = analyze(cl);
    ok(Math.abs(an.e200 - linesAt(a, bs).ema) < 1e-12, `${an.e200} ≠ ${linesAt(a, bs).ema}`);
  });
  t("مثال المالك: Open 0.1000 و EMA 0.1001 ⇒ ‎−0.10%‎ تحت الخطّ · وتظهر", () => {
    const m = matchLines(0.1000, { ema: 0.1001, sma: 0.2 });
    ok(m.length === 1 && m[0].k === "EMA" && Math.abs(m[0].d + 0.0999) < 0.001, JSON.stringify(m));
  });
  t("خارج النطاق (‎0.25%‎) لا يظهر · والحدّ ‎0.20%‎ يظهر", () => {
    ok(!matchLines(100.25, { ema: 100, sma: null }).length, "0.25% ظهر");
    ok(matchLines(100.2, { ema: 100, sma: null }).length === 1, "0.20% لم يظهر");
  });
  t("الخطّان معاً حين يطابقان", () => {
    const m = matchLines(100, { ema: 100.1, sma: 99.9 });
    ok(m.length === 2 && m.map(x => x.k).join() === "EMA,SMA", JSON.stringify(m));
  });
  t("الترتيب من الأقرب إلى الأبعد بالقيمة المطلقة", () => {
    const r = sortRows([{ s: "A", dmin: 0.15 }, { s: "B", dmin: -0.02 }, { s: "C", dmin: 0.05 }]);
    ok(r.map(x => x.s).join("") === "BCA", r.map(x => x.s).join(""));
  });
  t("أقلّ من ‎200‎ شمعة مغلقة ⇒ لا خطّ", () => ok(linesAt(mk(150), bs) === null, "حُسب خطٌّ ناقص"));
  t("فجوةٌ قبل الجارية ⇒ لا مقارنة (الخطّ يصف لحظةً أقدم)", () => {
    const a = mk(300).slice(0, -3);      // آخر مغلقٍ قبل الجارية بثلاث شموع
    ok(linesAt(a, bs) === null, "قُورن افتتاحٌ بخطٍّ متأخّر");
  });
  console.log(`\n${pass} ✓ · ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  if (CHECK) selfCheck();
  else main().catch(e => { console.error("✗ " + e.message); process.exit(1); });
}
