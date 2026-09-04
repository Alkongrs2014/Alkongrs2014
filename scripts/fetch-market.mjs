#!/usr/bin/env node
/* =====================================================================
   المهمة الدورية (كل 10 دقائق أثناء ساعات السوق).
   تجلب الأسعار والشموع، تحسب المؤشرات، وتكتب ملفات JSON يقرأها المتصفح.

   الاستخدام:
     node scripts/fetch-market.mjs --out ./out
     node scripts/fetch-market.mjs --check        (فحص ذاتي بلا شبكة)
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchChart, fetchQuotes, fetchStooqDaily, pool, stats, num, tradingPeriodFromMeta
} from "./lib/yahoo.mjs";
import { fetchQuotesFinnhub, fhStats } from "./lib/finnhub.mjs";
import { fetchCandlesTD, hasTwelveData, tdSleep, tdStats } from "./lib/twelvedata.mjs";
import { analyze, overallScore, aggregate, TFS, TF_WEIGHT } from "./lib/indicators.mjs";
import { marketStatus, approxMarketStatus } from "./lib/session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const OUT = (() => { const i = args.indexOf("--out"); return i >= 0 ? path.resolve(args[i + 1]) : path.join(ROOT, "out"); })();

const KEEP = 260;                 // يكفي لـ EMA200 مع هامش، ويُبقي الملفات خفيفة
const MAX_AGE = { "15m": 0, "1h": 55 * 60e3, "1d": 20 * 3600e3 };
const RANGE   = { "15m": "60d", "1h": "730d", "1d": "5y" };

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));

/* ---------- ميزانية طلبات Twelve Data لكل تشغيل ----------
   الخطة المجانية: 8 طلبات/دقيقة و800/يوم. تعبئة الفريمات الثلاثة لكل
   الرموز السبعين = 210 طلباً = 28 دقيقة، أطول من مهلة المهمة وأكبر من
   حصة اليوم لو تكرّر. فنحدّث دفعة صغيرة كل تشغيل (~100 ثانية) وتكتمل
   التغطية تدريجياً عبر التشغيلات، مع بقاء بيانات الشمعات السابقة كما هي.
   14 طلباً × 48 تشغيلاً يومياً ≈ 672 طلباً — داخل حصة الـ800. */
const TD_PER_RUN = Number(process.env.TD_PER_RUN || 14);
const tdBudget = { left: TD_PER_RUN };

/* على شبكة منزلية Yahoo غير محظور ومجاني بلا سقف، فيُقدَّم على Twelve Data
   وتسقط الحاجة لميزانية الطلبات. يُضبط PREFER_YAHOO=1 في التشغيل المحلي. */
const PREFER_YAHOO = process.env.PREFER_YAHOO === "1";

/* تقريب — Yahoo يعيد 62.014999389648438 والتخزين بلا تقريب يضاعف حجم الملفات */
const r2 = (v) => (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v * 100) / 100;
const r4 = (v) => (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v * 10000) / 10000;
const slimCandles = (c) => c.map(x => ({
  t: x.t, o: r4(x.o), h: r4(x.h), l: r4(x.l), c: r4(x.c), v: Math.round(x.v || 0)
}));
/* ضغط الشمعات عند الكتابة فقط: مصفوفة بدل كائن يوفّر ~45% من الحجم.
   [الوقت بالثواني, فتح, أعلى, أدنى, إغلاق, حجم] */
const packCandles = (c) => c.map(x => [Math.round(x.t / 1000), x.o, x.h, x.l, x.c, x.v]);
/* الملفات المحفوظة تحوي الشكل المضغوط، فإعادة استخدامها في تشغيل تالٍ
   بلا فكّ ضغط تمرّر مصفوفات حيث يُتوقّع كائنات فينهار الحساب على
   x.c.toFixed. لم يظهر هذا إلا بعد أن صار هناك بيانات سابقة فعلاً. */
const unpackCandles = (c) => (Array.isArray(c) && Array.isArray(c[0]))
  ? c.map(a => ({ t: a[0] * 1000, o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] }))
  : c;
const slimAnalysis = (a) => {
  const o = {};
  for (const [k, v] of Object.entries(a)) o[k] = (typeof v === "number") ? r4(v) : v;
  return o;
};

/* ---------- أدوات ملفات ---------- */
const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
function writeJSON(rel, obj) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
  return fs.statSync(p).size;
}

/* ---------- أي فريم يحتاج تحديثاً؟ ---------- */
function stale(prev, tf, now) {
  const u = prev?.tf?.[tf]?.updated;
  if (!u) return true;
  return (now - u) >= MAX_AGE[tf];
}

/* حالة الجلسة في scripts/lib/session.mjs — تستعملها مهمة الأسعار
   السريعة أيضاً، ونسخة واحدة تمنع اختلاف الترويسة بين المهمتين. */

async function buildSymbol(meta, prevDir, now, quotes) {
  const sym = meta.s;
  const prev = readJSON(path.join(prevDir, "sym", `${sym}.json`));
  // نُعيد الشمعات المحفوظة إلى شكل الكائنات فور القراءة، فما بعدها من
  // حساب ورسم يتعامل مع شكل واحد فقط
  for (const o of Object.values(prev?.tf || {})) if (o?.c) o.c = unpackCandles(o.c);
  const rec = { s: sym, ar: meta.ar, en: meta.en, sec: meta.sec, tf: {}, src: "yahoo", updated: now };
  let touched = false, errors = [], usedTD = false;

  // الترتيب مقصود: اليومي أولاً لأنه أساس الشارت والنتيجة الفنية، فحين
  // تنفد ميزانية الطلبات في تشغيل واحد تكون الفريمات الأهم قد امتلأت
  for (const tf of ["1d", "1h", "15m"]) {
    if (!stale(prev, tf, now) && prev?.tf?.[tf]?.c?.length) {
      rec.tf[tf] = prev.tf[tf];                       // ما زال حديثاً — أبقِه
      continue;
    }
    // Twelve Data أولاً حين يتوفّر مفتاحه: Yahoo يحظر رينرات GitHub
    // (429 حتى عبر curl) فلا يُعتمد عليه، لكنه يبقى محاولة ثانية مجانية
    // لأنه ينجح أحياناً ويعطي فترات التداول التي لا يعطيها غيره.
    // طلب واحد لكل رمز في التشغيل الواحد: بلا هذا القيد تبتلع أول أربعة
    // رموز الميزانية كاملةً (ثلاثة فريمات لكل رمز) ويبقى 66 رمزاً بلا أي
    // شمعة لساعات. بالقيد يأخذ كل رمز يومِيَّه أولاً فتكتمل الشارتات
    // والنتائج الفنية لكل الرموز خلال ~6 تشغيلات بدل 18.
    let got = false;

    const tryYahoo = async () => {
      const { candles, meta: m } = await fetchChart(sym, {
        range: RANGE[tf], interval: tf, prePost: tf === "15m"
      });
      rec.tf[tf] = { updated: now, c: slimCandles(candles.slice(-KEEP)) };
      // فترات التداول الحقيقية لا يوفّرها غير Yahoo — وهي أدق من التقدير
      if (tf === "15m" && m) { rec.period = tradingPeriodFromMeta(m); rec.cur = num(m.regularMarketPrice); }
      rec.src = "yahoo";
      touched = true; got = true;
    };

    const tryTD = async () => {
      if (!hasTwelveData() || tdBudget.left <= 0 || usedTD) return;
      tdBudget.left--; usedTD = true;
      try {
        const { candles } = await fetchCandlesTD(sym, tf, { outputsize: KEEP });
        rec.tf[tf] = { updated: now, c: slimCandles(candles.slice(-KEEP)) };
        rec.src = "twelvedata";
        touched = true; got = true;
      } catch (e) { errors.push(`${tf}/td: ${e.message}`); }
      await tdSleep();                       // حد 8 طلبات/دقيقة على الخطة المجانية
    };

    // ترتيب المصادر يعتمد على مكان التشغيل، لأن الحظر مرتبط بعنوان الشبكة:
    // من رينر سحابي (GitHub) يرفض Yahoo كل طلب بـ429، فـ Twelve Data أولاً
    // بميزانيته المحدودة. من شبكة منزلية Yahoo غير محظور ومجاني بلا سقف،
    // فيصير هو الأول ويُستغنى عن ميزانية الطلبات كلياً.
    const yahooFirst = PREFER_YAHOO;
    if (yahooFirst) {
      try { await tryYahoo(); } catch (e) { errors.push(`${tf}: ${e.message}`); }
      if (!got) await tryTD();
    } else {
      await tryTD();
      if (!got) try { await tryYahoo(); } catch (e) { errors.push(`${tf}: ${e.message}`); }
    }
    if (!got && prev?.tf?.[tf]?.c?.length) rec.tf[tf] = prev.tf[tf];  // أبقِ القديم بدل الحذف
  }

  // Yahoo سقط كلياً لهذا الرمز -> جرّب Stooq لليومي حتى لا ينقطع السهم
  if (!rec.tf["1d"]?.c?.length) {
    try {
      const { candles } = await fetchStooqDaily(sym);
      rec.tf["1d"] = { updated: now, c: slimCandles(candles.slice(-KEEP)) };
      rec.src = "stooq";
      touched = true;
    } catch (e) { errors.push(`stooq: ${e.message}`); }
  }

  if (!Object.keys(rec.tf).length) {
    // لا شموع من أي مصدر — لو عندنا سعر من Finnhub نُدرج السهم بسعر فقط
    // بلا شارت/مؤشرات بدل استبعاده بالكامل (الواجهة تتعامل مع هذا أصلاً)
    const q = quotes?.[sym];
    if (!(q && Number.isFinite(q.regularMarketPrice) && q.regularMarketPrice > 0)) {
      throw new Error(errors.join(" | ") || "no data");
    }
    rec.src = "finnhub";
    rec.noChart = true;
  }

  // اشتقاق فريم 4 ساعات من الساعة (Yahoo لا يوفّره)
  if (rec.tf["1h"]?.c?.length) rec.tf["4h"] = { updated: rec.tf["1h"].updated, c: slimCandles(aggregate(rec.tf["1h"].c, 4).slice(-KEEP)), derived: true };

  // المؤشرات لكل فريم
  rec.an = {};
  for (const tf of TFS) {
    const a = rec.tf[tf]?.c ? analyze(rec.tf[tf].c) : null;
    if (!a) continue;
    const { series, ...rest } = a;                    // لا نحفظ السلاسل الكاملة (حجم)
    rec.an[tf] = slimAnalysis(rest);
  }
  rec.score = r2(overallScore(rec.an));
  rec.stale = !touched;
  if (errors.length) rec.errors = errors;
  return rec;
}

/* ---------- التشغيل ---------- */
async function main() {
  const now = Date.now();
  const prevDir = fs.existsSync(path.join(OUT, "meta.json")) ? OUT : OUT;   // نبني فوق ما هو موجود
  fs.mkdirSync(OUT, { recursive: true });

  const universe = cfg.symbols;
  console.log(`▶ تحديث ${universe.length} رمزاً …`);

  // الترتيب اليومي يحدد الـ70؛ إن لم يوجد بعد نأخذ ترتيب الملف
  const ranking = readJSON(path.join(OUT, "ranking.json"));
  // الأساسيات اليومية تسدّ ما لا تعطيه أسعار Finnhub المجانية (نطاق 52
  // أسبوعاً ومتوسط الحجم). بدونها كانت هذه الحقول null دائماً في الملخص،
  // فيسقط فرز "حجم التداول" في الواجهة صامتاً.
  const fundamentals = readJSON(path.join(OUT, "fundamentals.json"))?.f || {};
  const chosen = ranking?.top?.length
    ? universe.filter(u => ranking.top.includes(u.s)).sort((a, b) => ranking.top.indexOf(a.s) - ranking.top.indexOf(b.s))
    : universe.slice(0, cfg.top);
  console.log(`  الرموز المختارة: ${chosen.length} ${ranking?.top?.length ? "(من الترتيب اليومي)" : "(ترتيب مبدئي)"}`);

  // ترتيب المعالجة حسب الحاجة، لا حسب القيمة السوقية: صلاحية فريم 15 دقيقة
  // صفر أي "قديم دائماً"، فالرموز الممتلئة تستهلك ميزانية التشغيل كاملةً في
  // تحديث نفسها ولا يصل الدور أبداً لمن لا يملك شمعة واحدة — عالقاً عند 14
  // من 70 مهما تكرّرت التشغيلات. من يفتقد اليومي أولاً، ثم الساعة، ثم 15د.
  const needRank = (s) => {
    const tf = readJSON(path.join(OUT, "sym", `${s}.json`))?.tf || {};
    if (!tf["1d"]?.c?.length) return 0;
    if (!tf["1h"]?.c?.length) return 1;
    if (!tf["15m"]?.c?.length) return 2;
    return 3;
  };
  const order = new Map(chosen.map(c => [c.s, needRank(c.s)]));
  chosen.sort((a, b) => order.get(a.s) - order.get(b.s));
  const needy = [...order.values()].filter(v => v < 3).length;
  if (needy) console.log(`  رموز ناقصة الشمعات: ${needy} — لها أولوية الميزانية`);

  // 1) دفعة الأسعار — Finnhub أولاً (مصدر موثوق بمفتاح، لا يُحظر مثل Yahoo)
  const allSymbols = [...chosen.map(c => c.s), ...cfg.indices.map(i => i.s),
                      ...cfg.indices.map(i => i.proxy).filter(Boolean)];
  let quotes = null;
  try {
    quotes = await fetchQuotesFinnhub(allSymbols);
    console.log(`  ✓ أسعار Finnhub: ${quotes ? Object.keys(quotes).length : 0} رمز`);
  } catch (e) { console.warn(`  ⚠ أسعار Finnhub فشلت: ${e.message}`); }
  if (!quotes) {
    try {
      quotes = await fetchQuotes(allSymbols);
      console.log(`  ✓ دفعة أسعار Yahoo (احتياط): ${quotes ? Object.keys(quotes).length : 0} رمز`);
    } catch (e) { console.warn(`  ⚠ دفعة أسعار Yahoo فشلت أيضاً: ${e.message}`); }
  }

  // 2) الشموع
  // حد Twelve Data (8/دقيقة) عام لا لكل رمز، فالتوازي معه يتجاوزه ويهدر
  // الرصيد على طلبات مرفوضة — نسلسل حين يكون مفعَّلاً
  // التسلسل مفروض بحد Twelve Data (8/دقيقة عام لا لكل رمز). حين يكون Yahoo
  // هو المصدر الأول (تشغيل محلي) فلا حد يقيّدنا، فنتوازى ونختصر الوقت
  // من ~28 دقيقة إلى دقائق معدودة لكل الرموز السبعين.
  const lanes = (hasTwelveData() && !PREFER_YAHOO) ? 1 : 3;
  const results = await pool(chosen, lanes, (m) => buildSymbol(m, OUT, now, quotes));
  const rows = [], failed = [];
  results.forEach((r, i) => {
    if (r.ok) rows.push(r.value);
    else { failed.push({ s: chosen[i].s, error: r.error }); console.warn(`  ✗ ${chosen[i].s}: ${r.error}`); }
  });
  console.log(`  ✓ نجح ${rows.length} / ${chosen.length}`);
  if (!rows.length) throw new Error("لم ينجح أي رمز — لن نكتب فوق البيانات السليمة");

  // 3) ملفات الأسهم + صفوف الملخص
  let bytes = 0;
  const summary = rows.map(rec => {
    const packed = { ...rec, v: 2, tf: {} };
    for (const [tf, o] of Object.entries(rec.tf)) packed.tf[tf] = { ...o, c: packCandles(o.c) };
    bytes += writeJSON(`sym/${rec.s}.json`, packed);
    const q = quotes?.[rec.s];
    const fnd = fundamentals[rec.s];
    const d1 = rec.tf["1d"]?.c || [];
    const lastC = d1.length ? d1[d1.length - 1].c : null;
    const prevC = d1.length > 1 ? d1[d1.length - 2].c : null;
    const lastV = d1.length ? num(d1[d1.length - 1].v) : null;

    const price = num(q?.regularMarketPrice) ?? rec.cur ?? lastC;
    const chg = num(q?.regularMarketChangePercent)
      ?? (lastC && prevC ? (lastC - prevC) / prevC * 100 : null);

    // سعر ما قبل / بعد الإغلاق
    let ext = null;
    if (num(q?.preMarketPrice) !== null)
      ext = { k: "PRE", p: r4(num(q.preMarketPrice)), c: r2(num(q.preMarketChangePercent)) };
    else if (num(q?.postMarketPrice) !== null)
      ext = { k: "POST", p: r4(num(q.postMarketPrice)), c: r2(num(q.postMarketChangePercent)) };

    const spark = (rec.tf["1h"]?.c || d1).slice(-30).map(x => +x.c.toFixed(2));

    return {
      s: rec.s, ar: rec.ar, en: rec.en, sec: rec.sec,
      p: r4(price), chg: r2(chg), ext, spark,
      score: rec.score,
      atr: r4(rec.an["1d"]?.atr ?? null), rsi: r2(rec.an["1d"]?.rsi ?? null),
      tfScore: Object.fromEntries(TFS.filter(t => rec.an[t]).map(t => [t, +rec.an[t].score.toFixed(1)])),
      mc: num(q?.marketCap) ?? ranking?.mc?.[rec.s] ?? null,
      // حجم آخر شمعة يومية = حجم الجلسة الجارية (أو آخر جلسة مكتملة حين
      // يكون السوق مغلقاً). أدق من متوسط عشرة أيام، فنقدّمه عليه.
      vol: num(q?.regularMarketVolume) ?? (lastV || null) ?? num(fnd?.avgVol),
      w52h: r4(num(q?.fiftyTwoWeekHigh) ?? num(fnd?.w52h)),
      w52l: r4(num(q?.fiftyTwoWeekLow) ?? num(fnd?.w52l)),
      stale: !!rec.stale, src: rec.src
    };
  });
  summary.sort((a, b) => (b.mc ?? 0) - (a.mc ?? 0));

  // 4) المؤشرات العامة + اتساع السوق + القطاعات
  const idxRows = [];
  for (const ix of cfg.indices) {
    const q = quotes?.[ix.s];
    let p = num(q?.regularMarketPrice), chg = num(q?.regularMarketChangePercent);
    if (p === null) {
      try {
        const { candles } = await fetchChart(ix.s, { range: "1mo", interval: "1d" });
        const a = candles[candles.length - 1], b = candles[candles.length - 2];
        p = a?.c ?? null; chg = (a && b) ? (a.c - b.c) / b.c * 100 : null;
      } catch (e) { console.warn(`  ⚠ مؤشر ${ix.s}: ${e.message}`); }
    }
    // Finnhub المجاني يرفض رموز المؤشرات (^GSPC) لكنه يعطي صناديق ETF التي
    // تتبعها. نسبة التغيّر منها تكاد تطابق المؤشر وهي المطلوبة لمزاج السوق،
    // أما المستوى نفسه (4,600 نقطة) فلا يُشتق من سعر الصندوق فنتركه شرطة
    // بدل عرض سعر ETF موهماً أنه مستوى المؤشر.
    let viaProxy = false;
    if (chg === null && ix.proxy) {
      const pq = quotes?.[ix.proxy];
      const pc = num(pq?.regularMarketChangePercent);
      if (pc !== null) { chg = pc; viaProxy = true; }
    }
    idxRows.push({ s: ix.s, ar: ix.ar, en: ix.en, p: r2(p), chg: r2(chg), ...(viaProxy ? { proxy: ix.proxy } : {}) });
  }

  // Number.isFinite لا isFinite: العالمية تحوّل null إلى صفر، فسهم بلا
  // سعر يُحسب "تغيّر 0%" ويدخل متوسط قطاعه ويجرّه نحو الصفر
  const withChg = summary.filter(r => Number.isFinite(r.chg));
  const bySector = {};
  for (const r of withChg) {
    (bySector[r.sec] ||= { sec: r.sec, n: 0, sum: 0 });
    bySector[r.sec].n++; bySector[r.sec].sum += r.chg;
  }
  const sectors = Object.values(bySector)
    .map(x => ({ sec: x.sec, n: x.n, avg: r2(x.sum / x.n) }))
    .sort((a, b) => b.avg - a.avg);

  const scored = summary.filter(r => Number.isFinite(r.score));
  const period = rows.find(r => r.period)?.period || null;
  const status = period ? marketStatus(period, now) : approxMarketStatus(now);

  writeJSON("market.json", {
    updated: now, status, period, indices: idxRows, sectors,
    breadth: {
      up: withChg.filter(r => r.chg > 0).length,
      down: withChg.filter(r => r.chg < 0).length,
      flat: withChg.filter(r => r.chg === 0).length,
      total: withChg.length
    },
    marketScore: scored.length ? r2(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null,
    gainers: [...withChg].sort((a, b) => b.chg - a.chg).slice(0, 5).map(r => ({ s: r.s, ar: r.ar, chg: r.chg, p: r.p })),
    losers:  [...withChg].sort((a, b) => a.chg - b.chg).slice(0, 5).map(r => ({ s: r.s, ar: r.ar, chg: r.chg, p: r.p }))
  });

  writeJSON("summary.json", { updated: now, count: summary.length, rows: summary });

  const prevMeta = readJSON(path.join(OUT, "meta.json"), {});
  writeJSON("meta.json", {
    ...prevMeta,
    marketUpdated: now,
    marketRun: {
      at: new Date(now).toISOString(),
      ok: rows.length, failed: failed.length, failures: failed,
      stale: summary.filter(r => r.stale).map(r => r.s),
      quotes: quotes ? Object.keys(quotes).length : 0,
      requests: stats.requests, retries: stats.retries, sources: stats.sources,
      finnhub: { requests: fhStats.requests, failures: fhStats.failures },
      twelvedata: { requests: tdStats.requests, failures: tdStats.failures, budget: TD_PER_RUN }
    }
  });

  console.log(`✔ كُتب ${summary.length} سهماً (${(bytes / 1024).toFixed(0)} ك.ب) · حالة السوق: ${status.ar}`);
  console.log(`  طلبات: ${stats.requests} · إعادة محاولة: ${stats.retries} · إخفاقات: ${stats.failures}`);
  if (failed.length) console.log(`  ⚠ رموز فاشلة: ${failed.map(f => f.s).join(", ")}`);
}

/* ---------- فحص ذاتي بلا شبكة ---------- */
function selfCheck() {
  console.log("▶ فحص ذاتي (بلا شبكة)\n");
  let pass = 0, fail = 0;
  const t = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name} — ${e.message}`); fail++; } };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

  t("symbols.json صالح و 90 رمزاً", () => {
    if (cfg.symbols.length !== 90) throw new Error(`${cfg.symbols.length}`);
    if (cfg.top !== 70) throw new Error("top ≠ 70");
    for (const s of cfg.symbols) if (!s.s || !s.ar || !s.sec) throw new Error(`حقل ناقص في ${s.s}`);
  });

  const H = 3600e3;
  t("stale() يحترم أعمار الفريمات", () => {
    const now = 1_700_000_000_000;
    eq(stale({ tf: { "15m": { updated: now - 60e3 } } }, "15m", now), true, "15m دائماً");
    eq(stale({ tf: { "1h": { updated: now - 10 * 60e3 } } }, "1h", now), false, "1h حديث");
    eq(stale({ tf: { "1h": { updated: now - 2 * H } } }, "1h", now), true, "1h قديم");
    eq(stale({ tf: { "1d": { updated: now - 5 * H } } }, "1d", now), false, "1d حديث");
    eq(stale({ tf: { "1d": { updated: now - 25 * H } } }, "1d", now), true, "1d قديم");
    eq(stale(null, "1d", now), true, "لا بيانات سابقة");
  });

  t("marketStatus يميّز الجلسات الأربع", () => {
    const base = 1_700_000_000_000;
    const p = { pre: { start: base, end: base + 5 * H }, regular: { start: base + 5 * H, end: base + 11 * H }, post: { start: base + 11 * H, end: base + 15 * H } };
    eq(marketStatus(p, base + 1 * H).state, "PRE", "قبل الافتتاح");
    eq(marketStatus(p, base + 7 * H).state, "REGULAR", "مفتوح");
    eq(marketStatus(p, base + 12 * H).state, "POST", "بعد الإغلاق");
    eq(marketStatus(p, base + 20 * H).state, "CLOSED", "مغلق");
    eq(marketStatus(null, base).state, "UNKNOWN", "بلا فترات");
  });

  t("approxMarketStatus يميّز الجلسات بتوقيت نيويورك", () => {
    // 15 يناير 2024 — لا توقيت صيفي (EST = UTC-5)
    eq(approxMarketStatus(Date.UTC(2024, 0, 15, 12, 0)).state, "PRE", "7ص محلي");
    eq(approxMarketStatus(Date.UTC(2024, 0, 15, 15, 0)).state, "REGULAR", "10ص محلي");
    eq(approxMarketStatus(Date.UTC(2024, 0, 15, 22, 0)).state, "POST", "5م محلي");
    eq(approxMarketStatus(Date.UTC(2024, 0, 13, 15, 0)).state, "CLOSED", "سبت");
  });

  t("packCandles/unpackCandles رحلة ذهاب وعودة", () => {
    const c = [{ t: 1_700_000_000_000, o: 1.5, h: 2.5, l: 1, c: 2, v: 100 },
               { t: 1_700_000_060_000, o: 2, h: 3, l: 1.8, c: 2.8, v: 200 }];
    const round = unpackCandles(packCandles(c));
    eq(round, c, "الشكل يعود كما كان");
    // الخلل الفعلي: مصفوفة مضغوطة تُستخدم بلا فك، فـ x.c غير معرّف
    if (packCandles(c)[0].c !== undefined) throw new Error("المضغوط يجب ألا يحمل c");
    if (typeof round[0].c.toFixed !== "function") throw new Error("المفكوك يجب أن يحمل رقماً في c");
    eq(unpackCandles(c), c, "المفكوك أصلاً يمرّ كما هو");
  });

  t("أولوية الميزانية للرموز الناقصة لا الممتلئة", () => {
    // نحاكي منطق needRank: الرمز الفارغ يسبق الممتلئ مهما كان ترتيبه الأصلي
    const rank = (tf) => !tf["1d"]?.c?.length ? 0
                       : !tf["1h"]?.c?.length ? 1
                       : !tf["15m"]?.c?.length ? 2 : 3;
    const full  = { "1d": { c: [1] }, "1h": { c: [1] }, "15m": { c: [1] } };
    const empty = {};
    eq([rank(empty), rank(full)], [0, 3], "الفارغ أولى من الممتلئ");
    eq(rank({ "1d": { c: [1] } }), 1, "ناقص الساعة");
    eq(rank({ "1d": { c: [1] }, "1h": { c: [1] } }), 2, "ناقص 15 دقيقة");
    const sorted = [{ s: "ممتلئ", t: full }, { s: "فارغ", t: empty }]
      .sort((a, b) => rank(a.t) - rank(b.t)).map(x => x.s);
    eq(sorted, ["فارغ", "ممتلئ"], "الترتيب يقدّم الناقص");
  });

  t("aggregate يبني 4h صحيحة من 1h", () => {
    const c = [{ t: 0, o: 1, h: 5, l: 0.5, c: 2, v: 10 }, { t: 1, o: 2, h: 6, l: 1, c: 3, v: 10 },
               { t: 2, o: 3, h: 4, l: 2, c: 4, v: 10 }, { t: 3, o: 4, h: 9, l: 3, c: 5, v: 10 }];
    const [b] = aggregate(c, 4);
    eq([b.o, b.h, b.l, b.c, b.v], [1, 9, 0.5, 5, 40], "شمعة مجمّعة");
  });

  t("analyze يعطي إشارات صحيحة", () => {
    const up = Array.from({ length: 300 }, (_, i) => ({ t: i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1 }));
    if (analyze(up).score < 50) throw new Error("صعود لم يُكتشف");
    const dn = up.slice().reverse().map((x, i) => ({ ...x, t: i }));
    if (analyze(dn).score > -50) throw new Error("هبوط لم يُكتشف");
    if (analyze(up.slice(0, 5)) !== null) throw new Error("سلسلة قصيرة يجب أن تعيد null");
  });

  t("overallScore يزن الفريمات الكبيرة أكثر", () => {
    const s = overallScore({ "15m": { score: -100 }, "1h": { score: -100 }, "4h": { score: 100 }, "1d": { score: 100 } });
    const expect = (-100 * 0.5 + -100 * 1 + 100 * 1.5 + 100 * 2) / 5;
    if (Math.abs(s - expect) > 1e-9) throw new Error(`${s} ≠ ${expect}`);
    if (s <= 0) throw new Error("الفريمات الكبيرة يجب أن ترجّح النتيجة للصعود");
    eq(overallScore({}), null, "بلا فريمات");
  });

  t("num() لا يختلق أرقاماً", () => {
    eq([num(3), num({ raw: 4 }), num(null), num(undefined), num(NaN), num("5")], [3, 4, null, null, null, null], "num");
  });

  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل`);
  process.exit(fail ? 1 : 0);
}

if (CHECK) selfCheck();
else main().catch(e => { console.error("✗ فشل التشغيل:", e.message); process.exit(1); });
