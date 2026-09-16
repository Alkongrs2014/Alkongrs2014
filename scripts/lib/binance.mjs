/* =====================================================================
   Binance — مصدر الكريبتو الوحيد.

   لماذا Binance بدل ياهو للكريبتو؟ ثلاثة أسباب مقيسة في 2026-09-15:

   1) **طلبٌ واحد يجيب كل الأسعار**: ‎/api/v3/ticker/24hr‎ بلا وسائط ردّ
      ‎3702‎ زوجاً في ‎1.6‎ ثانية. ياهو يحتاج دفعةً لكل أربعين رمزاً
      وcrumb وكوكي.
   2) **بلا مفتاح وبلا حصّة عملية**: الحدّ ‎6000‎ وحدة وزن في الدقيقة،
      ووزنُ طلب الشمعات ‎2‎ — أي ثلاثة آلاف طلب شمعات في الدقيقة. جلبُ
      ‎744‎ زوجاً لا يقترب من الحدّ.
   3) **يزيل مصيدتين موثّقتين من مصدرهما**: `ARB-USD` عند ياهو أصلٌ ميت
      مجمَّد على ‎0.000629‎ وليس أربيتروم، و«أسعار ما قبل الإدراج» التي
      أعطت UNI عائداً ‎1,573,986%‎ في يوم. المنصّة تعطي زوج التداول
      الفعلي فلا يوجد أيٌّ منهما.

   والرموز تبقى بصيغة التطبيق (`BTC-USD`) لا بصيغة المنصّة (`BTCUSDT`):
   السجلّ الحيّ والأرشيف وملفّات التسلسل كلّها مفهرسة بها، وتغييرُ الصيغة
   ييتّم تاريخها كلَّه.
   ===================================================================== */

const BASE = "https://data-api.binance.vision";

export const bnStats = { requests: 0, retries: 0, failures: 0, weight: 0 };

/* رموزٌ كان ياهو يفكّ بها الالتباس بلاحقةٍ رقمية. تُبقى هنا كي لا ينكسر
   أيُّ سجلٍّ قديم يشير إليها قبل أن يُعاد بناء الكون. */
const ALIAS = { "UNI7083": "UNI", "ARB11841": "ARB" };

export function toBinance(sym) {
  const base = String(sym).replace(/-USD$/, "");
  return (ALIAS[base] || base) + "USDT";
}

export function toApp(binSym) {
  return String(binSym).replace(/USDT$/, "") + "-USD";
}

async function req(pathQS, { weight = 1, tries = 3, timeout = 20000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i) { bnStats.retries++; await new Promise(r => setTimeout(r, 400 * i)); }
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      bnStats.requests++; bnStats.weight += weight;
      const r = await fetch(BASE + pathQS, {
        signal: ctl.signal,
        headers: { "Accept": "application/json", "User-Agent": "webtrade/1.0" }
      });
      clearTimeout(timer);
      /* ‎418‎/‎429‎ من Binance حظرٌ بمهلةٍ معلنة في `Retry-After`. الفشل
         السريع هو القاعدة الموثّقة في هذا المشروع، لكن المهلة هنا
         **مُعلَنة** لا مخمَّنة، فاحترامُها مرّةً واحدة أرخص من إسقاط
         الدورة كلّها. */
      if (r.status === 429 || r.status === 418) {
        const wait = Math.min(Number(r.headers.get("retry-after") || 2), 10);
        await new Promise(x => setTimeout(x, wait * 1000));
        throw new Error("HTTP " + r.status + " (حظر مؤقّت)");
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  bnStats.failures++;
  throw lastErr;
}

/* =====================================================================
   1) كل الأسعار في طلب واحد.
   ===================================================================== */
let tickerCache = null, tickerAt = 0;

export async function fetchTickers({ maxAge = 30000 } = {}) {
  if (tickerCache && Date.now() - tickerAt < maxAge) return tickerCache;
  const j = await req("/api/v3/ticker/24hr", { weight: 80 });
  const out = new Map();
  for (const t of j) {
    if (!t.symbol.endsWith("USDT")) continue;
    const price = Number(t.lastPrice), chg = Number(t.priceChangePercent);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.set(t.symbol, {
      sym: t.symbol,
      app: toApp(t.symbol),
      price,
      chg: Number.isFinite(chg) ? chg : null,
      quoteVolume: Number(t.quoteVolume) || 0,   // بالدولار — مقياس السيولة
      count: Number(t.count) || 0                // عدد الصفقات في 24 ساعة
    });
  }
  tickerCache = out; tickerAt = Date.now();
  return out;
}

/* كائنُ السعر بشكل ياهو كي لا يحتاج المستهلك أي تفريع.
   `regularMarketPrice` و`regularMarketChangePercent` هما الحقلان
   الوحيدان اللذان يقرؤهما `fetch-quotes`. */
export async function fetchQuotes(symbols) {
  const tick = await fetchTickers();
  const out = {};
  for (const s of symbols) {
    const t = tick.get(toBinance(s));
    if (!t) continue;
    out[s] = {
      symbol: s,
      regularMarketPrice: t.price,
      regularMarketChangePercent: t.chg,
      regularMarketVolume: t.quoteVolume
    };
  }
  return Object.keys(out).length ? out : null;
}

/* =====================================================================
   2) الشمعات — نفس شكل `fetchChart` في yahoo.mjs بالضبط.

   الحدّ الأقصى ‎1000‎ شمعة للطلب. الساعة تُطلب كاملةً (‎1000‎ = ‎41‎ يوماً)
   لأن 4h تُشتقّ منها وEMA200 تحتاج ‎200‎ شمعة رباعية = ‎800‎ ساعية.
   ===================================================================== */
const LIMIT = { "5m": 1000, "15m": 1000, "1h": 1000, "4h": 500, "1d": 400 };

export async function fetchCandles(sym, { interval = "1d" } = {}) {
  const b = toBinance(sym);
  const lim = LIMIT[interval] || 500;
  const j = await req(
    "/api/v3/klines?symbol=" + encodeURIComponent(b) + "&interval=" + interval + "&limit=" + lim,
    { weight: 2 }
  );
  const candles = [];
  for (const k of j) {
    const o = +k[1], h = +k[2], l = +k[3], c = +k[4], v = +k[5];
    // شمعةٌ ناقصة تُتخطّى ولا تُلفَّق — نفس قاعدة yahoo.mjs
    if (![o, h, l, c].every(Number.isFinite)) continue;
    candles.push({ t: k[0], o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  if (!candles.length) throw new Error("لا شمعات صالحة لـ " + b);
  return { candles, meta: {} };
}

/* =====================================================================
   3) كون الأزواج — لبناء الكون في `build-universe`.

   الترتيب بحجم التداول بالدولار (`quoteVolume`) لا بعدد العملات: زوجٌ
   حجمُه مليار وحدة من عملةٍ سعرها جزءٌ من سنت ليس أكثر سيولةً من زوجٍ
   حجمُه ألف بيتكوين.
   ===================================================================== */
/* =====================================================================
   السهم الأمريكي المرمَّز عند Binance ليس عملةً — ويُستبعَد **بالهوية
   السعرية** لا بنمطٍ نصّي.

   القياس الذي أوجب هذا: `AAPLBUSDT` و`SPYBUSDT` و`NVDABUSDT` وأمثالُها
   أصولٌ حيّة تُتداول فعلاً، فتسرّب منها ‎34‎ رمزاً إلى كون الكريبتو —
   أي أن `AAPL` كانت في التطبيق مرّتين: سهماً حقيقياً و«عملة» اسمها
   `AAPLB-USD`. وهي أسوأ من رمزٍ زائد: سعرُها يتتبّع السهم ضمن ‎0.1%‎
   فتبدو سليمة تماماً، بينما **حجمُها ‎0.0006%–0.023%‎ من حجم السهم
   الحقيقي** (MSFT: ‎207‎ سهماً مقابل ‎35.4‎ مليون) وشمعاتُها ‎24/7‎ لا
   على شبكة جلسة نيويورك. فكلُّ بوابة حجمٍ عليها ضجيج، وكلُّ حسابِ
   جلسةٍ (VWAP، نطاق الافتتاح، البيفوت) يُبنى على شبكةٍ خاطئة.

   **ولا يصلح النمط النصّي** `/B$/`: `BNB` و`SHIB` و`ARB` و`TRB` و`CKB`
   و`DGB` عملاتٌ حقيقية تنتهي بالحرف نفسه — وحذفُها يمحو بايننس كوين
   وشيبا إينو وأربيتروم. والمميّز الصحيح أن المرمَّز **يتتبّع سهمه**:
   الفجوة المقيسة بين أقصى مرمَّز (‎0.43%‎) وأدنى كريبتو (‎99.91%‎)
   واسعةٌ بحيث لا التباس. وهذا هو مبدأ «الدمج بالهوية لا بالاسم» نفسه
   الذي حلّ `GOOGL`/`GOOG` بـ`cik.json`.

   و`stockPx` اختيارية: بلا أسعار أسهم لا يُستبعد شيء **ويُعلَن ذلك** —
   مرشِّحٌ صامتٌ عاجز أسوأ من غيابه. */
/* =====================================================================
   قائمة الأسهم المرمَّزة **من تصنيف Binance الرسمي** — لا استدلالاً.

   واجهة Binance تصنّف منتجاتها بوسوم، ومنها `bStocks`: ‎77‎ منتجاً
   أسماؤها عند Binance نفسها «NVIDIA (bStocks)» و«Apple (bStocks)»،
   أصلُها `NVDAB` لا `NVDA` ومقابلُها USDT لا USD.

   وهذا هو الجواب الموثَّق عن «هل يعطي Binance أسهماً أمريكية؟»: القسم
   موجود، ومحتواه رموزٌ مرمَّزة لا أسهماً. القياس على AAPL/NVDA/MSFT/SPY:
   السعر يطابق ضمن ‎0.01–0.12%‎، والحجم بالدولار **‎0.0006%–0.025%‎** من
   حجم السهم الحقيقي (MSFT: ‎0.1‎ مليون مقابل ‎17.4‎ مليار)، والشموع
   اليومية فيها **‎8‎ عطلات أسبوع من ‎30‎** — أي سوقٌ يعمل ‎24/7‎ على
   شبكةٍ غير شبكة جلسة نيويورك.

   النقطة خارج `api.binance.com` فقد تتغيّر أو تُحجب — ولذلك تُلتقط
   أخطاؤها ويبقى الاستدلال السعري بديلاً، ويُعلَن أيُّهما عمل. */
const PRODUCTS_URL =
  "https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products";
let bStocksCache = null, bStocksAt = 0;

export async function listTaggedStocks({ maxAge = 6 * 3600e3 } = {}) {
  if (bStocksCache && Date.now() - bStocksAt < maxAge) return bStocksCache;
  try {
    const r = await fetch(PRODUCTS_URL, {
      headers: {
        // نفس درس BLS وSEC: لا يُحجب الآليّ بل الطلبُ الذي لا يشبه متصفّحاً
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        "Accept": "application/json"
      }
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const out = new Set();
    for (const x of (j.data || []))
      if ((x.tags || []).includes("bStocks") && x.s) out.add(x.s);
    // صفرٌ يعني تغيّر شكل الردّ لا اختفاء القسم — لا يُقبل بصمت
    if (!out.size) throw new Error("صفر منتجاً موسوماً bStocks");
    bStocksCache = out; bStocksAt = Date.now();
    return out;
  } catch (e) {
    return null;                      // البديل السعري يتكفّل، ويُعلن المستدعي
  }
}

const TOKENIZED_TOL = 0.03;
export function tokenizedStocks(pairs, stockPx) {
  const out = new Set();
  if (!stockPx || !stockPx.size) return out;
  for (const t of pairs) {
    const base = t.sym.replace(/USDT$/, "");
    if (!/B$/.test(base)) continue;
    const px = stockPx.get(base.slice(0, -1));
    if (!(px > 0) || !(t.price > 0)) continue;
    if (Math.abs(t.price - px) / px < TOKENIZED_TOL) out.add(t.sym);
  }
  return out;
}

export async function listUsdtPairs({ minQuoteVolume = 0 } = {}) {
  const tick = await fetchTickers({ maxAge: 0 });
  /* العملات المستقرّة تُستبعد: `USDCUSDT` تصدّرت قائمة الحجم وسعرها ثابت
     عند الواحد، فكلُّ مؤشّرٍ فنيّ عليها ضجيجٌ حول خطٍّ مستقيم. */
  const STABLE = /^(USDC|FDUSD|TUSD|BUSD|USD1|DAI|USDP|EURI|AEUR|XUSD|USDE|PYUSD|RLUSD|USDS|USDF|FDUSDT)$/;
  const all = [...tick.values()]
    .filter(t => t.quoteVolume >= minQuoteVolume)
    .filter(t => !STABLE.test(t.sym.replace(/USDT$/, "")))
    /* الرافعة المرمَّزة (`BTCUP`/`ETHDOWN`) مشتقّاتٌ تتآكل يومياً ولا
       تتبع الأصل — عرضُها كعملةٍ يضلّل. */
    .filter(t => !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.sym))
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
  /* الأسهم المرمَّزة تُرشَّح عند **بناء الكون** لا هنا: المرشِّح يحتاج
     الوسم الرسمي (نداءُ شبكةٍ ثانٍ) أو أسعار الأسهم، وكلاهما يخصّ
     المستدعي. وهذه الدالّة تبقى قراءةً خالصة لسوق Binance. */
  return all;
}
