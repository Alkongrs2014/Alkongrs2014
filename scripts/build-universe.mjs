#!/usr/bin/env node
/* =====================================================================
   بناء كون الرموز — أداة صيانة تُشغَّل يدوياً، لا مهمة دورية.

   تكتب `stocks/symbols.json`: تُبقي الـ90 المرشّحة الأساسية كما هي
   (بأسمائها العربية المكتوبة يدوياً)، وتضيف بقية مؤشر S&P 500 كطبقة
   `wide`، وقائمة عملات رقمية كطبقة `crypto`.

   لماذا أداة لا قائمة مكتوبة؟ كتابة 400 رمز من الذاكرة تُدخل رموزاً
   شُطبت أو غيّرت اسمها بلا أن يظهر الخطأ إلا كرمز فارغ في الواجهة.
   هنا المصدر خارجي، ثم **كل رمز يُتحقق منه فعلياً عند ياهو** قبل أن
   يدخل الملف — ما لا يردّ سعراً لا يُكتب.

   التشغيل:
     node scripts/build-universe.mjs            # يجلب القائمة ويكتب
     node scripts/build-universe.mjs --dry      # يعرض الحصيلة بلا كتابة
     node scripts/build-universe.mjs --check    # فحص ذاتي بلا شبكة
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchQuotes } from "./lib/yahoo.mjs";
import { listUsdtPairs, tokenizedStocks, listTaggedStocks } from "./lib/binance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CFG_PATH = path.join(ROOT, "stocks/symbols.json");
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const DRY = args.includes("--dry");

const SP500_CSV =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";

/* قطاعات GICS بالإنجليزية → نفس المسمّيات العربية المستعملة في الملف
   الحالي. أي قطاع لا يُطابق يوقف البناء بدل أن يمرّ كقطاع فارغ. */
const SECTORS = {
  "Information Technology": "تقنية",
  "Communication Services": "اتصالات",
  "Consumer Discretionary": "استهلاكي كمالي",
  "Consumer Staples":       "استهلاكي أساسي",
  "Financials":             "مالي",
  "Health Care":            "رعاية صحية",
  "Energy":                 "طاقة",
  "Industrials":            "صناعي",
  "Materials":              "مواد",
  "Utilities":              "مرافق",
  "Real Estate":            "عقارات"
};

/* الأسماء العربية مكتوبةٌ يدوياً لأن الترجمة الآلية تشوّه أسماء العملات.
   ما ليس هنا يُعرض باسمه الإنجليزي — قاعدةٌ موثّقة: الإنجليزي الصحيح
   أصدق من عربيٍّ مفبرك. المفتاح هو الرمز الأساسي عند Binance. */
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
  VET: "في تشين", FTM: "فانتوم", GRT: "ذا جراف", SAND: "ساندبوكس",
  MANA: "ديسنترالاند", AXS: "أكسي", THETA: "ثيتا", EOS: "إيوس",
  XTZ: "تيزوس", CAKE: "بان كيك", CRV: "كيرف", LDO: "ليدو",
  STX: "ستاكس", IMX: "إيموتابل", WIF: "دوجويفهات", BONK: "بونك",
  JUP: "جوبيتر", ENA: "إيثينا", ONDO: "أوندو", ZEC: "زي كاش"
};

/* عتبة السيولة: حجم تداولٍ بالدولار في 24 ساعة. ما فوقها يدخل الطبقة
   المرصودة بالفريمات الأربعة، وما دونها يدخل الواسعة بشمعةٍ يومية —
   نفس معمارية الأسهم بالضبط.

   ولماذا عتبةٌ أصلاً: مصيدة `ARB-USD` الموثّقة (أصلٌ مجمَّد يُعرض سعراً
   ويُحسب له اتجاهٌ ويُرشَّح للفرص) ليست حالةً فردية بل **فئة**. من
   ‎744‎ زوجاً عند Binance، ‎74‎ فقط تتجاوز خمسة ملايين دولار يومياً
   والباقي يُنتج إشاراتٍ من ضجيج. فالعتبة تمنع تلويث قوائم الفرص،
   والطبقة الواسعة تُبقي الجميع في البحث. */
const CRYPTO_CORE_VOL = 5e6;

/* رموز ياهو تستعمل الشرطة حيث يستعمل المؤشر النقطة (BRK.B ← BRK-B) */
const toYahoo = (t) => t.trim().replace(/\./g, "-");

/* مُحلّل CSV صغير يحترم الحقول المقتبسة — عناوين المقار فيها فواصل */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1);
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
  const core = new Set(cfg.symbols.map(s => s.s));
  console.log(`▶ الكون الحالي: ${cfg.symbols.length} مرشّحاً أساسياً`);

  console.log("  جلب قائمة S&P 500 …");
  const res = await fetch(SP500_CSV);
  if (!res.ok) throw new Error(`تعذّر جلب القائمة: ${res.status}`);
  const rows = parseCSV(await res.text());
  const head = rows.shift();
  const iSym = head.indexOf("Symbol"), iName = head.indexOf("Security"), iSec = head.indexOf("GICS Sector");
  if (iSym < 0 || iName < 0 || iSec < 0) throw new Error("تغيّرت أعمدة الملف المصدر");

  const candidates = [];
  for (const r of rows) {
    const s = toYahoo(r[iSym]);
    if (core.has(s)) continue;                  // الأساسية لها أسماؤها العربية
    const sec = SECTORS[r[iSec].trim()];
    if (!sec) throw new Error(`قطاع غير معروف: "${r[iSec]}" (${s})`);
    candidates.push({ s, en: r[iName].trim(), sec });
  }
  console.log(`  مرشّحو الطبقة الواسعة: ${candidates.length}`);

  // التحقق: دفعة أسعار واحدة لكل 40 رمزاً — أرخص بكثير من طلب شارت لكل رمز
  console.log(`  التحقق من ${candidates.length} سهماً عند ياهو …`);
  const quotes = await fetchQuotes(candidates.map(c => c.s));
  if (!quotes) throw new Error("لم تصل أي أسعار — لن نكتب فوق ملف سليم");

  /* =====================================================================
     الحياة = سعرٌ **وحجم**، لا سعرٌ وحده.

     أربعة رموز كريبتو مرّت من هذا التحقق سنةً كاملة وهي ميتة عند ياهو.
     كلُّها كانت تعطي `regularMarketPrice` رقماً صالحاً — فالسعر وحده لا
     يثبت أن الأصل يُتداول، والرمز الميت أسوأ من الغائب لأنه يُعرض سعراً
     ويُحسب له اتجاهٌ ويُرشَّح للفرص.

     والكريبتو لم يعد يمرّ من هنا أصلاً: مصدرُه Binance، وهو يعطي زوج
     التداول الفعلي فلا يوجد فيه أصلٌ ميت يحمل اختصاراً مشهوراً. */
  const px  = (s) => Number.isFinite(quotes[s]?.regularMarketPrice) && quotes[s].regularMarketPrice > 0;
  const vol = (s) => Number.isFinite(quotes[s]?.regularMarketVolume) && quotes[s].regularMarketVolume > 0;
  const alive = (s) => px(s) && vol(s);
  const wide = candidates.filter(c => alive(c.s));
  const dropped = candidates.filter(c => !alive(c.s))
    .map(c => c.s + (px(c.s) ? " (بلا حجم)" : " (بلا سعر)"));

  if (dropped.length) console.log(`  ⚠ سقط ${dropped.length} رمزاً بلا سعر: ${dropped.join(", ")}`);
  // نجاح جزئي كبير يعني خللاً في الشبكة لا رموزاً ميتة — لا نكتب حينها
  if (wide.length < candidates.length * 0.8)
    throw new Error(`نجح ${wide.length} من ${candidates.length} فقط — يبدو خللاً في الشبكة لا في الرموز`);

  /* =====================================================================
     ترقية الأسهم الأعلى سيولةً إلى الطبقة المرصودة.

     قياس 2026-09-15: **‎164‎ من ‎311‎ صفّاً في الماسح** كانت محسوبةً على
     شمعةٍ يومية عمرها ~‎18‎ ساعة — وهي **كل** الطبقة الواسعة، لأن رموزها
     لا تأخذ إلا اليوميّ. فالماسح كان يخلط قراءةً عمرها ربع ساعة بقراءةٍ
     عمرها يوم في قائمةٍ واحدة، وهو ما وصفه المستخدمون بـ«بيانات غير
     صحيحة».

     والترقية **متدرّجة بقياس** لا دفعةً واحدة: كل رمزٍ مرقّى يكلّف أربعة
     فريمات في كل دورة سوق، و‎1500‎ طلبٍ في الدورة هو الحدّ الموثّق الذي
     يستدعي ‎429‎ حتى من شبكة منزلية. يُضبط `PROMOTE` ويُقاس
     `meta.json.marketRun` بعد كل خطوة.

     والمعيار حجمُ التداول **بالدولار** (سعر × كمية) لا الكمية: سهمٌ
     بعشرة دولارات وحجمٍ مليون ليس أكثر سيولةً من سهمٍ بألفٍ وحجمِ مئة ألف. */
  const PROMOTE = Number(process.env.PROMOTE || 60);
  const dollarVol = (s) => (quotes[s]?.regularMarketPrice || 0) * (quotes[s]?.regularMarketVolume || 0);
  const promoted = wide.slice()
    .sort((a, b) => dollarVol(b.s) - dollarVol(a.s))
    .slice(0, PROMOTE)
    /* الاسم العربي للأساسية وحدها — الترجمة الآلية تشوّه أسماء الشركات،
       والإنجليزي الصحيح أصدق من عربيٍّ مفبرك. `nm(r)` في الواجهة تسقط إليه. */
    .map(c => ({ s: c.s, ar: c.en, en: c.en, sec: c.sec }));
  const promotedSet = new Set(promoted.map(c => c.s));
  /* الرمز المرقّى **يخرج من الواسعة**: بقاؤه فيها يجعله يُجلب مرّتين
     ويظهر صفّين في `allRows()` — واحدٌ بأربعة فريمات وآخر بفريم واحد. */
  const wideStocks = wide.filter(c => !promotedSet.has(c.s));
  if (PROMOTE) console.log(`  رُقّي ${promoted.length} سهماً إلى المرصودة (الأعلى سيولةً بالدولار)`);

  /* ---------- الكريبتو من Binance بطبقتين ---------- */
  console.log("  جلب كون Binance …");
  /* أسعار الأسهم الحقيقية — مفتاحُ استبعاد الأسهم المرمَّزة عند
     Binance (`AAPLB` · `NVDAB` · `SPYB` …). المقارنة بالسعر لأن النمط
     النصّي يمحو `BNB` و`SHIB` و`ARB` معها. */
  const stockPx = new Map();
  for (const c of [...cfg.symbols, ...wide]) {
    const px = quotes[c.s]?.regularMarketPrice;
    if (px > 0) stockPx.set(c.s, px);
  }
  /* نداءٌ واحد ثم ترشيحٌ محلّي: `listUsdtPairs({ stockPx })` مرّةً ثانية
     يعيد ضرب الشبكة بلا داعٍ (`fetchTickers` بـ`maxAge: 0`). */
  const pairsAll = await listUsdtPairs();
  /* الوسم الرسمي `bStocks` أولاً — قائمةٌ من Binance نفسها لا استدلال.
     والاستدلال السعري بديلٌ حين تتعذّر النقطة، ويُقال أيُّهما عمل. */
  const tagged = await listTaggedStocks();
  const tokSet = tagged
    ? new Set(pairsAll.filter(t => tagged.has(t.sym)).map(t => t.sym))
    : tokenizedStocks(pairsAll, stockPx);
  const tokSrc = tagged ? `وسم bStocks الرسمي (${tagged.size} منتجاً)` : "الاستدلال السعري";
  const pairs = pairsAll.filter(t => !tokSet.has(t.sym));
  if (pairs.length < 100) throw new Error(`${pairs.length} زوجاً فقط — يبدو خللاً في الشبكة`);
  /* يُقال بعددِه لا صامتاً: مرشِّحٌ بلا أسعارٍ يمرّ صفراً، وصفرٌ صامت
     يُقرأ «لا تسرّب» بينما هو «لم يُفحص». */
  console.log((tagged || stockPx.size)
    ? `  استُبعد ${tokSet.size} سهماً مرمَّزاً — المصدر: ${tokSrc}`
    : `  ⚠ لا وسم رسمي ولا أسعار أسهم — لم يُفحص تسرّب الأسهم المرمَّزة`);

  // `mkt` صريح لا استنتاج من اسم القطاع: الواجهة والخادم يفرزان عليه،
  // ومقارنة نصّ عربي لتقرير سوق الرمز تنكسر بأول تغيير في التسمية.
  const asCoin = (t) => {
    const base = t.sym.replace(/USDT$/, "");
    return { s: t.app, ar: CRYPTO_AR[base] || base, en: base, sec: "كريبتو", mkt: "crypto" };
  };
  const crypto     = pairs.filter(t => t.quoteVolume >= CRYPTO_CORE_VOL).map(asCoin);
  const cryptoWide = pairs.filter(t => t.quoteVolume <  CRYPTO_CORE_VOL).map(asCoin);
  console.log(`  الكريبتو: ${crypto.length} مرصودة (فوق ${(CRYPTO_CORE_VOL / 1e6).toFixed(0)} مليون$) · ${cryptoWide.length} واسعة`);

  /* الكريبتو الواسع يدخل نفس طبقة `wide`: `fetch-market` يدوّرها بسقف
     `WIDE_PER_RUN` ويجلب لها اليوميَّ وحده. طبقةٌ ثالثة تعني مسار جلبٍ
     ثالثاً يتباعد عن الاثنين بأول تعديل. */
  const wideAll = [...wideStocks, ...cryptoWide];

  /* الأساسية = المرشّحون المكتوبون يدوياً + المرقّون. و`top` يشمل الجميع:
     آليةُ `ranking.json` تختار الأفضل داخل الأساسية، وترقيةُ رمزٍ ثم
     استبعادُه بـ`top` تُخرجه من الطبقتين معاً فيختفي كلياً. */
  const symbols = [...cfg.symbols, ...promoted];
  const out = {
    note: cfg.note,
    top: symbols.length,
    symbols,
    wide: wideAll,
    crypto,
    indices: cfg.indices
  };
  console.log(`\n  الأساسية ${out.symbols.length} · الواسعة ${wideAll.length} (منها ${cryptoWide.length} كريبتو) · الكريبتو المرصود ${crypto.length}`);
  console.log(`  الإجمالي: ${out.symbols.length + wideAll.length + crypto.length} رمزاً`);

  if (DRY) { console.log("\n(--dry: لم يُكتب شيء)"); return; }
  fs.writeFileSync(CFG_PATH, JSON.stringify(out));
  console.log(`\n✔ كُتب ${CFG_PATH}`);
}

/* ---------- فحص ذاتي بلا شبكة ---------- */
function selfCheck() {
  console.log("▶ فحص ذاتي (بلا شبكة)\n");
  let pass = 0, fail = 0;
  const t = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name} — ${e.message}`); fail++; } };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

  t("المرشِّح يستبعد السهم المرمَّز ويُبقي العملة المنتهية بالحرف نفسه", () => {
    /* `BNB` و`SHIB` و`ARB` و`DGB` عملاتٌ حقيقية تنتهي بـ`B` — ونمطٌ
       نصّي يمحوها مع `AAPLB`. المميّز هو تتبّع السعر. */
    const pairs = [
      { sym: "AAPLBUSDT", price: 332.50 }, { sym: "NVDABUSDT", price: 214.70 },
      { sym: "SPYBUSDT",  price: 754.94 }, { sym: "BNBUSDT",   price: 1000 },
      { sym: "SHIBUSDT",  price: 0.0000051 }, { sym: "DGBUSDT", price: 0.00412 },
      { sym: "ARBUSDT",   price: 0.1353 }, { sym: "BTCUSDT",   price: 95000 }
    ];
    const px = new Map([["AAPL", 332.18], ["NVDA", 214.74], ["SPY", 754.20],
                        ["BN", 50], ["SHI", 6], ["DG", 123.01], ["AR", 30]]);
    const got = [...tokenizedStocks(pairs, px)].sort();
    eq(got, ["AAPLBUSDT", "NVDABUSDT", "SPYBUSDT"], "المرمَّزة وحدها");
    // وبلا أسعار أسهم لا يُستبعد شيء — والمرشِّح يُعلن عجزَه ولا يمرّ صامتاً
    eq(tokenizedStocks(pairs, null).size, 0, "بلا أسعار");
    eq(tokenizedStocks(pairs, new Map()).size, 0, "خريطة فارغة");
  });

  t("toYahoo يحوّل النقطة إلى شرطة", () => {
    eq([toYahoo("BRK.B"), toYahoo("BF.B"), toYahoo("AAPL")], ["BRK-B", "BF-B", "AAPL"], "toYahoo");
  });

  t("parseCSV يحترم الفواصل داخل الاقتباس", () => {
    const r = parseCSV('Symbol,Security,Loc\nMMM,3M,"Saint Paul, Minnesota"\n');
    eq(r.length, 2, "صفّان");
    eq(r[1], ["MMM", "3M", "Saint Paul, Minnesota"], "الحقل المقتبس حقل واحد");
  });

  t("parseCSV يحترم الاقتباس المهروب داخل الحقل", () => {
    eq(parseCSV('a,b\n1,"say ""hi"""\n')[1], ["1", 'say "hi"'], "اقتباس مهروب");
  });

  t("خريطة القطاعات تغطي قطاعات GICS الأحد عشر", () => {
    eq(Object.keys(SECTORS).length, 11, "عدد القطاعات");
    for (const v of Object.values(SECTORS)) if (!v) throw new Error("قطاع بلا اسم عربي");
  });

  /* الخاصيّة لا القائمة: لم تعد هناك قائمةٌ يدوية تُفحص، بل خريطةُ أسماءٍ
     وعتبةُ سيولة. والمفحوص أن الخريطة سليمة وأن ما في الملفّ متّسق. */
  t("خريطة الأسماء العربية سليمة", () => {
    const seen = new Set();
    for (const [base, ar] of Object.entries(CRYPTO_AR)) {
      if (!/^[A-Z0-9]+$/.test(base)) throw new Error(`${base} ليس رمزاً أساسياً`);
      if (!ar || /[A-Za-z]/.test(ar)) throw new Error(`${base} اسمه ليس عربياً: ${ar}`);
      if (seen.has(base)) throw new Error(`${base} مكرّر`);
      seen.add(base);
    }
    if (!(CRYPTO_CORE_VOL > 0)) throw new Error("عتبة السيولة غير موجبة");
  });

  t("الكريبتو في الملف الحالي بصيغة التطبيق وله mkt", () => {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
    const all = [...(cfg.crypto || []), ...(cfg.wide || []).filter(w => w.mkt === "crypto")];
    if (!all.length) throw new Error("لا كريبتو في الملف");
    for (const c of all) {
      if (!c.s.endsWith("-USD")) throw new Error(`${c.s} ليس بصيغة التطبيق`);
      if (c.mkt !== "crypto") throw new Error(`${c.s} بلا mkt`);
      if (!c.ar || !c.en) throw new Error(`${c.s} بلا اسم`);
    }
    /* الرمز في الطبقتين يُجلب مرّتين ويظهر مرّتين في `allRows()` —
       نفس علّة «الرمز المرقّى يبقى في wide.json» الموثّقة. */
    const core = new Set((cfg.crypto || []).map(c => c.s));
    for (const w of cfg.wide || []) if (core.has(w.s)) throw new Error(`${w.s} مرصود وواسع معاً`);
  });

  /* الخاصيّة لا الرقم. `!== 90` كان يُسقط الفحص عند إضافة أيّ مرشّح،
     وهذا يدفع إلى **تخفيف الفحص بدل قراءته** — أسوأ ما يفعله اختبار.
     نفس علاج `SCANS.length !== 8` سابقاً. */
  t("الملف الحالي يقرأ ومرشّحوه أكثر من المطلوب بلا تكرار", () => {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
    if (!Array.isArray(cfg.symbols) || cfg.symbols.length < cfg.top)
      throw new Error(`${cfg.symbols?.length} مرشّحاً و${cfg.top} مطلوب`);
    const seen = new Set();
    for (const x of cfg.symbols) {
      if (!x.s || !x.ar || !x.en || !x.sec) throw new Error(`${x.s || "?"} حقلٌ ناقص`);
      if (seen.has(x.s)) throw new Error(`${x.s} مكرّر`);
      seen.add(x.s);
    }
    // رمزٌ في الطبقتين يُجلب مرّتين ويُحسب مرّتين في الاتساع
    for (const w of cfg.wide || []) if (seen.has(w.s)) throw new Error(`${w.s} في الأساسية والواسعة معاً`);
  });

  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل`);
  process.exit(fail ? 1 : 0);
}

if (CHECK) selfCheck();
else main().catch(e => { console.error("✗ فشل البناء:", e.message); process.exit(1); });
