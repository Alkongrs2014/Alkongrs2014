/* =====================================================================
   اختبار قبولٍ على **الموقع المنشور** — لا على القرص ولا على المحاكاة.

   لماذا يلزم رغم كل الفحوص: ثلاث علل متتالية مرّت من فحوصٍ محلّية
   ناجحة ووصلت المستخدم. وسببُها واحد: الفحص المحلّي يشهد للمنطق،
   والمستخدم يرى **الصفحة المنشورة بعد أن يمرّ عليها عاملُ الخدمة
   والشبكة وترتيبُ وصول الملفّات الكسولة**. والعلّة الأخيرة عاشت في
   هذه الفجوة بالضبط: البيانات ثابتة والشيفرة صحيحة، والقائمة تتبدّل
   لأن ترتيبها يعتمد ملفّاً يصل بعد الرسم بـ‎800‎ مللي.

   يفحص ثلاثة أشياء لا يستطيع أيُّ فحصٍ في Node أن يفحصها:
   ١) أن الشيفرة المنشورة هي شيفرة القرص (لا نسخة عاملِ خدمة قديمة).
   ٢) أن قائمة الفرص لا تتبدّل بين أوّل رسمٍ واستقرار التحميل.
   ٣) أن تذبذب السعر اللحظي لا يحرّك القائمة.

   يُشغَّل: node scripts/check-live.mjs [رابط]
   ===================================================================== */
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const require = createRequire(import.meta.url);
const URL_ = process.argv[2] || "https://alkongrs2014.github.io/Alkongrs2014/stocks/";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

/* Playwright أداةُ تطويرٍ لا اعتماديةُ تطبيق: يُبحث عنها في مواضع
   التركيب المعروفة ولا تُضاف إلى المشروع — قاعدة «بلا مكتبة خارجية»
   تخصّ ما يصل المتصفّح. */
const CANDS = [
  path.join(homedir(), ".claude/skills/playwright-skill/node_modules/playwright"),
  path.join(homedir(), ".claude/plugins/marketplaces/playwright-skill/skills/playwright-skill/node_modules/playwright"),
  "playwright"
];
let chromium = null;
for (const c of CANDS) { try { chromium = require(c).chromium; break; } catch {} }
if (!chromium) {
  console.error("✗ Playwright غير مركَّب. ركّبه: cd ~/.claude/skills/playwright-skill && npm run setup");
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (m, d) => { pass++; console.log(`  ✓ ${m}${d ? " — " + d : ""}`); };
const no = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? " — " + d : ""}`); };

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);

console.log("\n▶ اختبار قبول على الموقع المنشور\n  " + URL_ + "\n");

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e.message)));
  page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });

  /* عاملُ الخدمة يقدّم نسخةً مخزَّنة حتى مع `no-store` — اعتراضُه يسبق
     ترويسات HTTP. فبلا إلغائه يشهد الفحص لنسخةٍ قديمة ويمرّ كذباً. */
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  /* تأخيرٌ صناعيّ للملفّات الكسولة — **شرطُ أن يكون الفحص حاسماً**.
     بلا هذا يمرّ على localhost دائماً لأن الملفّات تصل قبل أوّل رسم،
     فلا يقع السباق أصلاً ويشهد الفحصُ لشيءٍ لم يختبره. والتأخير يجعل
     السباق حتمياً على أيّ مضيف، فيصير الفشلُ دليلاً والنجاحُ دليلاً.
     ويُطبَّق على الملفّات التي يعتمدها الترتيب وحدها. */
  const LAG = 1400;
  await page.route(/(strategies|strategy-edge|fundamentals|wide).json/, async (route) => {
    await new Promise(r => setTimeout(r, LAG));
    await route.continue();
  });
  await page.goto(URL_ + "?fresh=" + Date.now(), { waitUntil: "domcontentloaded" });

  /* ١) الشيفرة المنشورة = شيفرة القرص */
  const FILES = ["index.html", "scans.js", "strategies.js", "consensus.js", "confluence.js",
                 "direction.js", "indicators.js", "score.js", "plan.js", "sw.js"];
  const base = URL_.replace(/\/?$/, "/");
  const mismatch = [];
  for (const f of FILES) {
    const local = path.join(ROOT, "stocks", f);
    if (!existsSync(local)) continue;
    const res = await page.request.get(base + f + "?x=" + Date.now());
    const remote = createHash("sha256").update(Buffer.from(await res.body())).digest("hex").slice(0, 12);
    /* نهاياتُ الأسطر تختلف بين القرص والمستودع على ويندوز، فتُطبَّع
       قبل المقارنة: الفارق الذي يهمّ فارقُ محتوى لا فارقُ CRLF. */
    const norm = (b) => createHash("sha256").update(String(b).replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);
    if (norm(readFileSync(local)) !== norm(await res.text())) mismatch.push(f + " (منشور " + remote + " · محلّي " + sha(local) + ")");
  }
  mismatch.length
    ? no("الشيفرة المنشورة هي شيفرة القرص", mismatch.join(" · "))
    : ok("الشيفرة المنشورة هي شيفرة القرص", FILES.length + " ملفّاً");

  /* ٢) القائمة لا تتبدّل بين أوّل رسمٍ واستقرار التحميل */
  await page.waitForFunction(() => typeof SCANS !== "undefined" && window.__ready !== false, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForFunction(() => { try { return !!(state && state.summary && state.summary.rows.length); } catch { return false; } }, null, { timeout: 30000 });

  const shot = async () => page.evaluate(() => {
    const o = {};
    for (const sc of SCANS) {
      state.scan = sc.id; renderScreen();
      const el = document.querySelector("#scanList");
      o[sc.id] = (state.lastScanRows || []).map(r => r.s + "/" + (r._conf ? Math.round(r._conf.q * 100) : "-"));
      o["__" + sc.id] = el ? el.children.length : -1;
    }
    return o;
  });

  await page.evaluate(() => go("screen"));

  /* **القياس هو ما يراه المستخدم**: هيكلُ التحميل ليس قائمة، فمقارنتُه
     بالقائمة تقيس وصول البيانات لا ثباتها. الشرط الصحيح: من اللحظة
     التي تظهر فيها صفوفٌ للمستخدم، لا تتغيّر تلك الصفوف بعدها —
     ترتيباً ولا عضويةً ولا درجةً.

     ولذلك لكلّ مسحٍ انتظارٌ حتى يخرج من حالة التحميل، ثم لقطةٌ، ثم
     لقطةٌ ثانية بعد استقرارٍ كامل. */
  const firstVisible = {};
  for (const id of await page.evaluate(() => SCANS.map(s => s.id))) {
    await page.evaluate((i) => { state.scan = i; renderScreen(); }, id);
    await page.waitForFunction(() => {
      const el = document.querySelector("#scanList");
      return !!el && !el.querySelector(".skl");
    }, null, { timeout: 15000 }).catch(() => {});
    firstVisible[id] = await page.evaluate((i) => {
      state.scan = i; renderScreen();
      return (state.lastScanRows || []).map(r => r.s + "/" + (r._conf ? Math.round(r._conf.q * 100) : "-"));
    }, id);
  }
  await page.waitForTimeout(4000);
  const settled = await page.evaluate(() => {
    const o = {};
    for (const sc of SCANS) { state.scan = sc.id; renderScreen();
      o[sc.id] = (state.lastScanRows || []).map(r => r.s + "/" + (r._conf ? Math.round(r._conf.q * 100) : "-")); }
    return o;
  });

  const moved = [];
  for (const k of Object.keys(firstVisible)) {
    const a = firstVisible[k], b = settled[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    let n = 0; const pos = {}; b.forEach((x, i) => pos[x.split("/")[0]] = i);
    a.forEach((x, i) => { const j = pos[x.split("/")[0]]; if (j !== undefined && j !== i) n++; });
    moved.push(`${k}: ${a.length}→${b.length} صفّاً · ${n} تغيّر ترتيبه`);
  }
  moved.length
    ? no("ما يراه المستخدم لا يتبدّل بعد ظهوره", moved.join(" · "))
    : ok("ما يراه المستخدم لا يتبدّل بعد ظهوره", Object.keys(firstVisible).length + " مسحاً · لا ترتيبَ ولا عضويةَ ولا درجة");

  /* ٣) تذبذب السعر اللحظي لا يحرّك القائمة */
  const px = await page.evaluate(() => {
    const snap = () => { const o = {}; for (const sc of SCANS) { state.scan = sc.id; renderScreen(); o[sc.id] = (state.lastScanRows || []).map(r => r.s); } return o; };
    const rows = state.summary.rows.concat((state.wide && state.wide.rows) || []);
    const A = snap();
    const bak = rows.map(r => [r.p, r.vol, r.chg]);
    rows.forEach(r => { if (isFinite(r.p)) r.p *= 1.006; if (isFinite(r.vol)) r.vol *= 1.4; if (isFinite(r.chg)) r.chg += 0.6; });
    const B = snap();
    rows.forEach((r, i) => { r.p = bak[i][0]; r.vol = bak[i][1]; r.chg = bak[i][2]; });
    const C = snap();
    return Object.keys(A).filter(k => JSON.stringify(A[k]) !== JSON.stringify(B[k]) || JSON.stringify(A[k]) !== JSON.stringify(C[k]));
  });
  px.length ? no("تذبذب السعر اللحظي لا يحرّك القائمة", px.join(" · "))
            : ok("تذبذب السعر اللحظي لا يحرّك القائمة", "11 مسحاً · ‎±0.6%‎ سعراً و‎+40%‎ حجماً");

  /* ٤) لا استثناء في الصفحة */
  const real = errs.filter(e => !/favicon|manifest|404/i.test(e));
  real.length ? no("لا استثناء في الصفحة المنشورة", real.slice(0, 3).join(" | "))
              : ok("لا استثناء في الصفحة المنشورة");

  const diag = await page.evaluate(() => { try { return (state.diag || []).length; } catch { return -1; } });
  diag > 0 ? no("سجلّ التشخيص فارغ", diag + " قيداً") : ok("سجلّ التشخيص فارغ");

} finally { await browser.close(); }

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
process.exit(fail ? 1 : 0);
