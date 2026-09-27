#!/usr/bin/env node
/* =====================================================================
   مراقبة دفتر الكريبتو **على الموقع المنشور** — دورةً كل خمس دقائق.

   تُسجّل في `data/crypto/.monitor/live.jsonl` (محلّي، لا يُنشر) لكلّ دورة:
     · لقطة الكريبتو المنشورة: المفتاح والبصمة وعدد الصفوف.
     · لقطة الأسهم المنشورة: المفتاح والبصمة — والسوق الأمريكي مغلق، فأيُّ
       تغيّرٍ فيها خلال عطلة الأسبوع أثرٌ من خارجها.
     · وكلَّ عشر دقائق: **ما تعرضه الصفحة فعلاً** في متصفّحٍ حقيقيّ بتحميلٍ
       نظيف — صفوف «الأقوى الآن» في الكريبتو وصفوف الأسهم — مقارنةً بالملفّ.
   والمخالفات تُوسَم في السطر نفسه (`cv` · `sv` · `dv`) ويقرؤها التقرير.

   لا يكتب في أيّ ملفٍّ يقرؤه الموقع، ولا يأخذ قفلاً.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MON = path.join(ROOT, "data", "crypto", ".monitor");
const LOG = path.join(MON, "live.jsonl");
const REPO = "Alkongrs2014/Alkongrs2014";
const PAGE = "https://alkongrs2014.github.io/Alkongrs2014/stocks/";
const h12 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const require = createRequire(import.meta.url);

async function j(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(-60)}`);
  return r.json();
}

function lastEntries(n = 400) {
  try { return fs.readFileSync(LOG, "utf8").trim().split("\n").slice(-n).map(l => JSON.parse(l)); }
  catch { return []; }
}

async function domCheck() {
  let chromium = null;
  for (const c of [path.join(homedir(), ".claude/skills/playwright-skill/node_modules/playwright"), "playwright"]) {
    try { chromium = require(c).chromium; break; } catch { /* التالي */ }
  }
  if (!chromium) return { err: "لا Playwright" };
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
    });
    await page.goto(PAGE + "?mon=" + Date.now(), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => { try { return !!(state.summary && state.summary.rows.length); } catch { return false; } }, null, { timeout: 60000 });
    const read = (view, list) => page.evaluate(async ({ view, list }) => {
      go(view);
      const t0 = Date.now();
      while (!(state.opps && state.opps.scans) && Date.now() - t0 < 40000) await new Promise(r => setTimeout(r, 300));
      state.scan = view === "crypto" ? "best" : "align"; renderScreen();
      await new Promise(r => setTimeout(r, 0));
      return { key: state.opps && state.opps.candleKey, hash: state.opps && state.opps.rowsHash,
               rows: [...document.querySelectorAll(list + " .srow")].map(e => e.dataset.open),
               file: ((state.opps && state.opps.scans && state.opps.scans[state.scan]) || []).map(r => r.s) };
    }, { view, list });
    const s = await read("screen", "#scanList");
    const c = await read("crypto", "#cScanList");
    return { s: { k: s.key, h: s.hash, dom: h12(s.rows.join(",")), ok: s.rows.join() === s.file.join(), usd: s.rows.filter(x => /-USD$/.test(x)).length },
             c: { k: c.key, h: c.hash, dom: h12(c.rows.join(",")), ok: c.rows.join() === c.file.join(), n: c.rows.length,
                  alien: c.rows.filter(x => !/-USD$/.test(x)).length },
             errs: errs.length };
  } finally { await browser.close(); }
}

async function main() {
  fs.mkdirSync(MON, { recursive: true });
  const t = Date.now();
  const e = { t };
  try {
    const sha = (await j(`https://api.github.com/repos/${REPO}/commits/data`)).sha;
    const raw = `https://raw.githubusercontent.com/${REPO}/${sha}`;
    const [co, so] = await Promise.all([j(`${raw}/crypto/opportunities.json`), j(`${raw}/opportunities.json`)]);
    e.sha = sha.slice(0, 10);
    e.c = { k: co.candleKey, h: co.rowsHash, n: co.count, g: co.generatedAt, rg: co.regime ? co.regime.score : null };
    e.s = { k: so.candleKey, h: so.rowsHash, n: so.count };
    // المحلّي لنفس المفتاح يجب أن يطابق المنشور
    try {
      const lo = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "crypto", "opportunities.json"), "utf8"));
      if (lo.candleKey === co.candleKey) e.lm = lo.rowsHash === co.rowsHash ? 1 : 0;
    } catch { /* بلا محلّي */ }
  } catch (err) { e.err = err.message; }

  const prev = lastEntries();
  if (e.c) {
    const sameKey = prev.filter(p => p.c && p.c.k === e.c.k);
    if (sameKey.some(p => p.c.h !== e.c.h)) e.cv = 1;              // تغيّرٌ داخل شمعة الكريبتو
    if (prev.length && prev[prev.length - 1].c && e.c.k < prev[prev.length - 1].c.k) e.cv = 2;   // رجوعٌ إلى الوراء
  }
  if (e.s) {
    const base = prev.filter(p => p.s).slice(-1)[0];
    if (base && base.s.k === e.s.k && base.s.h !== e.s.h) e.sv = 1;  // الأسهم تغيّرت داخل شمعتها
    if (base && base.s.k !== e.s.k) e.sk = [base.s.k, e.s.k];          // تقدّمت شمعة الأسهم (يُفحص مقابل جلسة نيويورك)
  }
  if (new Date(t).getUTCMinutes() % 10 < 5 || process.argv.includes("--dom")) {
    try {
      e.dom = await domCheck();
      if (e.dom.c && (!e.dom.c.ok || e.dom.c.alien)) e.dv = 1;
      if (e.dom.s && (!e.dom.s.ok || e.dom.s.usd)) e.dv = 1;
    } catch (err) { e.dom = { err: err.message.slice(0, 160) }; }
  }
  fs.appendFileSync(LOG, JSON.stringify(e) + "\n");
  console.log(JSON.stringify(e));
}

main().catch(err => { console.error("✗", err.message); process.exit(0); });
