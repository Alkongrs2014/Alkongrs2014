/* =====================================================================
   اختبار قبولٍ على **الموقع المنشور** — المحرّك V3 (docs/ENGINE_V3_SPEC.md).

   الفحص المحلّي يشهد للمنطق، والمستخدم يرى الصفحة المنشورة بعد أن يمرّ
   عليها عاملُ الخدمة والشبكة وترتيبُ وصول الملفّات الكسولة. فهذا يفحص:
   ١) الشيفرة المنشورة = شيفرة القرص (بعد إلغاء عامل الخدمة).
   ٢) الفرص المعروضة = صفقات trades.json المنشورة، بترتيبها، والدرجة لكل
      صفقة = مجموع أوزان ما عُلّم ✓ في بطاقتها (40 · 40 · 6.67 · 6.67 · 6.66).
   ٣) ما يراه المستخدم لا يتبدّل بعد ظهوره، ولا يتحرّك بتذبذب السعر اللحظي.
   ٤) لا فرصة من المحرّك القديم: لا لقطة قديمة تُطلب، والكريبتو بلا فرص.
   ٥) صفرُ استثناءٍ وصفرُ قيدٍ في سجلّ التشخيص.
   (النسخة السابقة لهذا الفحص — للمحرّك القديم — في legacy_strategy_engine/.)

   يُشغَّل: node scripts/check-live.mjs [رابط مجلّد stocks/]
   ===================================================================== */
import "./lib/pw-browsers.mjs";          // قبل تحميل Playwright
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const require = createRequire(import.meta.url);
const URL_ = process.argv[2] || "https://alkongrs2014.github.io/Alkongrs2014/stocks/";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const CANDS = ["@playwright/test",
  path.join(homedir(), ".claude/skills/playwright-skill/node_modules/playwright"), "playwright"];
let chromium = null;
for (const c of CANDS) { try { chromium = require(c).chromium; break; } catch { /* التالي */ } }
if (!chromium) { console.error("✗ Playwright غير مركَّب"); process.exit(2); }

let pass = 0, fail = 0;
const ok = (m, d) => { pass++; console.log(`  ✓ ${m}${d ? " — " + d : ""}`); };
const no = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? " — " + d : ""}`); };
const h12 = (x) => createHash("sha256").update(x).digest("hex").slice(0, 12);
const W = { day: 40, ma: 40, trend: 6.67, vwap: 6.67, week: 6.66 };

/* تأخيرٌ صناعيّ لملفّ الصفقات: بلاه يصل قبل أوّل رسم فلا يُختبر أن الواجهة
   تعرض هيكلاً ولا تخترع قائمةً مؤقّتة. */
const lagRoute = async (route) => { await new Promise(r => setTimeout(r, 1800)); await route.continue(); };
const FILES = ["index.html", "sw.js", "indicators.js", "score.js", "session.js", "config.js", "engine3.js"];

console.log("\n▶ اختبار قبول على الموقع المنشور (المحرّك V3)\n  " + URL_ + "\n");
const browser = await chromium.launch({ headless: true });
try {
  const base = URL_.replace(/index\.html$/, "").replace(/\/?$/, "/");
  const ctx = await browser.newContext();
  {
    const p = await ctx.newPage();
    await p.goto(base + "index.html", { waitUntil: "domcontentloaded" });
    await p.evaluate(async () => {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
    });
    await p.close();
  }
  const errs = [], reqs = [];
  const page = await ctx.newPage();
  page.on("pageerror", e => errs.push(String(e.message)));
  page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });
  page.on("request", r => reqs.push(r.url()));
  await page.route(/trades\.json/, lagRoute);
  await page.goto(base + "index.html?fresh=" + Date.now(), { waitUntil: "domcontentloaded" });

  /* ══ ١) الشيفرة المنشورة = شيفرة القرص ══ */
  const mismatch = [];
  for (const f of FILES) {
    const local = path.join(ROOT, "stocks", f);
    if (!existsSync(local)) continue;
    const res = await page.request.get(base + f + "?x=" + Date.now());
    const a = h12(readFileSync(local, "utf8").replace(/\r\n/g, "\n"));
    const b = h12((await res.text()).replace(/\r\n/g, "\n"));
    if (a !== b) mismatch.push(`${f} (محلّي ${a} · منشور ${b})`);
  }
  mismatch.length ? no("الشيفرة المنشورة هي شيفرة القرص", mismatch.join(" · "))
                  : ok("الشيفرة المنشورة هي شيفرة القرص", FILES.length + " ملفّات");

  await page.waitForFunction(() => { try { return !!(state && state.summary && state.summary.rows.length); } catch { return false; } },
    null, { timeout: 45000 });
  await page.evaluate(() => go("screen"));
  /* القائمة الأولى التي يراها المستخدم — بعد زوال الهيكل */
  await page.waitForFunction(() => { const el = document.querySelector("#scanList"); return !!el && !el.querySelector(".skl"); },
    null, { timeout: 30000 });
  const read = () => page.evaluate(() => [...document.querySelectorAll("#scanList .srow.opp")].map(c => ({
    s: c.dataset.open,
    score: parseFloat(c.querySelector(".v3q b").textContent),
    on: [...c.querySelectorAll(".v3els .it")].map(x => x.classList.contains("on") ? 1 : 0)
  })));
  const first = await read();

  /* ══ ٢) المعروض = trades.json المنشور، والدرجة = مجموع ✓ بأوزانها ══ */
  const pub = await page.evaluate(() => TRADES && { key: TRADES.candleKey, hour: TRADES.hour, open: TRADES.open.map(t => t.s),
    carried: TRADES.open.filter(t => t.h !== TRADES.hour).length,
    oldEntry: TRADES.open.filter(t => t.t !== TRADES.candleKey).map(t => t.s) });
  if (!pub) no("صفقات trades.json وصلت الصفحة");
  else {
    JSON.stringify(first.map(x => x.s)) === JSON.stringify(pub.open)
      ? ok("المعروض = صفقات trades.json بترتيبها", `${first.length} صفقة مفتوحة · شمعة ${new Date(pub.key * 1000).toISOString()}`)
      : no("المعروض = صفقات trades.json بترتيبها", `معروض ${first.length} · منشور ${pub.open.length}`);
    pub.carried === 0 ? ok("لا وراثة: كلُّ فرصةٍ مبنيّةٌ في لقطة ساعتها", new Date(pub.hour * 1000).toISOString())
                      : no("لا وراثة: كلُّ فرصةٍ مبنيّةٌ في لقطة ساعتها", pub.carried + " من ساعةٍ أخرى");
    !pub.oldEntry.length ? ok("لا دخولٌ قديم: كلُّ فرصةٍ على شمعة اللقطة نفسها (تداولٌ في آخر 15 دقيقة)")
                         : no("لا دخولٌ قديم: كلُّ فرصةٍ على شمعة اللقطة نفسها", pub.oldEntry.join(", "));
    const keys = ["day", "ma", "trend", "vwap", "week"];
    const bad = first.filter(x => {
      const sum = Math.round(keys.reduce((a, k, i) => a + (x.on[i] ? W[k] : 0), 0) * 100) / 100;
      return Math.abs(sum - x.score) > 1e-6 || x.score > 100;
    }).map(x => x.s);
    bad.length ? no("الدرجة = مجموع أوزان ✓ في البطاقة", bad.slice(0, 6).join(", "))
               : ok("الدرجة = مجموع أوزان ✓ في البطاقة", "40 · 40 · 6.67 · 6.67 · 6.66");
    first.every((x, i) => !i || first[i - 1].score >= x.score)
      ? ok("الترتيب من الأعلى توافقاً إلى الأقل") : no("الترتيب من الأعلى توافقاً إلى الأقل");
    const base0 = first.filter(x => !(x.on[0] || x.on[1])).map(x => x.s);
    base0.length ? no("كل فرصة تحمل إحدى الأساسيتين", base0.join(", ")) : ok("كل فرصة تحمل إحدى الأساسيتين");
  }

  /* ══ ٣) لا يتبدّل بعد ظهوره · ولا يتحرّك بتذبذب السعر ══ */
  await page.waitForTimeout(4500);
  await page.evaluate(() => { lazyReload(); renderScreen(); });
  await page.waitForTimeout(2500);
  const later = await read();
  const sameKey = await page.evaluate((k) => TRADES && TRADES.candleKey === k, pub && pub.key);
  (JSON.stringify(first) === JSON.stringify(later) || !sameKey)
    ? ok("ما يراه المستخدم لا يتبدّل بعد ظهوره", sameKey ? "نفس الشمعة" : "أُغلقت شمعة بين القراءتين — لا يُقارن")
    : no("ما يراه المستخدم لا يتبدّل بعد ظهوره", `${first.length}→${later.length}`);
  const jitter = await page.evaluate(() => {
    const snap = () => { renderScreen(); return [...document.querySelectorAll("#scanList .srow.opp")].map(c => c.dataset.open + "/" + c.querySelector(".v3q b").textContent); };
    const A = snap(), rows = state.summary.rows, bak = rows.map(r => [r.p, r.chg]);
    rows.forEach(r => { if (isFinite(r.p)) r.p *= 1.006; if (isFinite(r.chg)) r.chg += 0.6; });
    const B = snap();
    rows.forEach((r, i) => { r.p = bak[i][0]; r.chg = bak[i][1]; });
    return JSON.stringify(A) === JSON.stringify(B);
  });
  jitter ? ok("تذبذب السعر اللحظي لا يحرّك القائمة", "±0.6%") : no("تذبذب السعر اللحظي لا يحرّك القائمة");

  /* ══ ٤) لا شيء من المحرّك القديم ══ */
  await page.evaluate(() => go("crypto"));
  await page.waitForTimeout(1500);
  const cr = await page.evaluate(() => ({ rows: [...document.querySelectorAll('section[data-view="crypto"] .srow.opp')].map(c => c.dataset.open),
    /* ترتيب العرض: العادية بترتيب الخادم ثم «أقل سيولة» بترتيبه في قسمها (قرار المالك 2026-10-03) */
    pub: TRADES_C && [...TRADES_C.open.filter(t => !t.low), ...TRADES_C.open.filter(t => t.low)].map(t => t.s), hour: TRADES_C && TRADES_C.hour,
    carried: TRADES_C ? TRADES_C.open.filter(t => t.h !== TRADES_C.hour).length : -1,
    oldEntry: TRADES_C ? TRADES_C.open.filter(t => t.t !== TRADES_C.candleKey).length : -1 }));
  (cr.pub && JSON.stringify(cr.rows) === JSON.stringify(cr.pub) && !cr.rows.some(s => !/-USD$/.test(s)) && cr.carried === 0 && cr.oldEntry === 0)
    ? ok("الكريبتو = لقطة ساعته من V3", `${cr.rows.length} فرصة · ساعة ${new Date(cr.hour * 1000).toISOString()}`)
    : no("الكريبتو = لقطة ساعته من V3", JSON.stringify({ rows: cr.rows.length, pub: cr.pub && cr.pub.length, carried: cr.carried, oldEntry: cr.oldEntry }));
  await page.evaluate(() => go("screen"));
  const old = reqs.filter(u => /(opportunities|strategies|strategy-edge|ma200-open|opp-history)\.json/.test(u));
  old.length ? no("لا تُطلب لقطات المحرّك القديم", old.slice(0, 3).join(" · ")) : ok("لا تُطلب لقطات المحرّك القديم");

  /* ══ ٦) §4ج: الصفقات القائمة · «صفقاتي» مستقلّةٌ لكل متصفّح ولا تمسّ الترتيب ══ */
  {
    const life = await page.evaluate(() => {
      renderScreen();
      return TRADES && { life: TRADES.life || 0, act: (TRADES.active || []).length, rows: document.querySelectorAll("#scanList .v3act").length };
    });
    if (life && life.life) life.rows === life.act
      ? ok("صفقات V3 القائمة معروضةٌ كلُّها في قسمها", `${life.act} قائمة`)
      : no("صفقات V3 القائمة معروضةٌ كلُّها في قسمها", `${life.rows} صفّاً من ${life.act}`);
    const mt = await page.evaluate(async () => {
      localStorage.removeItem("stk_mytrades");
      const order = () => { renderScreen(); return [...document.querySelectorAll("#scanList > .srow.opp")].map(c => c.dataset.open + "/" + c.querySelector(".v3q b").textContent).join(","); };
      const t = TRADES && [...(TRADES.open || []), ...(TRADES.active || [])][0];
      if (!t) return { skip: true };
      const A = order();
      mtAsk(t.id); await new Promise(r => setTimeout(r, 200));
      mtAction("save"); await new Promise(r => setTimeout(r, 200));
      const n = mtLoad().length, B = order();
      go("mytrades"); await new Promise(r => setTimeout(r, 600));
      const cards = document.querySelectorAll("#mtList .mtcard").length;
      go("screen");
      return { n, cards, same: A === B };
    });
    if (mt.skip) ok("«صفقاتي» — لا فرصة ولا صفقة قائمة لتجربة التسجيل الآن", "يُتخطّى");
    else {
      mt.n === 1 && mt.cards === 1 ? ok("«دخلت الصفقة» يسجّل في «صفقاتي»") : no("«دخلت الصفقة» يسجّل في «صفقاتي»", JSON.stringify(mt));
      mt.same ? ok("صفقاتي لا تغيّر ترتيب الفرص ولا درجاتها") : no("صفقاتي لا تغيّر ترتيب الفرص ولا درجاتها");
      const ctx2 = await browser.newContext(), p2 = await ctx2.newPage();
      await p2.goto(base + "index.html", { waitUntil: "load" });
      const other = await p2.evaluate(() => { try { return JSON.parse(localStorage.getItem("stk_mytrades") || "[]").length; } catch { return -1; } });
      await ctx2.close();
      other === 0 ? ok("صفقات متصفّحٍ لا تظهر في متصفّحٍ آخر", "localStorage لكل متصفّح") : no("صفقات متصفّحٍ لا تظهر في متصفّحٍ آخر", other + " صفقة");
      await page.evaluate(() => localStorage.removeItem("stk_mytrades"));
    }
  }

  /* ══ ٥) صفرُ استثناء وصفرُ تشخيص ══ */
  const real = errs.filter(e => !/api\.github\.com|status of 40[34]/.test(e));
  real.length ? no("لا استثناء في الصفحة المنشورة", real.slice(0, 3).join(" | ")) : ok("لا استثناء في الصفحة المنشورة");
  const diag = await page.evaluate(() => { try { return (window.__diag ? window.__diag() : []).length; } catch { return -1; } });
  diag > 0 ? no("سجلّ التشخيص فارغ", diag + " قيداً") : ok("سجلّ التشخيص فارغ");
} finally { await browser.close(); }

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
process.exit(fail ? 1 : 0);
