#!/usr/bin/env node
/* =====================================================================
   تحديث الأسعار وحدها — الحلقة السريعة.

   لماذا مهمة منفصلة: التشغيل الكامل يعيد جلب شمعات السبعين على ثلاثة
   فريمات، وهو ما يستغرق دقائق ويثقل المصدر. لكن ما يتغيّر كل دقيقة هو
   السعر لا الشمعة المكتملة. فصلُ الاثنين يجعل السعر يتحدّث كل دقيقتين
   بينما تبقى الشمعات والمؤشرات على دورتها العشرية.

   الحد الفعلي: Finnhub المجاني ستون طلباً في الدقيقة، وسبعون رمزاً
   تحتاج ~75 ثانية. فأسرع دورة واقعية دقيقتان لا دقيقة واحدة.

   لا تُحسب هنا أي مؤشرات: النتيجة الفنية وATR وRSI تبقى كما كتبها
   fetch-market. تحديث السعر بلا تحديث الشمعة لا يغيّرها فعلاً، وحسابها
   من سعر واحد يعطي رقماً كاذباً.

     node scripts/fetch-quotes.mjs --out ./data
     node scripts/fetch-quotes.mjs --check
   ===================================================================== */
import fs from "node:fs";
import { rp } from "./lib/round.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fhStats } from "./lib/finnhub.mjs";
import { statusNow, sessionOf } from "./lib/session.mjs";
import * as PROV from "./providers/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const OUT = (() => { const i = args.indexOf("--out"); return i >= 0 ? path.resolve(args[i + 1]) : path.join(ROOT, "out"); })();
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
const PREFER_YAHOO = process.env.PREFER_YAHOO === "1";

const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJSON = (rel, o) => fs.writeFileSync(path.join(OUT, rel), JSON.stringify(o));
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : null;
const r2 = (v) => v === null ? null : Math.round(v * 100) / 100;
/* تقريب الأسعار بالأرقام المعنوية لا بالخانات العشرية: أصل بسعر
   0.0000051 (شيبا إينو) يصير صفراً بالتقريب إلى أربع خانات. نفس
   الدالة في fetch-market.mjs — أي اختلاف بينهما يجعل السعر يقفز بين
   دورة الأسعار ودورة الشمعات. */
/* التقريب السعري مشتركٌ — انظر `lib/round.mjs`. */

/* يُعاد حسابه من نسب التغيّر الجديدة. الاتساع والنتيجة الفنية لا،
   لأنهما من الشمعات التي لم تتغيّر. */
/* =====================================================================
   خطُّ أساس التغيّر يتبع الجلسة — وإلا وصف الاتساعُ يوم أمس.

   `chg` في الصفّ صار **يطابق `p` دائماً**: في الجلسة الرسمية تغيّرُ
   اليوم، وفي الجلسة الممتدة التغيّرُ عن إغلاق الجلسة الرسمية السابقة.
   وهذا هو الرقم الذي يقرأه المتداول قبل الافتتاح، ولا معنى لغيره:
   «تغيّر أمس» ثابتٌ لا يتحرّك، فاتّساعُ سوقٍ محسوبٌ منه يعطي نفس
   الأرقام كل صباحٍ حتى ‎09:30‎ ثم يقفز.

   والفرق **يُقال في `market.json`** (`basis`) فتكتبه الواجهة بجانب
   القوائم: «أكثر ارتفاعاً قبل الافتتاح» ليست «أكثر ارتفاعاً اليوم»،
   وعرضُهما بنفس العنوان يخلط قياسين — نفس قاعدة فصل الكريبتو.
   ===================================================================== */
export function recompute(rows, prevMarket) {
  // الكريبتو خارج إحصاء السوق الأمريكي — مداه اليومي أوسع بمراتب فيحتل
  // قائمتَي الرابحين والخاسرين ويزيح متوسطات القطاعات. نفس الاستبعاد في
  // fetch-market، وأي اختلاف بينهما يجعل القوائم تقفز بين الدورتين.
  // Number.isFinite لا isFinite: العالمية تحوّل null إلى صفر فتعتبره
  // "تغيّر 0%"، فيدخل سهم بلا سعر في متوسط قطاعه ويجرّه نحو الصفر
  const withChg = rows.filter(r => r.mkt !== "crypto" && Number.isFinite(r.chg));

  const bySector = {};
  for (const r of withChg) {
    (bySector[r.sec] ||= { sec: r.sec, n: 0, sum: 0 });
    bySector[r.sec].n++; bySector[r.sec].sum += r.chg;
  }
  const sectors = Object.values(bySector)
    .map(x => ({ sec: x.sec, n: x.n, avg: r2(x.sum / x.n) }))
    .sort((a, b) => b.avg - a.avg);

  const mv = (dir) => withChg.slice()
    .sort((a, b) => dir * ((b.chg ?? 0) - (a.chg ?? 0)))
    .slice(0, 5)
    .map(r => ({ s: r.s, ar: r.ar, chg: r.chg, p: r.p }));

  return { ...prevMarket, sectors, gainers: mv(1), losers: mv(-1) };
}

/* المؤشرات العامة: Finnhub المجاني يرفض رموزها (^GSPC) ويقبل صناديق
   ETF التي تتبعها. نأخذ نسبة التغيّر من الصندوق ونترك المستوى كما كان
   بدل عرض سعر الصندوق موهماً أنه مستوى المؤشر. */
/* التغيّر المطابق للسعر المعروض: ممتدٌّ في الجلسة الممتدة ورسميٌّ
   في الرسمية. موضعٌ واحد له، فلا تختلف الترويسة عن الصفوف. */
export const chgOf = (q) => {
  if (!q) return null;
  const v = (q.sess === "PRE" || q.sess === "AFTER") ? q.extChangePct : q.regularChangePct;
  return (typeof v === "number" && isFinite(v)) ? v : null;
};

export function refreshIndices(prevIdx, quotes, cfgIdx = []) {
  // market.json لا يحفظ حقل proxy إلا حين يُستعمل فعلاً، فالاعتماد عليه
  // وحده كان يترك المؤشرات مجمّدة على قيم آخر تشغيل كامل
  const proxyOf = Object.fromEntries(cfgIdx.filter(i => i.proxy).map(i => [i.s, i.proxy]));
  return (prevIdx || []).map(ix => {
    const proxy = ix.proxy || proxyOf[ix.s] || null;
    /* الشكل الموحّد من طبقة المزوّد: `price` و`chgOf` لا حقول ياهو
       الخام. والمؤشّرات تتبع الجلسة كما تتبعها الأسهم — صندوق SPY له
       سعرٌ قبل الافتتاح، وتجميدُ المؤشّر وحده يجعل الترويسة تقول
       «السوق ثابت» والقوائم تحته تتحرّك. */
    let p = num(quotes[ix.s]?.price);
    let chg = chgOf(quotes[ix.s]);
    let viaProxy = false;
    if (chg === null && proxy) {
      const pc = chgOf(quotes[proxy]);
      if (pc !== null) { chg = pc; viaProxy = true; }
    }
    if (p === null && chg === null) return ix;              // لا جديد — أبقِ القديم
    return { ...ix, p: p === null ? ix.p : r2(p), chg: chg === null ? ix.chg : r2(chg),
             ...(viaProxy ? { proxy } : {}) };
  });
}

async function main() {
  const now = Date.now();
  const summary = readJSON(path.join(OUT, "summary.json"));
  const market = readJSON(path.join(OUT, "market.json"));
  if (!summary?.rows?.length || !market)
    throw new Error("لا يوجد ملخّص سابق — شغّل fetch-market.mjs أولاً");
  if (!PREFER_YAHOO && !process.env.FINNHUB_API_KEY)
    throw new Error("FINNHUB_API_KEY غير مضبوط — لا مصدر أسعار سريع بدونه");

  const syms = summary.rows.map(r => r.s);
  // رموز المؤشرات (‎^GSPC‎) يرفضها Finnhub المجاني دائماً، وكل طلب مرفوض
  // يستهلك من حصّة الستين في الدقيقة ويطيل الدورة بلا مقابل. نطلب
  // صناديقها البديلة وحدها.
  const extra = cfg.indices.map(i => i.proxy).filter(Boolean);

  // الطبقة الواسعة تُسعَّر مع دفعات Yahoo وحدها: 414 رمزاً إضافياً تكلّف
  // أحد عشر طلباً هناك، بينما تكلّف Finnhub 414 طلباً — سبع دقائق تكسر
  // دورة الدقيقتين. سحابياً تبقى أسعارها من جلبها اليومي.
  const wide = PREFER_YAHOO ? readJSON(path.join(OUT, "wide.json")) : null;
  const wideSyms = wide?.rows?.map(r => r.s) || [];
  console.log(`▶ أسعار ${syms.length} رمزاً${wideSyms.length ? ` + ${wideSyms.length} في الطبقة الواسعة` : ""} …`);

  /* المصدر يُختار من طبقة المزوّد بالقدرة لا بالاسم. وشرطُ الجلسة
     الممتدة يدخل الاختيار صراحةً: Finnhub المجاني **لا يتحرّك قبل
     ‎09:30‎ إطلاقاً** (قِيس: `/quote MSFT` يعيد إغلاق أمس وختمَ أمس
     في السابعة والنصف صباحاً)، فاختيارُه في الجلسة الممتدة يعيد
     المشكلة التي نصلحها. */
  const want = [...syms, ...wideSyms, ...extra];
  const sess = sessionOf(now);
  const needExt = (sess === "PRE" || sess === "AFTER");
  const { provider, skipped, degraded } = PROV.pick("equity", needExt ? ["extendedHours"] : []);
  console.log(`  الجلسة: ${sess}${needExt ? " (ممتدة)" : ""} · المزوّد: ${provider.id}` +
    (skipped.length ? ` · تُخطّي: ${skipped.map(x => x.id + "(" + x.why + ")").join("، ")}` : ""));
  if (degraded?.length)
    console.warn(`  ⚠ المزوّد المختار ينقصه: ${degraded.join("، ")} — البوابات المعتمِدة عليه ستُعلن توقّفها`);

  let quotes = null, src = "";
  try {
    quotes = await provider.getQuotes(provider.caps.batch ? want : [...syms, ...extra], { pace: 1050 });
    if (quotes) src = provider.id;
  } catch (e) { console.warn(`  ⚠ ${provider.id}: ${e.message}`); }
  /* احتياطٌ واحد لا سلسلة: المزوّد التالي في الترتيب المتاح */
  if (!quotes) {
    for (const alt of PROV.providers().filter(x => x.available && x.id !== provider.id && x.caps.markets.includes("equity"))) {
      try {
        const pv = PROV.get(alt.id);
        quotes = await pv.getQuotes(pv.caps.batch ? want : [...syms, ...extra], { pace: 1050 });
        if (quotes) { src = alt.id + " (احتياط)"; break; }
      } catch (e) { console.warn(`  ⚠ ${alt.id}: ${e.message}`); }
    }
  }
  if (!quotes) throw new Error("لم يصل أي سعر — لن نكتب فوق بيانات سليمة");
  console.log(`  المصدر: ${src}`);

  /* الكريبتو **يُدمج فوق** المصدر الأول لا يتنافس معه: طلبٌ واحد يجيب كل
     أزواج Binance، وهو أدقّ من ياهو لهذه الفئة ولا يكلّف شيئاً. ودمجُه
     بعد النداء الأول يعني أن فشله لا يُسقط أسعار الأسهم — يبقى ما وصل
     من المصدر الأصلي كما هو. */
  const cryptoSyms = [...new Set([...syms, ...wideSyms])].filter(s => /-USD$/.test(s));
  if (cryptoSyms.length) {
    try {
      const bn = await PROV.binance.getQuotes(cryptoSyms);
      if (bn) {
        Object.assign(quotes, bn);
        console.log(`  + ${Object.keys(bn).length} من ${cryptoSyms.length} عملة رقمية من Binance (طلب واحد)`);
      }
    } catch (e) { console.warn(`  ⚠ Binance: ${e.message}`); }
  }

  /* =====================================================================
     **السطر الذي كان يجمّد التطبيق كلَّه قبل الافتتاح.**

     كان: `r.p = rp(num(q.regularMarketPrice))` — وياهو لا يحرّك هذا
     الحقل قبل ‎09:30‎ إطلاقاً. فكانت دورةُ الدقيقتين تكتب **إغلاق أمس**
     فوق نفسه كل دقيقتين طوال الجلسة الممتدة، وسعرُ ما قبل الافتتاح
     يُكتب في `ext` **للعرض وحده**. وكلُّ ماسحٍ وخطةٍ واستراتيجية تقرأ
     `p`. قياسٌ حيّ ‎2026-09-15 07:28 ET‎: `MSFT.p = 505.41` (إغلاق
     أمس) و`ext.PRE = 500.11` — والفرق ‎1.05%‎ لم يره المحرّك.

     الآن السعر **سعرُ الجلسة الجارية**، و`p` و`chg` يصفان اللحظة
     نفسها دائماً. ويبقى `pReg` إغلاقَ الجلسة الرسمية لمن يحتاجه
     (الفجوة، والبيفوت، وخطّ أساس الحركة).
     ===================================================================== */
  const applyQuotes = (rows) => {
    let n = 0, ext = 0;
    for (const r of rows) {
      const q = quotes[r.s];
      if (!q) continue;
      const p = num(q.price);
      if (p === null || p <= 0) continue;
      r.p = rp(p);
      r.psess = q.sess || "REGULAR";
      if (q.at) r.pAt = q.at;
      /* الإغلاق الرسمي الأخير — يبقى محفوظاً ولو كان السعر ممتداً */
      if (num(q.regular) !== null) r.pReg = rp(num(q.regular));
      /* `chg` يطابق `p`: تغيّرُ الجلسة الممتدة عن الإغلاق السابق حين
         نكون فيها، وتغيّرُ اليوم حين تكون الجلسة رسمية. */
      const c = (r.psess === "PRE" || r.psess === "AFTER")
        ? num(q.extChangePct) : num(q.regularChangePct);
      if (c !== null) r.chg = r2(c);
      if (r.psess === "PRE" || r.psess === "AFTER") ext++;
      n++;
    }
    return { n, ext };
  };

  const { n: hit, ext: extHit } = applyQuotes(summary.rows);
  // بوابة السلامة: تحديث جزئي جداً يعني عطلاً في المصدر لا سوقاً هادئاً
  if (hit < syms.length * 0.5)
    throw new Error(`${hit} من ${syms.length} فقط وصلت — مرفوض`);

  summary.updated = now;
  writeJSON("summary.json", summary);

  // الطبقة الواسعة: السعر وحده. `u` عمر الشمعات لا عمر السعر، فلا يُمس —
  // لمسه هنا يجعل fetch-market يظنّ يوميّها حديثاً فلا يجدّده أبداً.
  let wideHit = 0;
  if (wide?.rows?.length) {
    wideHit = applyQuotes(wide.rows).n;
    wide.updated = now;
    writeJSON("wide.json", wide);
  }

  const m2 = recompute(summary.rows, market);
  m2.indices = refreshIndices(market.indices, quotes, cfg.indices);
  // الفترات المحفوظة تصف يوم جلبها؛ استعمالها في اليوم التالي كان يبقي
  // الحالة "بعد الإغلاق" والسوق مفتوح
  m2.status = statusNow(market.period, now);
  m2.updated = now;
  writeJSON("market.json", m2);

  const prevMeta = readJSON(path.join(OUT, "meta.json"), {});
  writeJSON("meta.json", {
    ...prevMeta, marketUpdated: now,
    quotesRun: { at: new Date(now).toISOString(), ok: hit, of: syms.length, src,
                 wide: wideHit, wideOf: wideSyms.length, requests: fhStats.requests }
  });

  console.log(`✔ ${hit} / ${syms.length} سعراً${wideSyms.length ? ` · الواسعة ${wideHit} / ${wideSyms.length}` : ""}`);
  console.log("  الشمعات والمؤشرات الفنية لم تُمَس — تلك دورة fetch-market");
  return 0;
}

/* ---------- فحص ذاتي بلا شبكة ---------- */
function selfCheck() {
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n} — ${e.message}`); fail++; } };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

  console.log("\n▶ فحص ذاتي (بلا شبكة)\n");

  t("recompute يعيد حساب القطاعات من التغيّر الجديد", () => {
    const rows = [
      { s: "A", ar: "أ", sec: "تقنية", chg: 2, p: 10 },
      { s: "B", ar: "ب", sec: "تقنية", chg: 4, p: 20 },
      { s: "C", ar: "ج", sec: "مالي",  chg: -1, p: 30 }
    ];
    const m = recompute(rows, { breadth: { up: 9 }, marketScore: 42 });
    eq(m.sectors[0], { sec: "تقنية", n: 2, avg: 3 }, "متوسط التقنية");
    eq(m.sectors[1].avg, -1, "المالي");
    eq(m.gainers[0].s, "B", "الأعلى");
    eq(m.losers[0].s, "C", "الأدنى");
    // الاتساع والنتيجة من الشمعات لا من السعر، فيجب أن يمرّا كما هما
    eq(m.breadth, { up: 9 }, "الاتساع محفوظ");
    eq(m.marketScore, 42, "النتيجة محفوظة");
  });

  t("recompute يتجاهل الصفوف بلا تغيّر", () => {
    const m = recompute([{ s: "A", sec: "x", chg: null, p: 1 }, { s: "B", sec: "x", chg: 5, p: 2 }], {});
    eq(m.sectors[0], { sec: "x", n: 1, avg: 5 }, "واحد فقط");
  });

  t("recompute يستبعد الكريبتو من إحصاء السوق الأمريكي", () => {
    const m = recompute([
      { s: "AAPL", sec: "تقنية", chg: 1, p: 100 },
      { s: "BTC-USD", sec: "كريبتو", mkt: "crypto", chg: 40, p: 90000 }
    ], {});
    eq(m.sectors.map(x => x.sec), ["تقنية"], "قطاع واحد");
    eq(m.gainers.map(x => x.s), ["AAPL"], "بيتكوين لا يتصدّر الرابحين");
  });

  t("refreshIndices يستعمل الصندوق البديل للنسبة ويُبقي المستوى", () => {
    const prev = [{ s: "^GSPC", ar: "إس آند بي", p: 7000, chg: 0.5, proxy: "SPY" }];
    const out = refreshIndices(prev, { SPY: { sess: "REGULAR", regularChangePct: 1.25 } });
    eq(out[0].chg, 1.25, "النسبة من الصندوق");
    eq(out[0].p, 7000, "المستوى لم يُستبدل بسعر الصندوق");
  });

  t("refreshIndices يُبقي القديم حين لا يصل شيء", () => {
    const prev = [{ s: "^VIX", p: 15.5, chg: -2 }];
    eq(refreshIndices(prev, {}), prev, "بلا تغيير");
  });

  t("refreshIndices يجد البديل من الإعدادات لا من الملف المحفوظ", () => {
    // market.json لا يحفظ proxy إلا حين استُعمل، فبدونه كانت المؤشرات تتجمّد
    const prev = [{ s: "^DJI", ar: "داو", p: 53000, chg: 0.4 }];
    const out = refreshIndices(prev, { DIA: { sess: "REGULAR", regularChangePct: -0.9 } },
                               [{ s: "^DJI", proxy: "DIA" }]);
    eq(out[0].chg, -0.9, "تحدّثت النسبة");
    eq(out[0].p, 53000, "المستوى كما هو");
  });

  t("`chgOf` يتبع الجلسة: الممتدة تقيس عن الإغلاق السابق لا عن تغيّر أمس", () => {
    eq(chgOf({ sess: "PRE",     extChangePct: -1.02, regularChangePct: 1.97 }), -1.02, "قبل الافتتاح");
    eq(chgOf({ sess: "AFTER",   extChangePct:  0.43, regularChangePct: 1.97 }),  0.43, "بعد الإغلاق");
    eq(chgOf({ sess: "REGULAR", extChangePct: null,  regularChangePct: 1.97 }),  1.97, "الجلسة");
    /* والحالة التي كانت تُنتج الرقم الكاذب: جلسةٌ ممتدة بلا تغيّر ممتد.
       «لا نعرف» لا تُستبدل بتغيّر أمس — ذاك رقمٌ صحيح يصف لحظةً أخرى. */
    eq(chgOf({ sess: "PRE", extChangePct: null, regularChangePct: 1.97 }), null, "ممتد بلا رقم = —");
  });

  t("المؤشّرات تتبع الجلسة كما تتبعها الأسهم", () => {
    const prev = [{ s: "^GSPC", ar: "إس آند بي", p: 7000, chg: 0.5, proxy: "SPY" }];
    const out = refreshIndices(prev, { SPY: { sess: "PRE", extChangePct: -0.8, regularChangePct: 1.2 } });
    eq(out[0].chg, -0.8, "نسبة ما قبل الافتتاح");
  });

  t("statusNow يتجاهل فترات يوم مضى", () => {
    const day = 86400000;
    const now = Date.UTC(2026, 8, 4, 16, 0);            // جمعة 12 ظهراً بنيويورك
    const old = { regular: { start: now - day - 3600e3, end: now - day + 3600e3 } };
    eq(statusNow(old, now).state, "REGULAR", "رجع للتقدير فوجد السوق مفتوحاً");
    const today = { regular: { start: now - 3600e3, end: now + 3600e3 } };
    eq(statusNow(today, now).state, "REGULAR", "الفترات الحالية تُستعمل كما هي");
  });

  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
  return fail ? 1 : 0;
}

if (args.includes("--check")) process.exit(selfCheck());
else main().then(c => process.exit(c)).catch(e => { console.error(`\n✗ ${e.message}`); process.exit(1); });
