/* =====================================================================
   إثباتُ انفصال الدفترين على **الموقع المنشور** — بشمعةِ كريبتو حقيقية.

   لا محاكاة: ينتظر أن تُغلق شمعةُ كريبتو فعلاً وتُنشر لقطتُها، ويقرأ ما
   يراه المستخدم من الـDOM في متصفّحٍ حقيقيّ بتحميلٍ نظيف (عامل الخدمة
   مُلغى). والشروط:

     ١) **ثباتُ الكريبتو داخل شمعته**: لقطتان بفاصل دقيقتين على نفس
        المفتاح ⇒ صفر فرق في العضوية والرتبة والدرجة والتوافق والقيمة.
     ٢) **مفتاحُ الكريبتو يتقدّم** بإغلاق شمعته — نظامٌ لا يتحرّك معطَّل.
     ٣) **الأسهم لا تتحرّك بشمعة الكريبتو**: مفتاحُها وبصمتُها وكلُّ صفٍّ
        معروضٍ في كلِّ مسحٍ قبل تقدّم الكريبتو وبعده متطابقةٌ بالحرف.
        (إن تقدّمت شمعةُ الأسهم نفسها في النافذة — يومَ تداول — يُقال ذلك
        ولا يُحكم: المقارنة حينها تقيس الأسهم لا الانفصال.)
     ٤) صفر `-USD` في الأسهم، وكلُّ صفٍّ في الكريبتو `-USD`.

   يُشغَّل:  node scripts/prove-crypto-live.mjs [ثوانٍ=120]
   ===================================================================== */
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";

const require = createRequire(import.meta.url);
const URL_ = process.argv.find(a => a.startsWith("http")) || "https://alkongrs2014.github.io/Alkongrs2014/stocks/";
const RAW = "https://raw.githubusercontent.com/Alkongrs2014/Alkongrs2014/data";
const GAP = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) || 120);

const CANDS = [
  path.join(homedir(), ".claude/skills/playwright-skill/node_modules/playwright"),
  path.join(homedir(), ".claude/plugins/marketplaces/playwright-skill/skills/playwright-skill/node_modules/playwright"),
  "playwright"
];
let chromium = null;
for (const c of CANDS) { try { chromium = require(c).chromium; break; } catch { /* التالي */ } }
if (!chromium) { console.error("✗ Playwright غير مركَّب"); process.exit(2); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const iso = (s) => s ? new Date(s * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z" : "—";
const hhmmss = () => new Date().toISOString().slice(11, 19);
const h12 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

/* رأسُ لقطة الكريبتو المنشورة — من **الدفعة الأحدث** لا من اسم الفرع:
   `raw.githubusercontent` يعيد نسخةً أقدم بين قراءتين (موثَّق). */
async function cryptoHead() {
  try {
    const c = await fetch("https://api.github.com/repos/Alkongrs2014/Alkongrs2014/commits/data",
      { signal: AbortSignal.timeout(20000), headers: { accept: "application/vnd.github+json" } });
    const sha = c.ok ? (await c.json()).sha : null;
    const base = sha ? RAW.replace(/\/data$/, "/" + sha) : RAW;
    const r = await fetch(`${base}/crypto/opportunities.json?x=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const j = await r.json();
    return { candleKey: j.candleKey, rowsHash: j.rowsHash };
  } catch { return null; }
}

/* ما يراه المستخدم في الدفترين — من صفحةٍ محمَّلة من الصفر. */
async function shot(browser, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e.message)));
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  await page.goto(URL_ + "?proveBooks=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { try { return !!(state.summary && state.summary.rows.length); } catch { return false; } },
    null, { timeout: 60000 });

  const read = async (view, listSel) => {
    await page.evaluate((v) => go(v), view);
    await page.waitForFunction(() => !!(state.opps && state.opps.scans), null, { timeout: 60000 });
    return page.evaluate(async ({ view, listSel }) => {
      const pick = view === "crypto" ? "#cScanPicker" : "#scanPicker";
      const ids = [...document.querySelectorAll(pick + " button")].map(b => b.dataset.scan);
      const out = { key: state.opps.candleKey, hash: state.opps.rowsHash, book: state.book, scans: {} };
      for (const id of ids) {
        state.scan = id; renderScreen();
        await new Promise(r => setTimeout(r, 0));
        out.scans[id] = [...document.querySelectorAll(listSel + " .srow")].map((el, i) => {
          const hitv = (el.querySelector(".hitv") || {}).textContent || "";
          const g = hitv.match(/درجة\s*(\d+)/);
          const conf = [...el.querySelectorAll(".id .n")].map(n => n.textContent.replace(/\s+/g, " ").trim())
            .find(t => /متعارضة|منفردة|توافق|تعارض/.test(t)) || "";
          const dir = (el.querySelector(".opp-dir") || {}).textContent || "";
          return [i, el.dataset.open, g ? g[1] : "", conf, dir.trim(),
                  hitv.replace(/درجة[\s\S]*$/, "").replace(/\s+/g, " ").trim()].join("|");
        });
      }
      return out;
    }, { view, listSel });
  };

  const us = await read("screen", "#scanList");
  const cr = await read("crypto", "#cScanList");
  await ctx.close();
  const canon = (b) => Object.keys(b.scans).sort().map(id => id + ";" + b.scans[id].join(";")).join("\n");
  const rows = (b) => Object.values(b.scans).flat();
  const res = {
    us: { ...us, dom: h12(canon(us)), n: rows(us).length, usd: rows(us).filter(r => /-USD\|/.test(r)).length },
    cr: { ...cr, dom: h12(canon(cr)), n: rows(cr).length, alien: rows(cr).filter(r => !/-USD\|/.test(r)).length },
    errs
  };
  console.log(`  ${label} · ${hhmmss()}\n` +
    `     الأسهم   شمعة ${iso(res.us.key)} · بصمة ${res.us.hash} · معروض ${res.us.dom} · ${res.us.n} صفّاً\n` +
    `     الكريبتو شمعة ${iso(res.cr.key)} · بصمة ${res.cr.hash} · معروض ${res.cr.dom} · ${res.cr.n} صفّاً` +
    (errs.length ? `\n     ${errs.length} استثناء: ${errs[0].slice(0, 120)}` : ""));
  return res;
}

let pass = 0, fail = 0;
const ok = (n, d = "") => { console.log(`  ✓ ${n}${d ? " — " + d : ""}`); pass++; };
const no = (n, d = "") => { console.log(`  ✗ ${n}${d ? " — " + d : ""}`); fail++; };

console.log(`\n▶ إثباتُ انفصال الدفترين على الموقع المنشور\n  ${URL_}\n`);
const browser = await chromium.launch({ headless: true });
try {
  const A1 = await shot(browser, "لقطة ١");
  console.log(`  … ${GAP} ثانية داخل نفس الشمعة …`);
  await sleep(GAP * 1000);
  const A2 = await shot(browser, "لقطة ٢");

  if (A1.cr.key === A2.cr.key) {
    A1.cr.dom === A2.cr.dom && A1.cr.hash === A2.cr.hash
      ? ok("الكريبتو ثابتٌ داخل شمعته", `${A1.cr.n} صفّاً · معروض ${A1.cr.dom}`)
      : no("الكريبتو ثابتٌ داخل شمعته", `${A1.cr.dom} → ${A2.cr.dom}`);
  } else console.log("  ⓘ عبرت اللقطتان حدَّ شمعة كريبتو — يُحكم على الثبات في الجولة التالية");

  // انتظارُ شمعةِ كريبتو جديدة منشورة
  const startKey = A2.cr.key;
  console.log(`\n  أنتظر شمعة كريبتو بعد ${iso(startKey)} …`);
  const deadline = Date.now() + 25 * 60000;
  let seen = null;
  while (Date.now() < deadline) {
    const h = await cryptoHead();
    if (h && h.candleKey > startKey) { seen = h; break; }
    await sleep(20000);
  }
  if (!seen) { no("مفتاحُ الكريبتو يتقدّم على المنشور", "لم يظهر مفتاحٌ جديد خلال 25 دقيقة"); }
  else {
    ok("مفتاحُ الكريبتو يتقدّم على المنشور", `${iso(startKey)} → ${iso(seen.candleKey)}`);
    await sleep(15000);                    // هامشٌ لحوافّ raw
    const B = await shot(browser, "لقطة ٣ (بعد شمعة الكريبتو)");
    B.cr.key > startKey
      ? ok("الصفحة تعرض شمعةَ الكريبتو الجديدة", iso(B.cr.key))
      : no("الصفحة تعرض شمعةَ الكريبتو الجديدة", `ما زالت ${iso(B.cr.key)}`);
    if (B.us.key !== A2.us.key) {
      console.log(`  ⓘ شمعةُ الأسهم نفسها تقدّمت في النافذة (${iso(A2.us.key)} → ${iso(B.us.key)}) — لا حكم على الانفصال في هذه الجولة`);
    } else {
      (B.us.hash === A2.us.hash && B.us.dom === A2.us.dom && B.us.n === A2.us.n)
        ? ok("الأسهم لم تتغيّر بشمعة الكريبتو — نقطةً ولا ترتيباً ولا استراتيجية",
             `شمعة ${iso(B.us.key)} · بصمة ${B.us.hash} · معروض ${B.us.dom} · ${B.us.n} صفّاً في كل المسوح`)
        : no("الأسهم لم تتغيّر بشمعة الكريبتو", `بصمة ${A2.us.hash}→${B.us.hash} · معروض ${A2.us.dom}→${B.us.dom}`);
    }
    [A1, A2, B].every(s => !s.us.usd && !s.cr.alien)
      ? ok("لا خلط في المعروض", "صفر -USD في الأسهم · كلُّ صفّ كريبتو -USD")
      : no("لا خلط في المعروض", JSON.stringify([A1, A2, B].map(s => [s.us.usd, s.cr.alien])));
    [A1, A2, B].every(s => !s.errs.length) ? ok("لا استثناء في الصفحة") : no("لا استثناء في الصفحة");
  }
} finally { await browser.close(); }

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
process.exit(fail ? 1 : 0);
