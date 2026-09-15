/* =====================================================================
   Alpaca — المزوّد الوحيد عندنا الذي يعطي **حجماً حقيقياً في الجلسة
   الممتدة**.

   وهذا هو سببُ وجوده لا غير. ياهو يعطي أسعار ما قبل الافتتاح كاملةً
   (قِيس: ‎43‎ شمعة ‎5د‎ من ‎04:00‎ إلى ‎07:30‎ لـ MSFT)، لكنه يعطي
   حجمها **صفراً حرفياً** — على كل رمزٍ وكل يوم (قِيس على MSFT وTSLA
   وAAPL وSPY عبر خمسة أيام: ‎0‎ في كل شمعةٍ ممتدة، و‎9–60‎ مليوناً في
   الرسمية). وبلا حجم لا VWAP ولا حجمٌ نسبيّ ولا «حجم غير معتاد» —
   وهي أنفع ما يُقاس قبل الافتتاح.

   ---------------------------------------------------------------------
   **تغذية IEX حصّةٌ من السوق لا كلُّه (‎~2%‎).**

   وهذا يُقال ولا يُخفى: «‎128‎ ألف سهم قبل الافتتاح» رقمٌ خاطئ إن
   عُرض مجمَّعَ السوق. لكنه **صالحٌ تماماً للنسبة**: حجمُ اليوم من IEX
   مقسوماً على وسيط حجم نفس دقيقة الجلسة من IEX — البسط والمقام من
   نفس المصدر، فحصّةُ المنصّة تُختصر. ولذلك `caps.volumeScope = "iex"`
   يُقرأ في الواجهة فتكتب مصدر الرقم بجانبه.

   ---------------------------------------------------------------------
   ولماذا طبقةُ مزوّدٍ أصلاً ولم نكتب نداءاته مباشرةً: لأن الماسح
   والاستراتيجيات يجب ألّا تعرف اسم المزوّد. من يسأل «هل أشغّل بوابة
   الحجم؟» يسأل `caps.extendedVolume` لا `src === "alpaca"` — وإلا
   تناثر اسمُ المزوّد في عشرين شرطاً، وصار استبدالُه إعادةَ كتابة.
   ===================================================================== */

const DATA = "https://data.alpaca.markets";
const TRADE = "https://api.alpaca.markets";

export const alStats = { requests: 0, retries: 0, failures: 0, bars: 0 };

export const id = "alpaca";

/* الخطة المجانية: تغذية IEX. من يملك اشتراكاً يضبط `ALPACA_FEED=sip`
   فيتغيّر المدى والحجم بلا سطرٍ واحد في الماسح. */
const FEED = process.env.ALPACA_FEED || "iex";

/* =====================================================================
   تغذيتان لا واحدة — وهذا **قياسٌ غيّر التصميم**.

   الفرض الأول كان «Alpaca تعطي حجم الجلسة الممتدة». والقياس فصّله:

   · `iex` لحظيّةٌ بلا تأخير، لكن حصّتها من التداول ‎~3%‎ وتغطيتُها قبل
     الافتتاح شبه معدومة: من ‎149‎ رمزاً أمريكياً في كوننا، **رمزٌ
     واحد** كان له طبعةٌ واحدة على IEX في أربع ساعاتٍ من ما قبل
     الافتتاح. وMSFT بلا أيّ طبعة، فلقطتُه تعيد آخر صفقةٍ **من أمس**.
     أي أنها تعيد نفس المصيدة التي نصلحها: رقمٌ يبدو حيّاً وهو قديم.

   · `sip` هي الشريط المجمَّع كاملاً، **ومتاحةٌ على الخطة المجانية
     بتأخير ‎15‎ دقيقة بالضبط** (قِيس: آخر شمعةٍ متاحة ‎08:00‎ والساعة
     ‎08:15‎، على أربعة رموز). وحجمُها حقيقي: MSFT ما قبل الافتتاح
     ‎1,696,732‎ سهماً يوم ‎09/14‎ مقابل ‎54,841‎ على IEX (‎3.2%‎)،
     وNVDA اليوم ‎3,041,321‎ سهماً حيث يعطي ياهو **صفراً**.

   فالتقسيم يتبع السؤال لا المزوّد:
     السعرُ اللحظي  → ياهو (مجمَّع، بلا تأخير، كلُّ الرموز)
     الحجمُ الممتد  → Alpaca SIP (مجمَّع، متأخّر ‎15‎ دقيقة)
     التاريخُ للـReplay → Alpaca SIP (كامل الدقّة، بلا تأخير على الماضي)

   و**التأخير يُعلَن ولا يُخفى** (`extendedVolumeDelayMs`): إشارةٌ
   مبنيّة على حجمٍ عمرُه ربع ساعة يجب أن تقول ذلك، وإلا قرأها المستخدم
   لحظيةً وبنى عليها دخولاً.
   ===================================================================== */
const HIST_FEED = process.env.ALPACA_HIST_FEED || "sip";
const SIP_DELAY_MS = 15 * 60e3;

export const caps = {
  id,
  markets: ["equity"],
  extendedHours: true,
  extendedVolume: true,
  extendedVolumeDelayMs: HIST_FEED === "sip" ? SIP_DELAY_MS : 0,
  realtimePrice: false,           // ← IEX وحدها لحظية، وتغطيتُها لا تكفي
  historyFidelity: HIST_FEED,
  volumeScope: HIST_FEED === "sip" ? "consolidated" : "iex",
  websocket: true,
  batch: true,
  batchSize: 200,
  timeframes: ["1m", "5m", "15m", "30m", "1h", "4h", "1d"],
  vwap: true,
  tradeCount: true,
  corporateActions: true,
  /* ‎200‎ طلباً في الدقيقة على الخطة المجانية. وهو سقفٌ مريح لأن الطلب
     الواحد يحمل ‎200‎ رمز: الكونُ كلُّه في ستّة طلبات. */
  rateLimit: { perMinute: 200 }
};

export function available() {
  return !!(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY);
}

function headers() {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID || "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY || "",
    "Accept": "application/json"
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function req(url, { tries = 3, timeout = 20000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i) { alStats.retries++; await sleep(700 * i + Math.random() * 400); }
    const ctl = AbortSignal.timeout(timeout);
    try {
      alStats.requests++;
      const r = await fetch(url, { headers: headers(), signal: ctl });
      /* ‎429‎ هنا عابرٌ لا حظرُ عنوان — بعكس ياهو. فإعادةُ المحاولة
         مجديةٌ، والقاعدة الموثّقة «الفشل السريع أفضل» كانت عن الحظر
         الممتد لا عن سقفٍ معلَن يتجدّد كل دقيقة. */
      if (r.status === 429 || r.status >= 500) { lastErr = new Error(`HTTP ${r.status}`); continue; }
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status} ${body.slice(0, 160)}`);
      }
      return await r.json();
    } catch (e) { lastErr = e; if (e.message.startsWith("HTTP 4") && !/429/.test(e.message)) break; }
  }
  alStats.failures++;
  throw lastErr || new Error("alpaca: request failed");
}

/* فريماتنا بصيغة Alpaca. ‎4h‎ مدعومٌ أصلاً عندهم — لكنّا **لا نستعمله**:
   شمعةُ ‎4h‎ عندنا تُشتقّ من الساعة بمفتاحٍ زمنيّ ثابت (`aggregate`)،
   ومزجُ مصدرين لنفس الفريم يجعل شبكتَه تتغيّر بتغيّر المصدر — وهي
   بالضبط العلّة التي كلّفت تشخيصاً («تزحف شبكتُها ساعةً كل يوم»). */
const TF = { "1m": "1Min", "5m": "5Min", "15m": "15Min", "30m": "30Min", "1h": "1Hour", "1d": "1Day" };

const iso = (t) => new Date(t).toISOString();

/* =====================================================================
   صيغة الرمز — `BRK-B` عندنا و`BRK.B` عندهم.

   ورمزٌ واحد بصيغةٍ خاطئة **يُسقط الدفعة كلَّها**: `HTTP 400 invalid
   symbol: BRK-B` أعاد صفر شمعة لخمسين رمزاً سليماً معه. فالترجمة هنا
   — في المحوّل — لا في المستدعي: الرموز تبقى بصيغة التطبيق في كل
   الملفّات والسجلّات، تماماً كما يفعل محوّل Binance مع `BTC-USD`.
   ===================================================================== */
const toAlpaca = (s) => String(s).replace(/-([A-Z])$/, ".$1");
const toApp = (s) => String(s).replace(/\.([A-Z])$/, "-$1");

/* =====================================================================
   الشمعات — دفعةً لعدّة رموز في الطلب الواحد.

   `getCandles` للرمز الواحد تنادي `getCandlesBatch` ولا تكرّر المنطق:
   نسختان تعنيان أن الرمز المفرد قد يأتي بوسمِ جلسةٍ أو تقريبٍ مختلف
   عن نفسه داخل الدفعة.
   ===================================================================== */
export async function getCandlesBatch(symbols, tf, opt = {}) {
  const timeframe = TF[tf];
  if (!timeframe) throw new Error(`فريم غير مدعوم: ${tf}`);
  const out = {};
  const size = Math.min(opt.batchSize || caps.batchSize, caps.batchSize);

  /* التغذية تتبع الغرض: التاريخ والحجم من `sip` (مجمَّع، متأخّر ‎15‎
     دقيقة)، واللحظيّ من `iex`. و`opt.feed` تتجاوزهما عند الحاجة. */
  const feed = opt.feed || (opt.realtime ? FEED : HIST_FEED);
  /* `sip` ترفض أيّ طلبٍ نهايتُه داخل نافذة التأخير بـ
     ‎403 subscription does not permit querying recent SIP data‎ —
     **ولو كانت على الحدّ بثانية**. وحذفُ `end` أصلاً لا يُرفض: الخادم
     يقتطع بنفسه عند حدّه (قِيس: طلبٌ بلا `end` أعاد شمعاتٍ حتى
     ‎08:00‎ والساعة ‎08:15‎). فلا نرسلها إلا حين تكون أقدم من الحدّ
     بهامشٍ واضح — وإلا تركنا الاقتطاع له. */
  const cap = feed === "sip" ? Date.now() - SIP_DELAY_MS - 60e3 : null;
  const end = (opt.to && (!cap || opt.to <= cap)) ? opt.to : null;

  for (let i = 0; i < symbols.length; i += size) {
    const batch = symbols.slice(i, i + size);
    let pageToken = null, guard = 0;
    do {
      const u = new URL(`${DATA}/v2/stocks/bars`);
      u.searchParams.set("symbols", batch.map(toAlpaca).join(","));
      u.searchParams.set("timeframe", timeframe);
      u.searchParams.set("feed", feed);
      u.searchParams.set("limit", String(opt.limit || 10000));
      u.searchParams.set("adjustment", opt.adjustment || "raw");
      if (opt.from) u.searchParams.set("start", iso(opt.from));
      if (end) u.searchParams.set("end", iso(end));
      if (pageToken) u.searchParams.set("page_token", pageToken);
      let j;
      try {
        j = await req(u.toString());
      } catch (e) {
        /* **رمزٌ واحد لا يُسقط دفعةً.** `invalid symbol: BRK-B` أعاد
           صفر شمعة لخمسين رمزاً سليماً معه. نستبعد المذكور في الرسالة
           ونعيد المحاولة؛ وإن لم يُسمَّ رمزٌ فالخطأ عامّ ويُرمى.
           وهذا ليس ابتلاعاً للخطأ: المستبعَد يُسجَّل ويُعاد للمستدعي. */
        const bad = /invalid symbol:\s*([A-Z0-9.\-]+)/i.exec(e.message)?.[1];
        if (!bad) throw e;
        (out.__skipped ||= []).push(toApp(bad));
        const keep = batch.filter(x => toAlpaca(x) !== bad);
        if (!keep.length) break;
        batch.length = 0; batch.push(...keep);
        continue;
      }
      for (const [rawSym, bars] of Object.entries(j.bars || {})) {
        const sym = toApp(rawSym);
        const arr = (out[sym] ||= []);
        for (const b of bars) {
          arr.push({
            t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c,
            v: b.v, vw: b.vw ?? null, n: b.n ?? null
          });
        }
        alStats.bars += bars.length;
      }
      pageToken = j.next_page_token || null;
    } while (pageToken && ++guard < 50);
  }
  /* الترتيب الزمني شرطٌ ضمنيّ في كل ما بعدُ (المؤشّرات والتجميع
     والمحاكاة). وصفحاتُ Alpaca مرتّبة، لكن دمجَ دفعاتٍ متعدّدة لا
     يضمن ذلك — فالفرزُ صريح. */
  for (const [k, arr] of Object.entries(out)) if (k !== "__skipped") arr.sort((a, b) => a.t - b.t);
  return out;
}

export async function getCandles(symbol, tf, opt = {}) {
  const m = await getCandlesBatch([symbol], tf, opt);
  const candles = m[symbol] || [];
  if (!candles.length) throw new Error("alpaca: لا شمعات");
  return { candles, meta: { source: id, feed: FEED } };
}

export const getHistoricalCandles = getCandles;

/* =====================================================================
   الأسعار — `snapshots` لا `quotes`.

   اللقطة تحمل آخر صفقةٍ وآخر عرضٍ وطلب وشمعةَ الدقيقة وشمعةَ اليوم
   وشمعةَ الأمس في نداءٍ واحد. وآخرُ **صفقة** هي ما نريد قبل الافتتاح:
   `dailyBar` لا يبدأ قبل ‎09:30‎، فقراءتُه في الجلسة الممتدة تعيد
   إغلاق أمس — وهي العلّة نفسها التي جمّدت التطبيق مع ياهو.
   ===================================================================== */
export async function getQuotes(symbols) {
  const out = {};
  const size = caps.batchSize;
  for (let i = 0; i < symbols.length; i += size) {
    const batch = symbols.slice(i, i + size);
    const u = new URL(`${DATA}/v2/stocks/snapshots`);
    u.searchParams.set("symbols", batch.map(toAlpaca).join(","));
    u.searchParams.set("feed", FEED);          // اللحظيّ = IEX
    const j = await req(u.toString());
    const snaps = j.snapshots || j;
    for (const [rawSym, s] of Object.entries(snaps || {})) {
      const sym = toApp(rawSym);
      if (!s) continue;
      const last = s.latestTrade || null;
      const prev = s.prevDailyBar || null;
      const day = s.dailyBar || null;
      const px = last?.p ?? day?.c ?? null;
      const prevClose = prev?.c ?? null;
      const at = last?.t ? Date.parse(last.t) : null;
      out[sym] = {
        symbol: sym,
        price: Number.isFinite(px) ? px : null,
        at,
        /* عمرُ آخر طبعة. تغطية IEX قبل الافتتاح شبه معدومة، فقد يكون
           هذا «السعر اللحظي» من أمس — والمستدعي يجب أن يرى العمر
           ليقرّر، لا أن يأخذ الرقم على أنه الآن. */
        ageMs: at ? Date.now() - at : null,
        prevClose,
        changePct: (Number.isFinite(px) && prevClose > 0) ? (px / prevClose - 1) * 100 : null,
        bid: s.latestQuote?.bp ?? null,
        ask: s.latestQuote?.ap ?? null,
        dayVolume: day?.v ?? null,
        minuteBar: s.minuteBar ? {
          t: Date.parse(s.minuteBar.t), o: s.minuteBar.o, h: s.minuteBar.h,
          l: s.minuteBar.l, c: s.minuteBar.c, v: s.minuteBar.v
        } : null
      };
    }
  }
  return Object.keys(out).length ? out : null;
}

export async function getQuote(symbol) {
  const m = await getQuotes([symbol]);
  return m ? m[symbol] : null;
}

export async function getTrades(symbol, opt = {}) {
  const u = new URL(`${DATA}/v2/stocks/${encodeURIComponent(toAlpaca(symbol))}/trades`);
  u.searchParams.set("feed", FEED);
  u.searchParams.set("limit", String(opt.limit || 1000));
  if (opt.from) u.searchParams.set("start", iso(opt.from));
  if (opt.to) u.searchParams.set("end", iso(opt.to));
  const j = await req(u.toString());
  return (j.trades || []).map(x => ({ t: Date.parse(x.t), p: x.p, s: x.s, x: x.x }));
}

/* =====================================================================
   الكون — كلُّ ما يُتداول فعلاً.

   `status=active` و`tradable` شرطان مختلفان: الأول يقول إن الرمز قائم،
   والثاني إن Alpaca تقبل أمراً عليه. ورمزٌ نشطٌ غير قابلٍ للتداول يظهر
   في القوائم ولا يمكن تنفيذُ شيءٍ عليه — وعرضُه فرصةً كذبٌ صامت.
   ===================================================================== */
export async function listAssets(opt = {}) {
  const u = new URL(`${TRADE}/v2/assets`);
  u.searchParams.set("status", "active");
  u.searchParams.set("asset_class", opt.assetClass || "us_equity");
  const j = await req(u.toString(), { timeout: 60000 });
  return (Array.isArray(j) ? j : [])
    .filter(a => a.tradable !== false)
    .map(a => ({
      s: a.symbol, name: a.name, exch: a.exchange,
      cls: a.class, shortable: !!a.shortable,
      fractionable: !!a.fractionable,
      /* الصناديق تُميَّز كي لا تُحسب لها أساسيات: صندوقٌ بلا ROE ولا
         نمو إيراد، وإعطاؤه صفراً يفسد وسيط قطاعه — درسُ البنوك نفسه. */
      etf: /ETF|FUND|TRUST|INDEX/i.test(a.name || "")
    }));
}

export async function getMarketStatus() {
  const j = await req(`${TRADE}/v2/clock`);
  return {
    at: Date.parse(j.timestamp),
    open: !!j.is_open,
    nextOpen: j.next_open ? Date.parse(j.next_open) : null,
    nextClose: j.next_close ? Date.parse(j.next_close) : null,
    source: id
  };
}

/* تقويمُ البورصة الرسمي — يصحّح جدول العطلات في `stocks/session.js`
   بدل أن يبقى يدوياً إلى الأبد. يُقرأ يومياً لا في كل دورة. */
export async function getCalendar(from, to) {
  const u = new URL(`${TRADE}/v2/calendar`);
  u.searchParams.set("start", new Date(from).toISOString().slice(0, 10));
  u.searchParams.set("end", new Date(to).toISOString().slice(0, 10));
  const j = await req(u.toString());
  return (j || []).map(d => ({ date: d.date, open: d.open, close: d.close }));
}

/* =====================================================================
   البثّ — `WebSocket` العالمية في Node لا مكتبة.

   وسقفُ الرموز على الخطة المجانية **يُقاس عند الاشتراك ولا يُفترض**:
   الوثائق تتغيّر، والافتراضُ الخاطئ يجعل الاشتراك يُرفض كلّه فيسقط
   البثّ صامتاً. نشترك ونقرأ ردّ الخادم ونُبلغ المستدعي بما قُبل فعلاً.
   ===================================================================== */
export function subscribe(symbols, handlers = {}) {
  const url = `wss://stream.data.alpaca.markets/v2/${FEED}`;
  let ws = null, closed = false, tries = 0;
  let accepted = { trades: [], bars: [] };

  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        action: "auth",
        key: process.env.ALPACA_KEY_ID,
        secret: process.env.ALPACA_SECRET_KEY
      }));
    });
    ws.addEventListener("message", (ev) => {
      let msgs;
      try { msgs = JSON.parse(ev.data); } catch { return; }
      for (const m of (Array.isArray(msgs) ? msgs : [msgs])) {
        if (m.T === "success" && m.msg === "authenticated") {
          tries = 0;
          ws.send(JSON.stringify({ action: "subscribe", trades: symbols, bars: symbols }));
          handlers.onOpen?.();
        } else if (m.T === "subscription") {
          /* ما قُبل فعلاً — قد يكون أقلّ مما طُلب */
          accepted = { trades: m.trades || [], bars: m.bars || [] };
          handlers.onSubscribed?.(accepted);
        } else if (m.T === "error") {
          handlers.onError?.(new Error(`${m.code}: ${m.msg}`));
        } else if (m.T === "t") {
          handlers.onTrade?.({ s: m.S, t: Date.parse(m.t), p: m.p, v: m.s });
        } else if (m.T === "b") {
          handlers.onBar?.({ s: m.S, t: Date.parse(m.t), o: m.o, h: m.h, l: m.l, c: m.c, v: m.v, vw: m.vw, n: m.n });
        }
      }
    });
    ws.addEventListener("close", () => {
      if (closed) return;
      /* تراجعٌ تصاعديّ بسقف: إعادةُ الاتصال الفورية في حلقةٍ ضيّقة
         تُحرق الحصّة وتُغلق الحساب مؤقتاً */
      const wait = Math.min(30000, 1000 * Math.pow(2, Math.min(tries++, 5)));
      handlers.onClose?.(wait);
      setTimeout(open, wait);
    });
    ws.addEventListener("error", (e) => handlers.onError?.(e.error || new Error("ws error")));
  };
  open();
  return {
    close() { closed = true; try { ws?.close(); } catch {} },
    get accepted() { return accepted; }
  };
}

export { toAlpaca, toApp, HIST_FEED, SIP_DELAY_MS };

export const subscribeTrades = (syms, cb) => subscribe(syms, { onTrade: cb });
export const subscribeBars = (syms, cb) => subscribe(syms, { onBar: cb });
