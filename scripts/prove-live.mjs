/* =====================================================================
   إثباتٌ مباشرٌ على الموقع المنشور — انتظارُ شمعةٍ جديدة ثم مقارنتان.

   لا محاكاة ولا بيانات مصنوعة ولا قراءةٌ من القرص. الخطوات كما طلبها
   المستخدم حرفاً:

     ١) استطلاع الموقع حتى **يظهر `candleKey` جديد** — أي حتى تُنشر
        لقطةُ الشمعة التي أُغلقت للتوّ.
     ٢) لقطةٌ أولى من **الصفحة المعروضة فعلاً** في متصفّحٍ حقيقي:
        كلُّ صفٍّ في كلِّ مسحٍ بدرجته ورتبته وتوافقه واتجاهه.
     ٣) انتظارٌ دقيقتين — داخل نفس الشمعة.
     ٤) **تحميلٌ جديد كاملاً** (عامل الخدمة مُلغى وذاكراته ممسوحة)
        ولقطةٌ ثانية.
     ٥) مقارنةٌ حقلاً بحقل، والمطلوب صفر اختلاف.

   ولماذا **تحميلٌ جديد** لا إعادةُ رسمٍ في نفس الصفحة: إعادةُ الرسم
   من حالةٍ محمَّلةٍ سلفاً تقيس ثباتَ الذاكرة لا ثباتَ النظام. أما
   التحميلُ من الصفر فيمرّ بالشبكة وبكل ملفٍّ من جديد — وهو ما يفعله
   المستخدم حين يفتح الموقع مرّتين.

   ويُطبع مع كلِّ لقطة: `candleKey` و`rowsHash` و`generatedAt` من
   اللقطة المنشورة، **وبصمةٌ مستقلّة للصفوف المعروضة** يحسبها هذا
   الفحص بنفسه من الـDOM — فلا يُصدّق ما يقوله الملفّ عن نفسه.

   يُشغَّل:  node scripts/prove-live.mjs [ثوانٍ بين اللقطتين=120]
            ‎--now‎ يبدأ فوراً بلا انتظار شمعةٍ جديدة
   ===================================================================== */
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";

const require = createRequire(import.meta.url);
const URL_ = process.argv.find(a => a.startsWith("http")) || "https://alkongrs2014.github.io/Alkongrs2014/stocks/";
const RAW = "https://raw.githubusercontent.com/Alkongrs2014/Alkongrs2014/data";
const GAP = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) || 120);
const NOW = process.argv.includes("--now");

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

async function head() {
  /* استعلامٌ مكسورُ الخزن: `raw.githubusercontent` يخزّن خمس دقائق،
     فبلا بادئةٍ متغيّرة يُقرأ نفس الملفّ ويُظنّ النظام ساكناً. */
  const r = await fetch(`${RAW}/opportunities.json?x=${Date.now()}`, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) return null;
  const j = await r.json();
  return { candleKey: j.candleKey, rowsHash: j.rowsHash, generatedAt: j.generatedAt, count: j.count };
}

/* =====================================================================
   قراءةُ ما يراه المستخدم — من الـDOM لا من `state`.

   `state.lastScanRows` كائناتٌ داخلية، والمستخدم يرى نصّاً. فالقراءة
   من الصفوف المرسومة تجعل الفحص يشهد للمعروض لا للمحسوب: لو كتب
   العرضُ رقماً غير الذي في اللقطة، انكشف هنا ولا ينكشف هناك.

   ولكلِّ صفٍّ خمسةٌ بالضبط هي ما سأل عنه المستخدم:
     الرتبة (موضعه) · الرمز (العضوية) · الدرجة · التوافق · الاتجاه
   ===================================================================== */
async function shot(ctx, label) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e.message)));

  /* تحميلٌ نظيفٌ إلزاماً: عاملُ الخدمة يعترض قبل ترويسات HTTP، فنسخةٌ
     مخزَّنة تجعل اللقطتين نفسَ الصفحة — فيمرّ الفحص بلا أن يختبر شيئاً. */
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  await page.goto(URL_ + "?prove=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => { try { return !!(state && state.summary && state.summary.rows.length && typeof SCANS !== "undefined"); } catch { return false; } },
    null, { timeout: 60000 });
  await page.evaluate(() => go("screen"));
  await page.waitForFunction(() => !!(state.opps && state.opps.scans), null, { timeout: 60000 });

  const data = await page.evaluate(async () => {
    const out = { scans: {}, meta: null };
    const o = state.opps;
    out.meta = { candleKey: o.candleKey, rowsHash: o.rowsHash, generatedAt: o.generatedAt, count: o.count };
    for (const sc of SCANS) {
      state.scan = sc.id; renderScreen();
      await new Promise(r => setTimeout(r, 0));
      const rows = [...document.querySelectorAll("#scanList .srow")];
      out.scans[sc.id] = rows.map((el, i) => {
        const sym = el.getAttribute("data-open") || "";
        const rankTxt = (el.querySelector(".rank") || {}).textContent || "";
        const hitv = (el.querySelector(".hitv") || {}).textContent || "";
        const gradeM = hitv.match(/درجة\s*([\d٠-٩,،]+)/);
        const grade = gradeM ? gradeM[1].replace(/[^\d]/g, "") : "";
        /* سطرُ التوافق ثلاثُ حالات: متعارضة · منفردة · توافق/تعارض N.
           والاتجاه يُقرأ من الوسم نفسه: «توافق» صعودٌ و«تعارض» هبوط. */
        const nodes = [...el.querySelectorAll(".id .n")].map(n => n.textContent.replace(/\s+/g, " ").trim());
        const cLine = nodes.find(t => /متعارضة|منفردة|توافق|تعارض/.test(t)) || "";
        return { i, sym, rank: rankTxt.replace(/\s+/g, ""), grade, conf: cLine,
                 val: hitv.replace(/درجة[\s\S]*$/, "").replace(/\s+/g, " ").trim() };
      });
    }
    return out;
  });
  await page.close();
  const canon = Object.keys(data.scans).sort().map(id =>
    id + ";" + data.scans[id].map(r => [r.i, r.sym, r.grade, r.conf, r.val].join("|")).join(";")
  ).join("\n");
  let n = 0; for (const id of Object.keys(data.scans)) n += data.scans[id].length;
  console.log(`  ${label} · ${hhmmss()} · شمعة ${iso(data.meta.candleKey)} · بصمة الملفّ ${data.meta.rowsHash}` +
              ` · بصمة المعروض ${h12(canon)} · ${n} صفّاً معروضاً` + (errs.length ? ` · ${errs.length} استثناء` : ""));
  return { data, canon, domHash: h12(canon), errs, n };
}

function compare(a, b) {
  const ids = [...new Set([...Object.keys(a.data.scans), ...Object.keys(b.data.scans)])].sort();
  const rows = [];
  let totalRows = 0, diffs = 0;
  for (const id of ids) {
    const x = a.data.scans[id] || [], y = b.data.scans[id] || [];
    totalRows += x.length;
    const sx = x.map(r => r.sym).join(","), sy = y.map(r => r.sym).join(",");
    const gx = x.map(r => r.grade).join(","), gy = y.map(r => r.grade).join(",");
    const cx = x.map(r => r.conf).join("‖"), cy = y.map(r => r.conf).join("‖");
    const vx = x.map(r => r.val).join("‖"),  vy = y.map(r => r.val).join("‖");
    const bad = [];
    if (x.length !== y.length) bad.push(`العدد ${x.length}→${y.length}`);
    if (sx !== sy) bad.push("العضوية/الرتبة");
    if (gx !== gy) bad.push("الدرجة");
    if (cx !== cy) bad.push("التوافق/الاتجاه");
    if (vx !== vy) bad.push("قيمة المسح");
    if (bad.length) diffs++;
    rows.push({ id, n: x.length, ok: !bad.length, bad });
  }
  return { rows, totalRows, diffs };
}

console.log(`\n▶ إثباتٌ مباشرٌ على الموقع المنشور\n  ${URL_}\n`);

/* ══ ١) الانتظار حتى يظهر مفتاحٌ جديد ══ */
let startKey = null;
if (!NOW) {
  const first = await head();
  if (!first) { console.error("✗ تعذّر قراءة اللقطة المنشورة"); process.exit(1); }
  startKey = first.candleKey;
  console.log(`  المفتاح الحالي ${iso(startKey)} · بصمة ${first.rowsHash} — أنتظر شمعةً جديدة…`);
  const deadline = Date.now() + 22 * 60000;     // شمعةٌ واحدة وهامش
  let seen = null;
  while (Date.now() < deadline) {
    await sleep(20000);
    const h = await head();
    if (h && h.candleKey > startKey) { seen = h; break; }
  }
  if (!seen) { console.error("\n✗ لم يظهر مفتاحٌ جديد خلال 22 دقيقة — تحقّق من الجدولة والنشر\n"); process.exit(1); }
  console.log(`  ✔ ظهر مفتاحٌ جديد ${iso(seen.candleKey)} · بصمة ${seen.rowsHash} · بُنيت ${new Date(seen.generatedAt).toISOString().slice(11, 19)}Z`);
  startKey = seen.candleKey;
} else {
  const h = await head();
  startKey = h && h.candleKey;
  console.log(`  البدء فوراً · المفتاح ${iso(startKey)}`);
}

console.log("");
const browser = await chromium.launch({ headless: true });
let code = 0;
try {
  const ctx1 = await browser.newContext();
  const A = await shot(ctx1, "لقطة ١");
  await ctx1.close();

  console.log(`  … انتظار ${GAP} ثانية داخل نفس الشمعة …`);
  await sleep(GAP * 1000);

  const ctx2 = await browser.newContext();   // سياقٌ جديد: لا ذاكرةَ مشتركة
  const B = await shot(ctx2, "لقطة ٢");
  await ctx2.close();

  console.log("");
  /* شرطٌ مسبق: اللقطتان داخل نفس الشمعة — وإلا فالمقارنة بلا معنى */
  if (A.data.meta.candleKey !== B.data.meta.candleKey) {
    console.log(`  ⚠ عبرت اللقطتان حدَّ شمعة (${iso(A.data.meta.candleKey)} → ${iso(B.data.meta.candleKey)})`);
    console.log(`     اختلافٌ هنا مشروع. أعِد التشغيل بفاصلٍ أقصر أو مباشرةً بعد ظهور المفتاح.\n`);
    process.exit(2);
  }

  const cmp = compare(A, B);
  console.log(`  مقارنةُ ${cmp.rows.length} مسحاً · ${cmp.totalRows} صفّاً — الحقول: الرتبة · العضوية · الدرجة · التوافق · الاتجاه · قيمة المسح\n`);
  const w = Math.max(...cmp.rows.map(r => r.id.length));
  for (const r of cmp.rows)
    console.log(`    ${r.ok ? "✓" : "✗"} ${r.id.padEnd(w)} ${String(r.n).padStart(4)} صفّاً` +
                (r.ok ? "  مطابق 100%" : "  اختلف: " + r.bad.join(" · ")));

  console.log("");
  const sameFile = A.data.meta.rowsHash === B.data.meta.rowsHash;
  const sameDom = A.domHash === B.domHash;
  console.log(`    بصمة الملفّ:   ${A.data.meta.rowsHash} ${sameFile ? "=" : "≠"} ${B.data.meta.rowsHash}`);
  console.log(`    بصمة المعروض:  ${A.domHash} ${sameDom ? "=" : "≠"} ${B.domHash}`);
  const errs = A.errs.length + B.errs.length;
  console.log(`    استثناءات الصفحة: ${errs}`);

  const okAll = cmp.diffs === 0 && sameFile && sameDom && errs === 0 && A.n > 0;
  console.log(`\n${okAll ? "✔ مطابقة 100% داخل شمعة " + iso(A.data.meta.candleKey) : "✗ وُجد اختلاف"}\n`);
  code = okAll ? 0 : 1;
} finally { await browser.close(); }
process.exit(code);
