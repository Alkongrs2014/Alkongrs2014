/* =====================================================================
   عميل Yahoo Finance — يعمل من طرف الخادم فقط (داخل GitHub Actions).
   المتصفح لا يستطيع الاتصال بـ Yahoo مباشرة (لا يرسل ترويسات CORS)،
   ولهذا نجلب هنا ونكتب ملفات JSON يقرأها المتصفح.
   ===================================================================== */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------- إحصاءات التشغيل، تُكتب في meta.json ---------- */
export const stats = { requests: 0, retries: 0, failures: 0, sources: {} };
function mark(src, ok) {
  const s = stats.sources[src] || (stats.sources[src] = { ok: 0, fail: 0 });
  ok ? s.ok++ : s.fail++;
}

/* ---------- جلب مع إعادة محاولة تصاعدية ---------- */
async function req(url, { headers = {}, timeout = 20000, tries = 3, label = "yahoo" } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i) { stats.retries++; await sleep(600 * Math.pow(2, i - 1) + Math.random() * 400); }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      stats.requests++;
      const r = await fetch(url, {
        signal: ctl.signal,
        headers: { "User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9", ...headers }
      });
      clearTimeout(timer);
      if (r.status === 429 || r.status >= 500) { lastErr = new Error(`HTTP ${r.status}`); continue; }
      if (!r.ok) { lastErr = new Error(`HTTP ${r.status}`); break; }
      mark(label, true);
      return r;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
    }
  }
  stats.failures++;
  mark(label, false);
  throw lastErr || new Error("request failed");
}

/* ---------- محدّد التزامن: لا نطرق Yahoo بـ 90 طلباً دفعة واحدة ---------- */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await sleep(200 + Math.random() * 200);   // تشتيت لتفادي الحظر
      try { out[i] = { ok: true, value: await fn(items[i], i) }; }
      catch (e) { out[i] = { ok: false, error: e.message, item: items[i] }; }
    }
  });
  await Promise.all(workers);
  return out;
}

/* ---------- دورة الكوكي + الـ crumb (يحتاجها v7/quote و quoteSummary) ---------- */
let session = null;
export async function getSession() {
  if (session) return session;
  try {
    const r1 = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } })
      .catch(() => null);
    const cookies = r1?.headers?.getSetCookie?.() || [];
    const cookie = cookies.map(c => c.split(";")[0]).join("; ");
    if (!cookie) throw new Error("no cookie from fc.yahoo.com");

    const r2 = await req("https://query2.finance.yahoo.com/v1/test/getcrumb",
      { headers: { Cookie: cookie }, tries: 2, label: "crumb" });
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.length > 32 || crumb.includes("<")) throw new Error("bad crumb");

    session = { cookie, crumb };
    console.log(`  ✓ جلسة Yahoo جاهزة (crumb: ${crumb.slice(0, 4)}…)`);
    return session;
  } catch (e) {
    console.warn(`  ⚠ تعذّر الحصول على crumb (${e.message}) — سنعتمد على chart وحده`);
    session = { cookie: null, crumb: null };
    return session;
  }
}

/* =====================================================================
   1) الشموع — v8/finance/chart  (يعمل بلا مصادقة)
   ===================================================================== */
export async function fetchChart(symbol, { range, interval, prePost = false } = {}) {
  const u = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  u.searchParams.set("range", range);
  u.searchParams.set("interval", interval);
  u.searchParams.set("includePrePost", String(prePost));
  u.searchParams.set("events", "div,split");

  const r = await req(u.toString(), { label: "chart" });
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(j?.chart?.error?.description || "empty chart result");

  const ts = res.timestamp || [];
  const q = res.indicators?.quote?.[0] || {};
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    // Yahoo يعيد null للشمعات الناقصة — نتخطاها بدل تلفيق رقم
    if ([o, h, l, c].some(v => v === null || v === undefined || !isFinite(v))) continue;
    candles.push({ t: ts[i] * 1000, o, h, l, c, v: q.volume?.[i] ?? 0 });
  }
  if (!candles.length) throw new Error("no usable candles");
  return { candles, meta: res.meta || {} };
}

/* =====================================================================
   2) دفعة الأسعار — v7/finance/quote  (كل الرموز في طلب واحد، يحتاج crumb)
   ===================================================================== */
export async function fetchQuotes(symbols) {
  const s = await getSession();
  if (!s.crumb) return null;                       // المستدعي يسقط إلى chart
  const out = {};
  // Yahoo يرفض الروابط الطويلة جداً — نقسّم إلى دفعات
  for (let i = 0; i < symbols.length; i += 40) {
    const batch = symbols.slice(i, i + 40);
    const u = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
    u.searchParams.set("symbols", batch.join(","));
    u.searchParams.set("crumb", s.crumb);
    try {
      const r = await req(u.toString(), { headers: { Cookie: s.cookie }, label: "quote" });
      const j = await r.json();
      for (const q of (j?.quoteResponse?.result || [])) out[q.symbol] = q;
    } catch (e) {
      console.warn(`  ⚠ فشلت دفعة الأسعار ${i}-${i + batch.length}: ${e.message}`);
    }
    await sleep(300);
  }
  return Object.keys(out).length ? out : null;
}

/* =====================================================================
   3) البيانات الأساسية — quoteSummary (يومياً فقط، يحتاج crumb)
   ===================================================================== */
export async function fetchSummary(symbol) {
  const s = await getSession();
  if (!s.crumb) throw new Error("no crumb");
  const u = new URL(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`);
  u.searchParams.set("modules", "summaryDetail,defaultKeyStatistics,calendarEvents,assetProfile,price,financialData");
  u.searchParams.set("crumb", s.crumb);
  const r = await req(u.toString(), { headers: { Cookie: s.cookie }, label: "summary" });
  const j = await r.json();
  const res = j?.quoteSummary?.result?.[0];
  if (!res) throw new Error("empty summary");
  return res;
}

/* =====================================================================
   4) بديل احتياطي — Stooq CSV (أسعار يومية، بلا مفتاح ولا مصادقة)
      يُستخدم فقط إذا سقط Yahoo كلياً، حتى لا ينقطع التطبيق.
   ===================================================================== */
export async function fetchStooqDaily(symbol) {
  const sym = symbol.replace(/[.^]/g, "").replace("-", "-").toLowerCase() + ".us";
  const r = await req(`https://stooq.com/q/d/l/?s=${sym}&i=d`, { label: "stooq", tries: 2 });
  const text = await r.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2 || !lines[0].toLowerCase().startsWith("date")) throw new Error("stooq: bad csv");
  const candles = [];
  for (const line of lines.slice(1)) {
    const [d, o, h, l, c, v] = line.split(",");
    const nums = [o, h, l, c].map(Number);
    if (nums.some(n => !isFinite(n))) continue;
    candles.push({ t: new Date(d + "T00:00:00Z").getTime(), o: nums[0], h: nums[1], l: nums[2], c: nums[3], v: Number(v) || 0 });
  }
  if (!candles.length) throw new Error("stooq: no rows");
  return { candles, meta: { source: "stooq" } };
}

/* ---------- مساعدات ---------- */
export const num = (v) => (typeof v === "number" && isFinite(v)) ? v
  : (v && typeof v === "object" && isFinite(v.raw)) ? v.raw : null;

export function tradingPeriodFromMeta(meta) {
  const cp = meta?.currentTradingPeriod;
  if (!cp) return null;
  const pick = (p) => p ? { start: p.start * 1000, end: p.end * 1000 } : null;
  return { pre: pick(cp.pre), regular: pick(cp.regular), post: pick(cp.post), tz: meta.exchangeTimezoneName || "America/New_York" };
}
