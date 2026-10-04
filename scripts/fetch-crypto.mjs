#!/usr/bin/env node
/* =====================================================================
   دفتر الكريبتو — الجلب والتحليل. Binance Spot وحده، 24/7.

   لماذا ملفٌّ مستقلّ لا `fetch-market` بوسائط: `fetch-market` مبنيٌّ حول
   جلسة نيويورك (ياهو، الجلسة الممتدة، Stooq، `tradingOnly`، صلاحيةٌ
   يومية تتبع الجرس، مؤشّرات بديلة، طبقة واسعة) — وكلُّ ذلك لا معنى له في
   سوقٍ لا يُغلق. وتفريعُه في كل موضعٍ يجعل مسار الأسهم يمرّ بأسئلةٍ عن
   الكريبتو في كل سطر. أمّا **الرياضيات فمشتركة لا منسوخة**: `analyze`
   و`closedBars` و`overallScoreOf` و`bandStable` هي نفسها التي تحسب الأسهم.

   ثلاث قواعد:
   ١) **الكون كلُّ ما يُتداول فعلاً** (Scan All): كلُّ زوج USDT حالتُه
      `TRADING`، ناقصاً المستقرّة والرافعة والمرمَّزة (أسهم وسلع) والملفوفة
      المكرّرة والنقدية الورقية، وما دون عتبة السيولة. ويُبنى **مرّةً في
      اليوم** عند منتصف ليل UTC — كونٌ يتبدّل داخل اليوم يُدخل رمزاً في
      القائمة ويُخرجه بلا شمعة.
   ٢) **شموعٌ مغلقة وحدها**: كلُّ مؤشّر على `closedBars`، والشمعة الجارية
      لا تدخل أيَّ رقم. والسعر اللحظي يُكتب في `p` للعرض وحده.
   ٣) **الجلب بقدر ما أُغلق**: كلُّ فريمٍ يُطلب حين تُغلق شمعةٌ منه فقط،
      وبعدد ما أُغلق منذ آخر جلب — لا ألف شمعة كل خمس دقائق.

   الفريمات:
     الفرص        5m · 15m · 1h · 4h   (`tfScore` والنتيجة والتوافق)
     توجّه السوق  1h · 4h · 1d         (البيتكوين مرجعاً — `market.json.regime`)
     واليومي يُحفظ للمستويات (البيفوت والدعوم) وتوجّه السوق، ولا يدخل
     نتيجة الفرصة.

   يُشغَّل:  node scripts/fetch-crypto.mjs --out data/crypto   (عبر run.mjs crypto)
            node scripts/fetch-crypto.mjs --check
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fetchCandles, fetchTickers, listUsdtPairs, listTaggedProducts,
         listTradingUsdt, bnStats } from "./lib/binance.mjs";
import { CRYPTO_STATUS } from "./lib/session.mjs";
import { rp, r2 } from "./lib/round.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { analyze, closedBars, AN_WIN } = require("../stocks/indicators.js");
const { overallScoreOf, bandStable } = require("../stocks/score.js");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
/* إعادةُ فحص المستقرّة على **كون اليوم كما هو** — لا إعادة بنائه: البناء
   الكامل يعيد عتبة السيولة بأحجام الساعة فيُدخل ويُخرج عملاتٍ أخرى داخل اليوم.
   لتطبيق تعديلٍ في مرشّح المستقرّة فوراً؛ والبناء اليومي يطبّقه عند منتصف الليل. */
const REPEG = args.includes("--repeg-universe");
const oi = args.indexOf("--out");
const OUT = oi >= 0 ? path.resolve(args[oi + 1]) : path.join(ROOT, "data", "crypto");

/* ---------- الفريمات والأوزان ----------
   أوزانُ الفرص هي أوزانُ الأسهم مُزاحةً درجةً إلى الأسفل (الأسهم ‎15د‎
   ‎0.5‎ · ساعة ‎1‎ · 4س ‎1.5‎ · يومي ‎2‎): النسبةُ بين الفريمات نفسُها،
   والأعلى أثقل. لا رقمٌ جديد يُخترع. */
export const OPP_TFS = ["5m", "15m", "1h", "4h"];
export const OPP_W = { "5m": 0.5, "15m": 1, "1h": 1.5, "4h": 2 };
export const REGIME_TFS = ["1h", "4h", "1d"];
export const REGIME_W = { "1h": 1, "4h": 1.5, "1d": 2 };      // TF_WEIGHT نفسها
const FRAMES = ["5m", "15m", "1h", "4h", "1d"];
const BAR = { "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
const KEEP = 300;                  // EMA200 + نافذة التحليل (259) بهامش
/* ‎15د‎ أطول: المحرّك V3 يقرأ عبورَ قمة/قاع الأسبوع السابق على شموع الأسبوع الجاري
   كلّها (حتى 7 × 96 = 672 شمعة) — 300 كانت تنتهي منتصف الأسبوع. */
const KEEP_TF = { "15m": 700 };
const keepOf = (tf) => KEEP_TF[tf] || KEEP;
/* الفريم «الأمّ» لحقول الصفّ (rsi · atr · e200 · div …): في الأسهم اليومي،
   وفي الكريبتو أعلى فريمات الفرص — 4س. */
const PRIMARY = "4h";

/* ---------- الكون ----------
   عتبةُ السيولة ‎$500K‎ في ‎24‎ ساعة: قِيس 2026-09-26 (سبت) ‎405‎ أزواج
   متداولة بعد الاستبعاد، ‎273‎ فوق العتبة و‎199‎ فوق المليون. ودونها
   أزواجٌ يتحرّك سعرُها بصفقةٍ واحدة فيُنتج كلُّ مؤشّرٍ عليها ضجيجاً —
   مصيدة `ARB-USD` الموثّقة بصفتها فئةً لا حالة. */
const MIN_QV = 5e5;
const STABLE = /^(USDC|FDUSD|TUSD|BUSD|USD1|DAI|USDP|EURI|AEUR|XUSD|USDE|PYUSD|RLUSD|USDS|USDF|BFUSD|USDD|USTC|FRAX|LUSD|GUSD|SUSD|EUR|GBP|TRY|BRL|AUD|JPY|RUB|UAH|ZAR|PLN|ARS|MXN|COP|CZK|IDR|NGN|RON)$/;
/* الملفوفة: نفسُ العملة بغلافٍ آخر — عرضُها يكرّر BTC/ETH في القائمة. */
const WRAPPED = /^(WBTC|WBETH|BETH|STETH|WSTETH|CBETH|RETH|WETH|BTCB|SOLV|BNSOL)$/;
const LEVER = /(UP|DOWN|BULL|BEAR)$/;
/* **المستقرّة تُعرف بسلوكها لا باسمها.** قائمةُ `STABLE` أعلاه أسماءٌ معروفة،
   وكلُّ مستقرّةٍ تُدرج بعدها تفلت منها — كما أفلتت `U` (سعرها ‎1.0001‎) فظهرت
   في الفرص بدرجة ‎81‎ وفي ماسح خط 200. فالحكم الآن بالانحراف الأقصى لإغلاقات
   ‎30‎ يوماً مغلقاً عن وسيطها (الإغلاق لا القمّة/القاع: ذيلٌ واحد أخرج USDP
   ‎5.5%‎ بمدى القمّة والقاع).
   قِيس 2026-09-28: المستقرّة الدولارية كلُّها ‎0.04–0.51%‎ (U ‎0.07‎ · USDC
   ‎0.06‎ · BUSD ‎0.51‎)، وأهدأ ‎30‎ يوماً في نحو ثلاث سنوات لعملاتٍ حقيقية ‎1.24%‎
   (PAXG ذهب، مستبعدٌ بوسم السلع أصلاً) و‎1.53%‎ (TRX) و‎3.15–3.39%‎ للكبار.
   فالعتبة ‎1%‎ بهامشٍ ~‎2×‎ فوق أرخى مستقرّة و~‎1.5×‎ تحت أهدأ عملة.
   والعملات الورقية (EUR ‎1.84%‎) تتحرّك بسعر الصرف فتبقى على قائمة الأسماء. */
/* **والنافذة الكاملة شرط**: الفصل يصحّ على ‎30‎ يوماً وحدها. على نوافذ أقصر
   تكون العملة الحقيقية أهدأ من المستقرّة — أهدأ ‎3‎ أيام ‎0.03%‎ (TRX)، و‎7‎
   ‎0.33%‎ (SUN)، و‎14‎ ‎0.79%‎ (TRX). وقع فعلاً: HYPE بخمس شمعات منذ إدراجها
   (‎~$92‎) خرجت ‎0.75%‎ فحُكم عليها مستقرّة. فالإدراج الأقصر من ‎30‎ يوماً
   يُشترط فيه أيضاً وسيطٌ عند الدولار (‎±3%‎): مستقرّةٌ دولارية جديدة تُلتقط من
   يومها الثالث، وعملةٌ حقيقية جديدة لا يُحكم عليها بأيّامٍ هادئة. */
export const PEG_DEV = 1.0;
const PEG_FULL = 30, PEG_MIN_BARS = 3, PEG_USD = 0.03;
export function pegDev(closes) {
  const c = closes.filter(Number.isFinite);
  if (c.length < PEG_MIN_BARS) return null;                    // لا نعرف ⇒ لا حكم
  const m = [...c].sort((a, b) => a - b)[c.length >> 1];
  if (!(m > 0)) return null;
  return { dev: Math.max(...c.map(x => Math.abs(x / m - 1))) * 100, med: m, n: c.length };
}
export function isPegged(closes) {
  const p = pegDev(closes);
  if (!p || p.dev > PEG_DEV) return false;
  return p.n >= PEG_FULL || Math.abs(p.med - 1) <= PEG_USD;
}

const CRYPTO_AR = {
  BTC: "بيتكوين", ETH: "إيثيريوم", XRP: "ريبل", BNB: "بينانس كوين",
  SOL: "سولانا", DOGE: "دوجكوين", ADA: "كاردانو", TRX: "ترون",
  AVAX: "أفالانش", LINK: "تشين لينك", DOT: "بولكادوت", LTC: "لايتكوين",
  BCH: "بيتكوين كاش", XLM: "ستيلر", UNI: "يونيسواب", ATOM: "كوزموس",
  ETC: "إيثيريوم كلاسيك", HBAR: "هيدرا", NEAR: "نير", APT: "أبتوس",
  ICP: "إنترنت كمبيوتر", FIL: "فايلكوين", ARB: "أربيتروم", OP: "أوبتيميزم",
  SHIB: "شيبا إينو", POL: "بوليجون", PEPE: "بيبي", SUI: "سوي",
  TON: "تونكوين", TAO: "بيتنسور", INJ: "إنجكتف", AAVE: "آفي",
  RENDER: "رِندر", SEI: "سي", TIA: "سيليستيا", ALGO: "ألجوراند",
  VET: "في تشين", GRT: "ذا جراف", SAND: "ساندبوكس", MANA: "ديسنترالاند",
  AXS: "أكسي", THETA: "ثيتا", EOS: "إيوس", XTZ: "تيزوس", CAKE: "بان كيك",
  CRV: "كيرف", LDO: "ليدو", STX: "ستاكس", IMX: "إيموتابل", WIF: "دوجويفهات",
  BONK: "بونك", JUP: "جوبيتر", ENA: "إيثينا", ONDO: "أوندو", ZEC: "زي كاش"
};

const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
function writeJSON(rel, obj) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, p);                         // ذرّية: لا يُقرأ نصفُ ملفّ
  return fs.statSync(p).size;
}
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/* يُرشِّح أزواج Binance إلى الكون المؤهَّل. دالّةٌ خالصة كي تُفحص بلا شبكة. */
export function qualify(pairs, trading, synthetic, pegged) {
  /* قرار المالك 2026-10-03: **كلُّ** عملةٍ قابلةٍ للتداول في Binance Spot تُحلَّل —
     وكلُّ أساسٍ فيها له زوج USDT (مقيس: 503 من 503)، فزوج USDT مصدرُ السعر الوحيد
     ولا تحويل عملات. ما دون ‎MIN_QV‎ لا يُستبعد بل يُوسَم `low` فتُعرض فرصُه في تصنيفٍ
     منفصل بتحذير، ويبقى الفلتر للقائمة العادية. والمستقرّة والمشطوبة والملفوفة
     والرافعة والأسهم/السلع المرمَّزة تُستبعد كما كانت. `illiquid` = عددُ الموسومة. */
  const out = [], why = { notTrading: 0, stable: 0, pegged: 0, wrapped: 0, lever: 0, synthetic: 0, illiquid: 0, dup: 0 };
  const seen = new Set();
  for (const t of pairs) {
    const base = t.sym.replace(/USDT$/, "");
    if (!trading.has(t.sym)) { why.notTrading++; continue; }
    if (STABLE.test(base)) { why.stable++; continue; }
    if (WRAPPED.test(base)) { why.wrapped++; continue; }
    if (LEVER.test(base)) { why.lever++; continue; }
    if (synthetic && synthetic.has(t.sym)) { why.synthetic++; continue; }
    if (pegged && pegged.has(t.sym)) { why.pegged++; continue; }
    if (seen.has(t.app)) { why.dup++; continue; }              // رمزٌ واحد لكل أساس
    seen.add(t.app);
    const low = !(t.quoteVolume >= MIN_QV);
    if (low) why.illiquid++;
    out.push({ s: t.app, en: base, ar: CRYPTO_AR[base] || base, sec: "كريبتو", mkt: "crypto", qv: Math.round(t.quoteVolume || 0),
               ...(low ? { low: 1 } : {}) });
  }
  /* ترتيبٌ ثابت للكون كلّه: بالاسم لا بالحجم. ترتيبُ الصفوف يفصل التعادل في
     الترتيب النهائي، وحجمٌ لحظيّ يعيد ترتيبها داخل الشمعة. */
  out.sort((a, b) => a.s < b.s ? -1 : a.s > b.s ? 1 : 0);
  return { rows: out, why };
}

/* يوميّاً مع بناء الكون: ‎31‎ شمعة يومية لكل مرشّح (‎~270‎ طلباً بوزن ‎2‎ مرّةً في
   اليوم). فشلُ الجلب لعملةٍ = لا حكم عليها فتبقى، وفشلُ أكثر من العُشر يُسقط
   البناء فيبقى كونُ أمس — كونٌ بُني بلا فحصٍ لنصفه أسوأ من كونٍ عمره يوم. */
async function findPegged(cands) {
  const set = new Set(), list = []; let fail = 0;
  await pool(cands, 12, async (u) => {
    try {
      const { candles } = await fetchCandles(u.s, { interval: "1d", limit: 31 });
      const closes = candles.slice(0, -1).map(x => x.c);                 // الجارية لا تدخل
      if (isPegged(closes)) { const p = pegDev(closes); set.add(u.en + "USDT"); list.push({ s: u.s, dev: +p.dev.toFixed(3), n: p.n }); }
    } catch { fail++; }
  });
  if (fail > cands.length * 0.1) throw new Error(`فحص المستقرّة تعذّر على ${fail} من ${cands.length}`);
  list.sort((a, b) => a.s < b.s ? -1 : 1);
  return { set, list };
}

async function loadUniverse(now) {
  const f = path.join(OUT, "universe.json");
  const cur = readJSON(f);
  if (REPEG && cur && Array.isArray(cur.rows) && cur.rows.length) {
    const pegged = await findPegged(cur.rows);
    const rows = cur.rows.filter(r => !pegged.set.has(r.en + "USDT"));
    if (rows.length < 50 || !rows.some(r => r.s === "BTC-USD")) throw new Error("إعادة فحص المستقرّة أفرغت الكون");
    const u = { ...cur, rows, pegged: pegged.list, pegDev: PEG_DEV,
                excluded: { ...cur.excluded, pegged: (cur.excluded?.pegged || 0) + (cur.rows.length - rows.length) } };
    writeJSON("universe.json", u);
    console.log(`  ✓ إعادة فحص المستقرّة على كون ${cur.day}: ${cur.rows.length} → ${rows.length}` +
      (pegged.list.length ? ` · ${pegged.list.map(x => `${x.s} ${x.dev}%`).join(", ")}` : ""));
    return u;
  }
  if (cur && cur.day === utcDay(now) && Array.isArray(cur.rows) && cur.rows.length) return cur;
  try {
    const [pairs, trading, synthetic] = await Promise.all([
      listUsdtPairs(), listTradingUsdt(), listTaggedProducts(["bStocks", "tCommodities"])]);
    if (!synthetic) throw new Error("تعذّر وسم الأسهم/السلع المرمَّزة — لا يُبنى كونٌ قد يحويها");
    const pegged = await findPegged(qualify(pairs, trading, synthetic).rows);
    const { rows, why } = qualify(pairs, trading, synthetic, pegged.set);
    if (rows.length < 50) throw new Error(`${rows.length} عملة فقط بعد الترشيح — ردٌّ غير متوقّع`);
    if (!rows.some(r => r.s === "BTC-USD")) throw new Error("البيتكوين ليس في الكون — مرجعُ السوق غائب");
    const u = { day: utcDay(now), built: now, minQv: MIN_QV, candidates: pairs.length, excluded: why,
                pegged: pegged.list, pegDev: PEG_DEV, rows };
    writeJSON("universe.json", u);
    console.log(`  ✓ كون اليوم ${u.day}: ${rows.length} عملة من ${pairs.length} زوجاً · مستبعَد ${JSON.stringify(why)}` +
      (pegged.list.length ? ` · مستقرّة بالسلوك: ${pegged.list.map(x => `${x.s} ${x.dev}%`).join(", ")}` : ""));
    return u;
  } catch (e) {
    // فشلُ البناء لا يُسقط الدورة: كونُ أمس يبقى حتى ينجح البناء
    if (cur && cur.rows?.length) { console.warn(`  ⚠ كون اليوم لم يُبنَ (${e.message}) — يبقى كون ${cur.day}`); return cur; }
    throw e;
  }
}

/* ---------- الشمعات ---------- */
const unpack = (c) => (Array.isArray(c) && Array.isArray(c[0]))
  ? c.map(a => ({ t: a[0] * 1000, o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] })) : (c || []);
const pack = (c) => c.map(x => [Math.round(x.t / 1000), rp(x.o), rp(x.h), rp(x.l), rp(x.c),
                                 x.v == null ? null : rp(x.v)]);

/* كم شمعةً أُغلقت منذ آخر جلب؟ صفرٌ ⇒ لا طلب. */
function dueCount(stored, tf, now) {
  if (!stored || !stored.c || stored.c.length < 50) return keepOf(tf);     // تعبئةٌ أولى
  // عمقٌ مخزَّن أقصر من المطلوب (رُفع KEEP_TF) ⇒ تعبئةٌ كاملة مرّةً واحدة
  if (stored.c.length < keepOf(tf) - 5 && keepOf(tf) > KEEP) return keepOf(tf);
  const last = stored.c[stored.c.length - 1].t;
  const closedUpTo = Math.floor(now / BAR[tf]) * BAR[tf];                   // بدايةُ الجارية
  if (closedUpTo <= last) return 0;                                         // لم يُغلق جديد
  const n = Math.ceil((closedUpTo - last) / BAR[tf]) + 2;                   // + الجارية + هامش
  return n > keepOf(tf) ? keepOf(tf) : n;
}
/* دمجٌ بالختم: الشمعة التي كانت جاريةً في الجلب السابق تُستبدل بنسختها
   المغلقة. ثم القصّ إلى KEEP. */
function merge(old, fresh, tf) {
  const m = new Map(old.map(x => [x.t, x]));
  for (const x of fresh) m.set(x.t, x);
  return [...m.values()].sort((a, b) => a.t - b.t).slice(-keepOf(tf));
}

async function pool(items, n, fn) {
  let i = 0;
  const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

const slim = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) o[k] = typeof v === "number" ? rp(v) : v; return o; };

/* التحليل على المغلق وحده — `now` هي ساعة الجلب، و`closedBars` تُسقط كلَّ
   ما لم يُغلق عندها (الجارية والطبعة الجزئية). */
export function analyzeRec(rec, now, prevBand) {
  rec.an = {};
  for (const tf of FRAMES) {
    const c = rec.tf[tf]?.c;
    if (!c || !c.length) continue;
    const kk = closedBars(unpack(c), tf, now).slice(-AN_WIN);
    const a = kk.length ? analyze(kk) : null;
    if (!a) continue;
    const { series, ...rest } = a;
    rec.an[tf] = slim(rest);
    rec.an[tf].bar = Math.round(kk[kk.length - 1].t / 1000);   // ختمُ آخر شمعةٍ مغلقة دخلت
  }
  const sc = overallScoreOf(rec.an, OPP_TFS, OPP_W);
  rec.score = sc == null ? null : r2(sc);
  rec.band = bandStable(rec.score, prevBand);
  return rec;
}

/* صفُّ الملخّص — نفس شكل صفّ الأسهم كي يمرّ بنفس `scans.js` و`plan.js`. */
export function buildRow(rec, u, tick, now) {
  const P = rec.an[PRIMARY] || {};
  const c5 = rec.tf["5m"]?.c ? closedBars(unpack(rec.tf["5m"].c), "5m", now) : [];
  const conf = c5.length ? c5[c5.length - 1] : null;
  const d1c = rec.tf["1d"]?.c ? closedBars(unpack(rec.tf["1d"].c), "1d", now) : [];
  const ext = (k) => {
    if (d1c.length < 200) return null;
    let v = k === "h" ? -Infinity : Infinity;
    for (const x of d1c.slice(-365)) v = k === "h" ? Math.max(v, x.h) : Math.min(v, x.l);
    return Number.isFinite(v) ? rp(v) : null;
  };
  const h1 = rec.tf["1h"]?.c ? unpack(rec.tf["1h"].c) : [];
  return {
    s: u.s, ar: u.ar, en: u.en, sec: u.sec, mkt: "crypto",
    // للعرض وحده — لا يدخل أيَّ حساب
    p: tick ? rp(tick.price) : (conf ? conf.c : null), chg: tick ? r2(tick.chg) : null,
    spark: h1.slice(-30).map(x => rp(x.c)),
    ...(conf ? { pc: rp(conf.c), cbar: Math.round(conf.t / 1000), ctf: "5m" } : {}),
    ...(d1c.length ? { volc: rp(d1c[d1c.length - 1].v) } : {}),
    score: rec.score, ...(Number.isFinite(rec.band) ? { band: rec.band } : {}),
    atr: P.atr ?? null, rsi: P.rsi ?? null, e20: P.e20 ?? null, e50: P.e50 ?? null, e200: P.e200 ?? null,
    adx: P.adx ?? null, pdi: P.pdi ?? null, mdi: P.mdi ?? null, squeeze: P.squeeze ?? null,
    ...(P.div?.dir ? { div: P.div.dir } : {}),
    tfScore: Object.fromEntries(OPP_TFS.filter(t => rec.an[t] && Number.isFinite(rec.an[t].score))
                                        .map(t => [t, +rec.an[t].score.toFixed(1)])),
    rtf: Object.fromEntries(REGIME_TFS.filter(t => rec.an[t] && Number.isFinite(rec.an[t].score))
                                      .map(t => [t, +rec.an[t].score.toFixed(1)])),
    qv: u.qv, ...(u.low ? { low: 1 } : {}), mc: null, vol: tick ? Math.round(tick.quoteVolume) : null,
    w52h: ext("h"), w52l: ext("l"),
    stale: !!rec.stale, src: "binance"
  };
}

/* =====================================================================
   توجّه سوق الكريبتو — **البيتكوين مرجعاً** على 1h · 4h · 1d.
   `score` نتيجة البيتكوين الموزونة بأوزان الأسهم نفسها (‎1/1.5/2‎)،
   و`pct` قوّتُها بلا إشارة (‎0..100‎) — «صاعد 82%». والاتساع معلومةٌ
   بجانبه: نسبةُ العملات الصاعدة/الهابطة على كل فريم، مغلقاً فقط.
   ===================================================================== */
export function regimeOf(btcRec, rows) {
  const an = btcRec?.an || {};
  const tf = {};
  for (const t of REGIME_TFS) if (an[t] && Number.isFinite(an[t].score)) tf[t] = +an[t].score.toFixed(1);
  const sc = overallScoreOf(an, REGIME_TFS, REGIME_W);
  const breadth = {};
  for (const t of REGIME_TFS) {
    const v = rows.map(r => (r.rtf || {})[t]).filter(Number.isFinite);
    breadth[t] = { up: v.filter(x => x > 15).length, dn: v.filter(x => x < -15).length, n: v.length };
  }
  return { sym: "BTC-USD", score: sc == null ? null : r2(sc), pct: sc == null ? null : Math.round(Math.abs(sc)),
           dir: sc == null ? 0 : sc > 15 ? 1 : sc < -15 ? -1 : 0, tf, breadth,
           bar: Number.isFinite(an["1h"]?.bar) ? an["1h"].bar : null };
}

async function main() {
  const now = Date.now();
  fs.mkdirSync(path.join(OUT, "sym"), { recursive: true });
  const U = await loadUniverse(now);
  const tick = await fetchTickers({ maxAge: 0 }).catch(() => new Map());
  const tOf = (s) => tick.get(s.replace(/-USD$/, "") + "USDT");

  let reqs = 0, fails = [];
  const recs = [];
  /* المسارات (V4.2): الجلب محدودٌ بزمن الطلب لا بالحصّة — قِيس ~40 طلباً/ث بـ12 مساراً (789 طلباً في 16ث
     عند حدّ ربع الساعة). ووزنُ دورة الحدّ ≤ 1965 طلباً × 2 = ~3.9 ألف من 6000/دقيقة، فالمضاعفة لا تقترب
     من الحدّ. `CRYPTO_LANES` للقياس. */
  await pool(U.rows, Number(process.env.CRYPTO_LANES || 24), async (u) => {
    const prev = readJSON(path.join(OUT, "sym", u.s + ".json"));
    const rec = { s: u.s, ar: u.ar, en: u.en, sec: u.sec, mkt: "crypto", src: "binance", tf: {} };
    let touched = false;
    for (const tf of FRAMES) {
      const stored = prev?.tf?.[tf] ? { ...prev.tf[tf], c: unpack(prev.tf[tf].c) } : null;
      const n = dueCount(stored, tf, now);
      let c = stored?.c || [];
      if (n > 0) {
        try {
          reqs++;
          const { candles } = await fetchCandles(u.s, { interval: tf, limit: n });
          c = merge(c, candles, tf);
          touched = true;
        } catch (e) { fails.push(`${u.s}/${tf}: ${e.message}`); }
      }
      if (c.length) rec.tf[tf] = { updated: n > 0 ? now : (stored?.updated ?? now), c: pack(c) };
    }
    rec.stale = !touched;
    analyzeRec(rec, now, prev?.band);
    rec.updated = now;
    writeJSON(path.join("sym", u.s + ".json"), rec);
    recs.push(rec);
  });

  const byS = new Map(recs.map(r => [r.s, r]));
  const rows = U.rows.map(u => byS.has(u.s) ? buildRow(byS.get(u.s), u, tOf(u.s), now) : null).filter(Boolean);
  if (!rows.length) throw new Error("صفر صفّ — لا يُكتب فوق بياناتٍ سليمة");
  const regime = regimeOf(byS.get("BTC-USD"), rows);

  writeJSON("summary.json", { updated: now, count: rows.length, rows });
  writeJSON("wide.json", { updated: now, count: 0, rows: [] });
  const withChg = rows.filter(r => Number.isFinite(r.chg));
  writeJSON("market.json", {
    updated: now, status: CRYPTO_STATUS, period: null, indices: [], sectors: [], regime,
    breadth: { up: withChg.filter(r => r.chg > 0).length, down: withChg.filter(r => r.chg < 0).length,
               flat: withChg.filter(r => r.chg === 0).length, total: withChg.length },
    gainers: [...withChg].sort((a, b) => b.chg - a.chg).slice(0, 5).map(r => ({ s: r.s, ar: r.ar, chg: r.chg, p: r.p })),
    losers:  [...withChg].sort((a, b) => a.chg - b.chg).slice(0, 5).map(r => ({ s: r.s, ar: r.ar, chg: r.chg, p: r.p }))
  });
  const meta = readJSON(path.join(OUT, "meta.json"), {});
  writeJSON("meta.json", { ...meta, marketUpdated: now, quotesRun: now,
    cryptoRun: { at: new Date(now).toISOString(), universe: U.rows.length, day: U.day, rows: rows.length,
                 requests: reqs, failures: fails.length, firstFail: fails[0] || null,
                 binance: { requests: bnStats.requests, weight: bnStats.weight, failures: bnStats.failures } } });

  const four = rows.filter(r => Object.keys(r.tfScore).length === 4).length;
  console.log(`✔ الكريبتو: ${rows.length} عملة · ${four} بأربعة فريمات · ${reqs} طلب شمعات · ${fails.length} فشل` +
    ` · البيتكوين ${regime.score ?? "—"} (${regime.dir > 0 ? "صاعد" : regime.dir < 0 ? "هابط" : "محايد"})`);
  if (fails.length) console.log(`  ⚠ أول فشل: ${fails[0]}`);
}

/* ---------- الفحص الذاتي — بلا شبكة ---------- */
function selfCheck() {
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n} — ${e.message}`); fail++; } };
  const ok = (c, m) => { if (!c) throw new Error(m); };
  t("الترشيح: المستقرّة والملفوفة والرافعة والمرمَّزة والموقوفة تُستبعد، والراكدة تبقى موسومةً `low`", () => {
    const P = [["BTCUSDT", 9e8], ["USDCUSDT", 9e8], ["WBTCUSDT", 5e6], ["ETHUPUSDT", 5e6],
               ["AAPLBUSDT", 5e6], ["DEADUSDT", 9e6], ["TINYUSDT", 1e4], ["SOLUSDT", 2e8]]
      .map(([sym, qv]) => ({ sym, app: sym.replace(/USDT$/, "") + "-USD", quoteVolume: qv }));
    const trading = new Set(P.map(p => p.sym).filter(s => s !== "DEADUSDT"));
    const { rows, why } = qualify(P, trading, new Set(["AAPLBUSDT"]));
    ok(rows.map(r => r.s).join() === "BTC-USD,SOL-USD,TINY-USD", rows.map(r => r.s).join());
    ok(rows.find(r => r.s === "TINY-USD").low === 1 && !rows.find(r => r.s === "BTC-USD").low, "وسم السيولة");
    ok(why.notTrading === 1 && why.stable === 1 && why.wrapped === 1 && why.lever === 1 && why.synthetic === 1 && why.illiquid === 1,
       JSON.stringify(why));
  });
  t("المستقرّة بالسلوك: اسمٌ غير معروف مثبَّتٌ على ‎1‎ يُستبعد، وعملةٌ حقيقية هادئة تبقى", () => {
    const flat = Array.from({ length: 30 }, (_, i) => 1 + (i % 3 - 1) * 0.0005);          // U: ±0.05%
    const calm = Array.from({ length: 30 }, (_, i) => 0.33 * (1 + Math.sin(i / 5) * 0.016)); // TRX بأهدأ شهر (~1.6%)
    ok(isPegged(flat), `مثبَّتة ${pegDev(flat).dev}`);
    ok(!isPegged(calm), `عملةٌ حقيقية حُكم عليها مستقرّة ${pegDev(calm).dev}`);
    ok(pegDev([1, 1]) === null && !isPegged([1, 1]), "حُكم على شمعتين");
    // HYPE الحقيقية: خمسُ شمعات منذ إدراجها ضمن ‎0.75%‎ عند ‎$92‎ — لا تُستبعد
    ok(!isPegged([92.13, 92.42, 92.58, 91.73, 90.52]), "إدراجٌ جديد هادئ حُكم عليه مستقرّاً");
    // مستقرّةٌ دولارية جديدة تُلتقط من يومها الثالث
    ok(isPegged([1.0002, 0.9998, 1.0001]), "مستقرّة جديدة لم تُلتقط");
    // ذيلٌ واحد لا يُخرج المستقرّة: الإغلاق لا القمّة/القاع
    const P = [["BTCUSDT", 9e8], ["NEWPEGUSDT", 9e7]].map(([sym, qv]) => ({ sym, app: sym.replace(/USDT$/, "") + "-USD", quoteVolume: qv }));
    const { rows, why } = qualify(P, new Set(P.map(p => p.sym)), new Set(), new Set(["NEWPEGUSDT"]));
    ok(rows.map(r => r.s).join() === "BTC-USD" && why.pegged === 1, JSON.stringify(why));
  });
  t("الكون مرتَّبٌ بالاسم لا بالحجم — لا يعيد ترتيبَه حجمٌ لحظي", () => {
    const mk = (a, b) => qualify([{ sym: "ZZZUSDT", app: "ZZZ-USD", quoteVolume: a }, { sym: "AAAUSDT", app: "AAA-USD", quoteVolume: b }],
                                 new Set(["ZZZUSDT", "AAAUSDT"]), new Set()).rows.map(r => r.s).join();
    ok(mk(9e9, 1e6) === mk(1e6, 9e9), "الترتيب تبع الحجم");
  });
  t("الجلب بقدر ما أُغلق: لا طلب قبل إغلاق شمعة، وطلبٌ بعده", () => {
    const t0 = Date.UTC(2026, 8, 27, 10, 0, 0);
    const st = { c: Array.from({ length: 100 }, (_, i) => ({ t: t0 - (99 - i) * 3e5 })) };   // آخرها 10:00 (جارية)
    ok(dueCount(st, "5m", t0 + 200e3) === 0, "طلبٌ والشمعة لم تُغلق");
    ok(dueCount(st, "5m", t0 + 301e3) > 0, "لا طلب بعد إغلاقها");
    ok(dueCount(null, "5m", t0) === KEEP, "تعبئةٌ أولى");
  });
  t("الدمج يستبدل الجارية بنسختها المغلقة ولا يكرّر", () => {
    const m = merge([{ t: 1, c: 1 }, { t: 2, c: 2 }], [{ t: 2, c: 9 }, { t: 3, c: 3 }]);
    ok(m.map(x => x.t + ":" + x.c).join() === "1:1,2:9,3:3", m.map(x => x.t + ":" + x.c).join());
  });
  t("الشمعة الجارية لا تدخل النتيجة ولا الصفّ", () => {
    const now = Date.UTC(2026, 8, 27, 10, 2, 0);
    const mk = (tf, n, last) => { const b = BAR[tf]; const end = Math.floor(now / b) * b;
      return pack(Array.from({ length: n }, (_, i) => { const x = 100 + Math.sin(i / 7) * 5 + i * 0.05;
        return { t: end - (n - 1 - i) * b, o: x, h: x + 1, l: x - 1, c: i === n - 1 ? last : x, v: 10 }; })); };
    const a = { tf: {} }, b = { tf: {} };
    for (const tf of FRAMES) { a.tf[tf] = { c: mk(tf, 260, 100) }; b.tf[tf] = { c: mk(tf, 260, 1e6) }; }
    analyzeRec(a, now); analyzeRec(b, now);
    ok(a.score === b.score, `${a.score} ≠ ${b.score}`);
    const u = { s: "X-USD", ar: "X", en: "X", sec: "كريبتو" };
    const ra = buildRow(a, u, null, now), rb = buildRow(b, u, null, now);
    ok(ra.pc === rb.pc && ra.cbar === rb.cbar && JSON.stringify(ra.tfScore) === JSON.stringify(rb.tfScore), "الصفّ تغيّر");
    ok(Object.keys(ra.tfScore).join() === OPP_TFS.join(), "فريمات الفرص " + Object.keys(ra.tfScore).join());
  });
  t("النتيجة على فريمات الفرص وحدها — اليومي لا يدخلها", () => {
    const an = { "5m": { score: 10 }, "15m": { score: 10 }, "1h": { score: 10 }, "4h": { score: 10 } };
    ok(overallScoreOf(an, OPP_TFS, OPP_W) === overallScoreOf({ ...an, "1d": { score: -100 } }, OPP_TFS, OPP_W), "اليومي تسرّب");
  });
  t("توجّه السوق من البيتكوين على 1h/4h/1d", () => {
    const R = regimeOf({ an: { "1h": { score: 60 }, "4h": { score: 80 }, "1d": { score: 90 }, "5m": { score: -100 } } }, []);
    ok(R.dir === 1 && R.pct === Math.round((60 + 120 + 180) / 4.5), JSON.stringify(R));
  });
  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل`);
  process.exit(fail ? 1 : 0);
}

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (IS_MAIN) {
  if (CHECK) selfCheck();
  else main().catch(e => { console.error("✗ فشل الجلب:", e.message); process.exit(1); });
}
