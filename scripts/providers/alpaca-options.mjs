/* =====================================================================
   Alpaca — عقود الخيارات (OPRA) ولقطات الأسهم الخام لقسم العقود.

   ملفٌّ مستقلّ عن `alpaca.mjs` عمداً: ذاك داخلٌ في بصمة `pipelineVersion`
   (مدخلات الفرص)، وتعديلُه يعيد بناء لقطاتٍ لا علاقة لها بالعقود.

   ما قِيس قبل الكتابة (2026-10-03، الحساب الورقي + Algo Trader Plus):
   · `/v1beta1/options/snapshots/{u}?feed=opra` ⇒ 200: عرض/طلب وآخر صفقة وشمعة
     الدقيقة واليوم، و**greeks وimpliedVolatility** للعقود المتداولة قرب السعر
     (العقد العميق بلا تداول يأتي بعرضٍ وطلبٍ فقط — فغيابُ الإغريقيات يُقال).
   · `/v2/options/contracts` ⇒ **Open Interest** (يوم أمس) وسعر الإغلاق —
     على **paper-api** وحده بمفاتيح الحساب الورقي (live ⇒ 401). قراءةٌ لا أوامر.
   · `/v1beta1/options/bars` ⇒ تاريخ العقد (يومي/دقيقة).
   كلُّ طلبٍ بمهلة (lint: لا `fetch` بلا مهلة في شيفرةٍ مجدولة).
   ===================================================================== */
import "../lib/env.mjs";

const DATA = "https://data.alpaca.markets";
const PAPER = "https://paper-api.alpaca.markets";
export const optStats = { requests: 0, retries: 0, failures: 0, endpoints: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hdr = () => ({ "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID || "", "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY || "",
  Accept: "application/json" });
export const available = () => !!(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY);
const toAlpaca = (s) => String(s).replace(/-([A-Z])$/, ".$1");
const toApp = (s) => String(s).replace(/\.([A-Z])$/, "-$1");

async function req(url, { tries = 3, timeout = 20000 } = {}) {
  const ep = new URL(url).pathname.replace(/\/snapshots\/[^/]+$/, "/snapshots/:u");
  optStats.endpoints[ep] = (optStats.endpoints[ep] || 0) + 1;
  let last;
  for (let i = 0; i < tries; i++) {
    if (i) { optStats.retries++; await sleep(600 * i); }
    try {
      optStats.requests++;
      const r = await fetch(url, { headers: hdr(), signal: AbortSignal.timeout(timeout) });
      if (r.status === 429 || r.status >= 500) { last = new Error(`HTTP ${r.status}`); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 160)}`);
      return await r.json();
    } catch (e) { last = e; if (/^HTTP 4/.test(e.message) && !/429/.test(e.message)) break; }
  }
  optStats.failures++;
  throw last || new Error("alpaca-options: failed");
}

/* رمز OCC ⇒ مكوّناته: NVDA261009C00235000 */
export function parseOcc(sym) {
  const m = /^([A-Z.]+?)(\d{6})([CP])(\d{8})$/.exec(sym);
  if (!m) return null;
  const [, root, ymd, cp, k] = m;
  return { root, exp: `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`, type: cp === "C" ? "call" : "put", K: +k / 1000 };
}

/* سلسلة الرمز: لقطات العقود ضمن نافذة انتهاء ونطاق سترايك — كلُّ الصفحات */
export async function chainSnapshots(underlying, { expGte, expLte, kLo, kHi, maxPages = 12 } = {}) {
  const out = {}; let tok = null, pages = 0;
  do {
    const u = new URL(`${DATA}/v1beta1/options/snapshots/${toAlpaca(underlying)}`);
    u.searchParams.set("feed", "opra"); u.searchParams.set("limit", "1000");
    if (expGte) u.searchParams.set("expiration_date_gte", expGte);
    if (expLte) u.searchParams.set("expiration_date_lte", expLte);
    if (Number.isFinite(kLo)) u.searchParams.set("strike_price_gte", String(kLo));
    if (Number.isFinite(kHi)) u.searchParams.set("strike_price_lte", String(kHi));
    if (tok) u.searchParams.set("page_token", tok);
    const j = await req(u.toString());
    Object.assign(out, j.snapshots || {});
    tok = j.next_page_token; pages++;
  } while (tok && pages < maxPages);
  return { snaps: out, truncated: !!tok };
}

/* عقود الرمز بالـOpen Interest (لقطة يوم أمس عند OCC) */
export async function contractsOI(underlying, { expGte, expLte, kLo, kHi } = {}) {
  const out = {}; let tok = null, pages = 0;
  do {
    const u = new URL(`${PAPER}/v2/options/contracts`);
    u.searchParams.set("underlying_symbols", toAlpaca(underlying)); u.searchParams.set("limit", "10000");
    u.searchParams.set("status", "active");
    if (expGte) u.searchParams.set("expiration_date_gte", expGte);
    if (expLte) u.searchParams.set("expiration_date_lte", expLte);
    if (Number.isFinite(kLo)) u.searchParams.set("strike_price_gte", String(kLo));
    if (Number.isFinite(kHi)) u.searchParams.set("strike_price_lte", String(kHi));
    if (tok) u.searchParams.set("page_token", tok);
    const j = await req(u.toString());
    for (const c of j.option_contracts || [])
      out[c.symbol] = { oi: c.open_interest == null ? null : +c.open_interest, oiDate: c.open_interest_date || null,
                        close: c.close_price == null ? null : +c.close_price, tradable: !!c.tradable };
    tok = j.next_page_token; pages++;
  } while (tok && pages < 10);
  return out;
}

/* لقطات الأسهم الخام (SIP): آخر صفقة، وشمعة اليوم بـVWAP، وإغلاق الأمس */
export async function stockSnapshots(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 100) {
    const u = new URL(`${DATA}/v2/stocks/snapshots`);
    u.searchParams.set("symbols", symbols.slice(i, i + 100).map(toAlpaca).join(","));
    u.searchParams.set("feed", "sip");
    const j = await req(u.toString());
    for (const [k, v] of Object.entries(j.snapshots || j || {})) out[toApp(k)] = v;
  }
  return out;
}

/* شموع يومية (SIP، تعديل التقسيم) لعدّة رموز */
export async function dailyBars(symbols, fromIso) {
  const out = {}; let tok = null;
  do {
    const u = new URL(`${DATA}/v2/stocks/bars`);
    u.searchParams.set("symbols", symbols.map(toAlpaca).join(",")); u.searchParams.set("timeframe", "1Day");
    u.searchParams.set("start", fromIso); u.searchParams.set("feed", "sip"); u.searchParams.set("adjustment", "split");
    u.searchParams.set("limit", "10000");
    if (tok) u.searchParams.set("page_token", tok);
    const j = await req(u.toString());
    for (const [k, arr] of Object.entries(j.bars || {})) (out[toApp(k)] ||= []).push(...arr.map((b) => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })));
    tok = j.next_page_token;
  } while (tok);
  return out;
}

/* شموع عقود (يومي أو دقيقة) — للتاريخ ولتتبّع بلوغ الأهداف */
export async function optionBars(symbols, timeframe, startIso) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 100) {
    let tok = null;
    do {
      const u = new URL(`${DATA}/v1beta1/options/bars`);
      u.searchParams.set("symbols", symbols.slice(i, i + 100).join(",")); u.searchParams.set("timeframe", timeframe);
      u.searchParams.set("start", startIso); u.searchParams.set("limit", "10000");
      if (tok) u.searchParams.set("page_token", tok);
      const j = await req(u.toString());
      for (const [k, arr] of Object.entries(j.bars || {})) (out[k] ||= []).push(...arr.map((b) => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })));
      tok = j.next_page_token;
    } while (tok);
  }
  return out;
}
