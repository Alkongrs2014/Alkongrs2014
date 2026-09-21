/* =====================================================================
   اختبار قبولٍ على **الموقع المنشور** — لا على القرص ولا على المحاكاة.

   لماذا يلزم رغم ثمانيةٍ وثمانين فحصاً محلّياً ناجحاً: ثلاث عللٍ
   متتالية مرّت منها كلِّها ووصلت المستخدم. وسببُها واحد — الفحص
   المحلّي يشهد للمنطق، والمستخدم يرى **الصفحة المنشورة بعد أن يمرّ
   عليها عاملُ الخدمة والشبكة وترتيبُ وصول الملفّات الكسولة**. والعلّتان
   الأخيرتان عاشتا في هذه الفجوة بالضبط: البيانات ثابتة والشيفرة
   صحيحة، والمعروضُ يتبدّل لأن ملفّاً يصل بعد الرسم.

   يفحص ما لا يستطيع أيُّ فحصٍ في Node أن يفحصه:
   ١) أن الشيفرة المنشورة هي شيفرة القرص (لا نسخةَ عاملِ خدمةٍ قديمة).
   ٢) أن قائمة الفرص لا تتبدّل بعد أن تظهر للمستخدم.
   ٣) أن تذبذب السعر اللحظي لا يحرّك القائمة.
   ٤) أن اتجاه الإجماع لا ينقلب بوصول ملفّ الحوافّ.
   ٥) صفرُ استثناءٍ وصفرُ قيدٍ في سجلّ التشخيص.

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
for (const c of CANDS) { try { chromium = require(c).chromium; break; } catch { /* المرشّح التالي */ } }
if (!chromium) {
  console.error("✗ Playwright غير مركَّب. ركّبه: cd ~/.claude/skills/playwright-skill && npm run setup");
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (m, d) => { pass++; console.log(`  ✓ ${m}${d ? " — " + d : ""}`); };
const no = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? " — " + d : ""}`); };
const h12 = (x) => createHash("sha256").update(x).digest("hex").slice(0, 12);

/* =====================================================================
   التأخير الصناعيّ — **شرطُ أن يكون الفحص حاسماً**، ومتفاوتٌ لا موحَّد.

   بلا تأخيرٍ أصلاً يمرّ الفحص على localhost دائماً لأن الملفّات تصل
   قبل أوّل رسم، فلا يقع السباق ويشهد الفحصُ لشيءٍ لم يختبره.

   وبتأخيرٍ موحَّد يصل الملفّان معاً فلا يقع سباقُ **الحوافّ** بعينه —
   وهو أن تصل اللقطة أولاً فيُحسب إجماعٌ بأوزانٍ محايدة، ثم تصل
   الحوافُّ فيُعاد بأوزانه. أُثبت أن الفحص كان يمرّ بتأخيرٍ موحَّد حتى
   بعد تعطيل الحارس. فالحوافُّ أبطأُ الأربعة عمداً.
   ===================================================================== */
const LAG = {
  /* اللقطة أبطأُ ما يُنتظر: هي القائمة نفسها، وتأخيرُها يختبر أن
     الواجهة تعرض هيكلاً ولا تخترع ترتيباً مؤقّتاً. */
  "opportunities.json": 1900,
  "strategies.json":     700,
  "fundamentals.json":  1400,
  "wide.json":          1400,
  "strategy-edge.json": 2600
};
const lagRoute = async (route) => {
  const u = route.request().url();
  const k = Object.keys(LAG).find(f => u.includes(f));
  if (k) await new Promise(r => setTimeout(r, LAG[k]));
  await route.continue();
};

const FILES = ["index.html", "scans.js", "strategies.js", "consensus.js", "confluence.js",
               "direction.js", "indicators.js", "score.js", "plan.js", "sw.js", "session.js", "evaluate.js"];

console.log("\n▶ اختبار قبول على الموقع المنشور\n  " + URL_ + "\n");

const browser = await chromium.launch({ headless: true });
try {
  const base = URL_.replace(/\/?$/, "/");
  const ctx = await browser.newContext();

  /* عاملُ الخدمة يقدّم نسخةً مخزَّنة حتى مع `no-store` — اعتراضُه يسبق
     ترويسات HTTP. فبلا إلغائه يشهد الفحص لنسخةٍ قديمة ويمرّ كذباً. */
  {
    const p = await ctx.newPage();
    await p.goto(base, { waitUntil: "domcontentloaded" });
    await p.evaluate(async () => {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
    });
    await p.close();
  }

  const errs = [];
  const page = await ctx.newPage();
  page.on("pageerror", e => errs.push(String(e.message)));
  page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });
  await page.route(/(opportunities|strategies|strategy-edge|fundamentals|wide)\.json/, lagRoute);
  await page.goto(base + "?fresh=" + Date.now(), { waitUntil: "domcontentloaded" });

  /* ══ ١) الشيفرة المنشورة = شيفرة القرص ══
     نهاياتُ الأسطر تختلف بين القرص والمستودع على ويندوز، فتُطبَّع قبل
     المقارنة: الفارق الذي يهمّ فارقُ محتوى لا فارقُ CRLF. */
  const mismatch = [];
  for (const f of FILES) {
    const local = path.join(ROOT, "stocks", f);
    if (!existsSync(local)) continue;
    const res = await page.request.get(base + f + "?x=" + Date.now());
    const a = h12(readFileSync(local, "utf8").replace(/\r\n/g, "\n"));
    const b = h12((await res.text()).replace(/\r\n/g, "\n"));
    if (a !== b) mismatch.push(`${f} (محلّي ${a} · منشور ${b})`);
  }
  mismatch.length
    ? no("الشيفرة المنشورة هي شيفرة القرص", mismatch.join(" · "))
    : ok("الشيفرة المنشورة هي شيفرة القرص", FILES.length + " ملفّاً");

  await page.waitForFunction(
    () => { try { return !!(state && state.summary && state.summary.rows.length && typeof SCANS !== "undefined"); } catch { return false; } },
    null, { timeout: 45000 });

  /* ══ ٢) ما يراه المستخدم لا يتبدّل بعد ظهوره ══
     هيكلُ التحميل ليس قائمة، فمقارنتُه بالقائمة تقيس وصول البيانات لا
     ثباتها. الشرط المنضبط: من اللحظة التي تظهر فيها صفوف، لا تتغيّر
     تلك الصفوف بعدها — ترتيباً ولا عضويةً ولا درجة. */
  await page.evaluate(() => go("screen"));
  const firstVisible = {};
  for (const id of await page.evaluate(() => SCANS.map(s => s.id))) {
    await page.evaluate((i) => { state.scan = i; renderScreen(); }, id);
    await page.waitForFunction(() => {
      const el = document.querySelector("#scanList");
      return !!el && !el.querySelector(".skl");
    }, null, { timeout: 20000 }).catch(() => { /* المهلة العليا — تُقاس كما هي */ });
    firstVisible[id] = await page.evaluate((i) => {
      state.scan = i; renderScreen();
      return (state.lastScanRows || []).map(r => r.s + "/" + (Number.isFinite(r.q) ? Math.round(r.q * 100) : "-"));
    }, id);
  }
  await page.waitForTimeout(4500);
  const settled = await page.evaluate(() => {
    const o = {};
    for (const sc of SCANS) {
      state.scan = sc.id; renderScreen();
      o[sc.id] = (state.lastScanRows || []).map(r => r.s + "/" + (Number.isFinite(r.q) ? Math.round(r.q * 100) : "-"));
    }
    return o;
  });
  const moved = [];
  for (const k of Object.keys(firstVisible)) {
    const a = firstVisible[k], b = settled[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const pos = {}; b.forEach((x, i) => { pos[x.split("/")[0]] = i; });
    let n = 0;
    a.forEach((x, i) => { const j = pos[x.split("/")[0]]; if (j !== undefined && j !== i) n++; });
    moved.push(`${k}: ${a.length}→${b.length} صفّاً · ${n} تغيّر ترتيبه`);
  }
  moved.length
    ? no("ما يراه المستخدم لا يتبدّل بعد ظهوره", moved.join(" · "))
    : ok("ما يراه المستخدم لا يتبدّل بعد ظهوره", Object.keys(firstVisible).length + " مسحاً · لا ترتيبَ ولا عضويةَ ولا درجة");

  /* ══ ٣) تذبذب السعر اللحظي لا يحرّك القائمة ══ */
  const px = await page.evaluate(() => {
    const snap = () => {
      const o = {};
      for (const sc of SCANS) { state.scan = sc.id; renderScreen(); o[sc.id] = (state.lastScanRows || []).map(r => r.s); }
      return o;
    };
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
            : ok("تذبذب السعر اللحظي لا يحرّك القائمة", "11 مسحاً · ±0.6% سعراً و+40% حجماً");

  /* ══ ٣ب) اللقطة ذرّية: بصمتُها ومفتاحُها وتطابقُ المعروض معها ══
     ثلاثةُ أسئلة لا سؤال: هل الصفوف المعروضة **هي** صفوف اللقطة؟ وهل
     البصمة المحفوظة تطابق الصفوف فعلاً (فلا تشهد لنفسها)؟ وهل مفتاح
     الشمعة ربعُ ساعةٍ صحيح؟ */
  const snap = await page.evaluate(() => {
    const o = state.opps;
    if (!o) return { missing: true };
    const shown = {};
    for (const sc of SCANS) {
      state.scan = sc.id; renderScreen();
      shown[sc.id] = (state.lastScanRows || []).map(r => r.s + "/" + Math.round(r.q * 100));
    }
    const fromSnap = {};
    for (const id of Object.keys(o.scans)) fromSnap[id] = o.scans[id].map(r => r.s + "/" + Math.round(r.q * 100));
    const mism = Object.keys(fromSnap).filter(k => JSON.stringify(fromSnap[k]) !== JSON.stringify(shown[k] || []));
    return { missing: false, candleKey: o.candleKey, rowsHash: o.rowsHash,
             strategyVersion: o.strategyVersion, count: o.count,
             canon: (typeof oppsCanon === "function") ? oppsCanon(o.scans) : null,
             mism };
  });
  if (snap.missing) no("لقطة الفرص موجودة ومقروءة");
  else {
    snap.mism.length
      ? no("المعروض هو صفوف اللقطة بالحرف", snap.mism.join(" · "))
      : ok("المعروض هو صفوف اللقطة بالحرف", Object.keys(snap.mism).length === 0 ? "11 مسحاً" : "");
    const q = snap.candleKey % 900;
    q === 0 ? ok("مفتاح الشمعة على حدّ ربع ساعة", new Date(snap.candleKey * 1000).toISOString().slice(0, 16) + "Z")
            : no("مفتاح الشمعة على حدّ ربع ساعة", "باقٍ " + q + " ثانية");
    if (snap.canon) {
      const h = createHash("sha256").update(snap.canon).digest("hex").slice(0, 12);
      h === snap.rowsHash ? ok("البصمة المحفوظة تطابق الصفوف فعلاً", h)
                          : no("البصمة المحفوظة تطابق الصفوف فعلاً", `محفوظة ${snap.rowsHash} · محسوبة ${h}`);
    }
  }

  /* ══ ٤) اتجاه الإجماع لا ينقلب بوصول ملفّ الحوافّ ══
     **صفحةٌ جديدة إلزاماً**: الصفحة أعلاه استُهلك فيها التأخير فصار
     الملفّان محمَّلين، فقراءةٌ فيها تقيس حالةً واحدة مرّتين. والنافذة
     المقصودة بين وصول اللقطة ووصول الحوافّ ولا تُعاد فتحُها. */
  const p2 = await ctx.newPage();
  await p2.route(/(opportunities|strategies|strategy-edge|fundamentals|wide)\.json/, lagRoute);
  await p2.goto(base + "?dir=" + Date.now(), { waitUntil: "domcontentloaded" });
  await p2.waitForFunction(
    () => { try { return !!(state && state.summary && state.summary.rows.length); } catch { return false; } },
    null, { timeout: 45000 });
  const dirs = await p2.evaluate(async () => {
    const read = () => {
      const o = {};
      for (const r of state.summary.rows) {
        const sn = consSnapshot(r.s);
        o[r.s] = sn ? (sn.cons.dir + "/" + (sn.cons.mixed ? "m" : "-")) : "…";
      }
      return o;
    };
    await need("strategies.json");              // اللقطة وصلت
    await new Promise(r => setTimeout(r, 250));
    const first = read();                       // ...والحوافُّ لمّا تصل
    const shown = Object.values(first).filter(v => v !== "…").length;
    await need("strategy-edge.json");
    await new Promise(r => setTimeout(r, 600));
    const after = read();
    const flips = [];
    for (const k of Object.keys(first)) {
      if (first[k] === "…") continue;           // لم تُعرض جهة — ليس انقلاباً
      if (first[k] !== after[k]) flips.push(`${k}: ${first[k]} → ${after[k]}`);
    }
    return { shown, flips };
  });
  await p2.close();
  dirs.flips.length
    ? no("اتجاه الإجماع لا ينقلب بوصول ملفّ الحوافّ",
         `${dirs.flips.length} من ${dirs.shown} معروضاً · ${dirs.flips.slice(0, 5).join(" · ")}`)
    : ok("اتجاه الإجماع لا ينقلب بوصول ملفّ الحوافّ",
         dirs.shown ? `${dirs.shown} جهةً معروضة وكلُّها ثابتة` : "لا جهةَ تُعرض قبل اكتمال أوزانها");

  /* ══ ٥) لا استثناء ولا قيدَ تشخيص ══ */
  const real = errs.filter(e => !/favicon|manifest|404|Failed to load resource/i.test(e));
  real.length ? no("لا استثناء في الصفحة المنشورة", real.slice(0, 3).join(" | "))
              : ok("لا استثناء في الصفحة المنشورة");

  const diag = await page.evaluate(() => { try { return (state.diag || []).length; } catch { return -1; } });
  diag > 0 ? no("سجلّ التشخيص فارغ", diag + " قيداً") : ok("سجلّ التشخيص فارغ");

} finally { await browser.close(); }

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
process.exit(fail ? 1 : 0);
