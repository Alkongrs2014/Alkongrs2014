#!/usr/bin/env node
/* =====================================================================
   المهمة اليومية: ترتيب أكبر 70 شركة بالقيمة السوقية الفعلية،
   البيانات الأساسية لكل شركة، مواعيد إعلان الأرباح، والأخبار.

     node scripts/fetch-daily.mjs --out ./out
     node scripts/fetch-daily.mjs --check
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSummary, fetchQuotes, pool, stats, num } from "./lib/yahoo.mjs";
import { fetchFundamentalsFinnhub } from "./lib/finnhub.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const OUT = (() => { const i = args.indexOf("--out"); return i >= 0 ? path.resolve(args[i + 1]) : path.join(ROOT, "out"); })();

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
function writeJSON(rel, obj) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
}

const REC_AR = {
  strong_buy: "شراء قوي", buy: "شراء", hold: "تثبيت",
  sell: "بيع", strong_sell: "بيع قوي", underperform: "أداء أقل", outperform: "أداء أعلى"
};

/* ---------- استخراج البيانات الأساسية من quoteSummary ---------- */
export function extractFundamentals(res) {
  const sd = res?.summaryDetail || {}, ks = res?.defaultKeyStatistics || {},
        ap = res?.assetProfile || {}, ce = res?.calendarEvents || {},
        pr = res?.price || {}, fd = res?.financialData || {};

  // موعد الأرباح: Yahoo يعيد مصفوفة (أحياناً نطاقاً تقديرياً)
  let earnings = null;
  const ed = ce?.earnings?.earningsDate;
  if (Array.isArray(ed) && ed.length) {
    const t = num(ed[0]);
    if (t) earnings = { at: t * 1000, estimated: ed.length > 1 };
  }

  return {
    mc:      num(pr.marketCap) ?? num(sd.marketCap),
    pe:      num(sd.trailingPE),
    fpe:     num(sd.forwardPE),
    pb:      num(ks.priceToBook),
    eps:     num(ks.trailingEps),
    divY:    num(sd.dividendYield),          // نسبة عشرية أو مئوية حسب Yahoo — تُطبَّع عند العرض
    divRate: num(sd.dividendRate),
    beta:    num(sd.beta),
    w52h:    num(sd.fiftyTwoWeekHigh),
    w52l:    num(sd.fiftyTwoWeekLow),
    avgVol:  num(sd.averageVolume),
    shares:  num(ks.sharesOutstanding),
    margin:  num(fd.profitMargins) ?? num(ks.profitMargins),
    revGrow: num(fd.revenueGrowth),
    roe:     num(fd.returnOnEquity),
    target:  num(fd.targetMeanPrice),
    rec:     fd.recommendationKey ? (REC_AR[fd.recommendationKey] || fd.recommendationKey) : null,
    recN:    num(fd.numberOfAnalystOpinions),
    earnings,
    sector:  ap.sector || null,
    industry: ap.industry || null,
    staff:   num(ap.fullTimeEmployees),
    site:    ap.website || null,
    about:   ap.longBusinessSummary ? String(ap.longBusinessSummary).slice(0, 600) : null
  };
}

/* ---------- تحليل RSS بلا مكتبات ---------- */
export function parseRSS(xml, source) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  const pick = (b, tag) => {
    const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (!m) return null;
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
               .replace(/<[^>]+>/g, "")
               .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
               .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
               .trim() || null;
  };
  for (const b of blocks) {
    const title = pick(b, "title"), link = pick(b, "link");
    if (!title || !link) continue;
    const d = pick(b, "pubDate");
    const t = d ? Date.parse(d) : NaN;
    items.push({ title, link, src: source, t: isFinite(t) ? t : null });
  }
  return items;
}

async function fetchRSS(url, source) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; StocksWatch/1.0)" },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseRSS(await r.text(), source);
}

/* ---------- التشغيل ---------- */
async function main() {
  const now = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  const universe = cfg.symbols;
  console.log(`▶ المهمة اليومية على ${universe.length} رمزاً …`);

  // 1) البيانات الأساسية
  const results = await pool(universe, 4, async (m) => {
    const res = await fetchSummary(m.s);
    return { s: m.s, f: extractFundamentals(res) };
  });

  const fundamentals = {};
  const failed = [];
  results.forEach((r, i) => {
    if (r.ok && r.value.f) fundamentals[r.value.s] = r.value.f;
    else { failed.push(universe[i].s); }
  });
  console.log(`  ✓ بيانات أساسية: ${Object.keys(fundamentals).length} / ${universe.length}`);
  if (failed.length) console.warn(`  ⚠ فشل: ${failed.join(", ")}`);

  // 1ب) Finnhub بديلاً لكل رمز فشل عند Yahoo (حظر 429 غالباً من عناوين GitHub Actions)
  if (failed.length && process.env.FINNHUB_API_KEY) {
    console.log(`  … نجرّب Finnhub لـ ${failed.length} رمزاً فشلت عند Yahoo`);
    try {
      const fh = await fetchFundamentalsFinnhub(failed);
      let got = 0;
      for (const [s, f] of Object.entries(fh)) { fundamentals[s] = f; got++; }
      console.log(`  ✓ Finnhub بديل: ${got} / ${failed.length}`);
    } catch (e) { console.warn(`  ⚠ Finnhub بديل فشل: ${e.message}`); }
  }

  // 2) القيمة السوقية — نكمل الناقص من دفعة الأسعار
  const mc = {};
  for (const [s, f] of Object.entries(fundamentals)) if (f.mc) mc[s] = f.mc;
  const missing = universe.filter(u => !mc[u.s]).map(u => u.s);
  if (missing.length) {
    console.log(`  … ${missing.length} رمزاً بلا قيمة سوقية، نجرّب دفعة الأسعار`);
    try {
      const q = await fetchQuotes(missing);
      for (const [s, v] of Object.entries(q || {})) { const m = num(v.marketCap); if (m) mc[s] = m; }
    } catch (e) { console.warn(`  ⚠ ${e.message}`); }
  }

  // 3) الترتيب — أعلى 70 بالقيمة السوقية
  const prevRank = readJSON(path.join(OUT, "ranking.json"));
  const ranked = universe.map(u => u.s).filter(s => mc[s]).sort((a, b) => mc[b] - mc[a]);
  let top;
  if (ranked.length >= cfg.top) {
    top = ranked.slice(0, cfg.top);
  } else if (prevRank?.top?.length) {
    console.warn(`  ⚠ ${ranked.length} رمزاً فقط له قيمة سوقية — نُبقي ترتيب الأمس`);
    top = prevRank.top;
  } else {
    console.warn(`  ⚠ ترتيب غير مكتمل — نستخدم ترتيب الملف المبدئي`);
    top = universe.slice(0, cfg.top).map(u => u.s);
  }
  const entered = prevRank?.top ? top.filter(s => !prevRank.top.includes(s)) : [];
  const exited  = prevRank?.top ? prevRank.top.filter(s => !top.includes(s)) : [];
  if (entered.length || exited.length)
    console.log(`  ↻ دخل: ${entered.join(", ") || "—"} · خرج: ${exited.join(", ") || "—"}`);

  writeJSON("ranking.json", { updated: now, top, mc, entered, exited });
  writeJSON("fundamentals.json", { updated: now, count: Object.keys(fundamentals).length, f: fundamentals });

  // 4) الأخبار — أخبار السوق + عناوين لكل سهم من الـ70
  const market = [];
  for (const [src, url] of [
    ["Yahoo Finance", "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US"],
    ["MarketWatch",   "https://feeds.content.dowjones.io/public/rss/mw_topstories"],
    ["CNBC",          "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664"]
  ]) {
    try { market.push(...(await fetchRSS(url, src)).slice(0, 12)); console.log(`  ✓ أخبار ${src}`); }
    catch (e) { console.warn(`  ⚠ أخبار ${src}: ${e.message}`); }
  }

  const perSymbol = {};
  const newsRes = await pool(top, 5, async (s) => ({
    s, items: (await fetchRSS(
      `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(s)}&region=US&lang=en-US`,
      "Yahoo Finance")).slice(0, 6)
  }));
  let newsOk = 0;
  for (const r of newsRes) if (r.ok && r.value.items.length) { perSymbol[r.value.s] = r.value.items; newsOk++; }
  console.log(`  ✓ أخبار الأسهم: ${newsOk} / ${top.length}`);

  const seen = new Set();
  const marketDedup = market
    .filter(n => { const k = n.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.t ?? 0) - (a.t ?? 0)).slice(0, 30);

  // لا نكتب ملف أخبار فارغاً فوق ملف سليم
  const prevNews = readJSON(path.join(OUT, "news.json"));
  if (marketDedup.length || newsOk) writeJSON("news.json", { updated: now, market: marketDedup, sym: perSymbol });
  else if (prevNews) console.warn("  ⚠ لا أخبار جديدة — أبقينا ملف الأمس");

  const prevMeta = readJSON(path.join(OUT, "meta.json"), {});
  writeJSON("meta.json", {
    ...prevMeta,
    dailyUpdated: now,
    dailyRun: {
      at: new Date(now).toISOString(),
      fundamentals: Object.keys(fundamentals).length,
      failed, ranked: ranked.length, entered, exited,
      marketNews: marketDedup.length, symbolNews: newsOk,
      requests: stats.requests, retries: stats.retries, sources: stats.sources
    }
  });

  console.log(`✔ اكتملت المهمة اليومية · أعلى 70: ${top.slice(0, 5).join(", ")} …`);
}

/* ---------- فحص ذاتي بلا شبكة ---------- */
function selfCheck() {
  console.log("▶ فحص ذاتي للمهمة اليومية (بلا شبكة)\n");
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n} — ${e.message}`); fail++; } };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

  t("extractFundamentals يقرأ صيغة Yahoo المتداخلة", () => {
    const f = extractFundamentals({
      summaryDetail: { trailingPE: { raw: 31.2 }, dividendYield: { raw: 0.0044 }, fiftyTwoWeekHigh: { raw: 260 }, fiftyTwoWeekLow: { raw: 164 } },
      defaultKeyStatistics: { trailingEps: { raw: 7.1 }, sharesOutstanding: { raw: 1.5e10 } },
      price: { marketCap: { raw: 3.9e12 } },
      financialData: { recommendationKey: "buy", targetMeanPrice: { raw: 275 }, numberOfAnalystOpinions: { raw: 42 } },
      calendarEvents: { earnings: { earningsDate: [{ raw: 1767225600 }, { raw: 1767398400 }] } },
      assetProfile: { sector: "Technology", fullTimeEmployees: 164000 }
    });
    eq([f.pe, f.eps, f.mc, f.w52h, f.rec, f.target], [31.2, 7.1, 3.9e12, 260, "شراء", 275], "حقول");
    eq(f.earnings, { at: 1767225600000, estimated: true }, "موعد الأرباح");
    eq(f.staff, 164000, "الموظفون");
  });

  t("extractFundamentals يعيد null لا أصفاراً عند غياب الحقول", () => {
    const f = extractFundamentals({});
    for (const k of ["pe", "eps", "mc", "divY", "target", "earnings", "sector"])
      if (f[k] !== null) throw new Error(`${k} = ${JSON.stringify(f[k])} بدل null`);
  });

  t("parseRSS يستخرج العناوين ويفك CDATA", () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[Apple &amp; Nvidia rally]]></title><link>https://x.com/1</link><pubDate>Tue, 05 Aug 2025 12:00:00 GMT</pubDate></item>
      <item><title>Plain &lt;b&gt;title&lt;/b&gt;</title><link>https://x.com/2</link></item>
      <item><title>No link</title></item>
    </channel></rss>`;
    const items = parseRSS(xml, "T");
    eq(items.length, 2, "تجاهل العنصر بلا رابط");
    eq(items[0].title, "Apple & Nvidia rally", "CDATA + كيانات");
    eq(items[0].t, Date.parse("Tue, 05 Aug 2025 12:00:00 GMT"), "التاريخ");
    eq(items[1].t, null, "بلا تاريخ -> null");
  });

  t("parseRSS يتحمّل XML تالفاً", () => {
    eq(parseRSS("", "T").length, 0, "فارغ");
    eq(parseRSS("<html>not rss</html>", "T").length, 0, "ليس RSS");
  });

  t("منطق الترتيب يختار الأعلى قيمة سوقية", () => {
    const mc = { A: 300, B: 100, C: 500, D: 50 };
    const ranked = ["A", "B", "C", "D"].filter(s => mc[s]).sort((a, b) => mc[b] - mc[a]);
    eq(ranked.slice(0, 3), ["C", "A", "B"], "الترتيب تنازلي");
  });

  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل`);
  process.exit(fail ? 1 : 0);
}

if (CHECK) selfCheck();
else main().catch(e => { console.error("✗ فشل التشغيل:", e.message); process.exit(1); });
