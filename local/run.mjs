#!/usr/bin/env node
/* =====================================================================
   مشغّل محلي — يقوم بما كانت تقوم به مهام GitHub Actions، لكن على جهازك.

   الفرق الجوهري ليس الراحة بل الشبكة: Yahoo يحظر عناوين مزوّدي السحابة
   (رينرات GitHub تحديداً ترجع 429 على كل طلب)، بينما لا يحظر الشبكات
   المنزلية. فمن جهازك يصير Yahoo متاحاً ومجانياً وبلا سقف يومي، وتسقط
   الحاجة لميزانية الطلبات ولحصة Twelve Data.

   الاستخدام:
     node local/run.mjs quotes     أسعار فقط — سريعة (شغّلها كل دقيقتين)
     node local/run.mjs market     أسعار وشموع + أخبار (شغّلها كل 10 دقائق)
     node local/run.mjs news       الأخبار وحدها
     node local/run.mjs daily      أساسيات وترتيب + الأرشيف (مرة يومياً)
     node local/run.mjs options    عقود الخيارات (كل نصف ساعة)
     node local/run.mjs filings    إيداعات SEC (كل عشر دقائق، بلا مفتاح)
     node local/run.mjs backtest   الأرشيف التاريخي وحده
     node local/run.mjs signals    تثبيت إشارات اليوم وتحديث المفتوحة
     node local/run.mjs strategies ماسح الاستراتيجيات — الحالة والتسلسل (بلا شبكة)
     node local/run.mjs mdir       توجّه السوق — المؤشّر وأكبر الشركات (بلا شبكة)
     node local/run.mjs replay --date=YYYY-MM-DD --engine=new|old
                               إعادة تشغيل يومٍ دقيقةً دقيقة بلا نظرٍ إلى المستقبل
     node local/run.mjs audit  --date=YYYY-MM-DD
                               تقرير الفرص الفائتة: قديم مقابل جديد
     node local/run.mjs stratbt    الأرشيف اللحظي 60 يوماً (~290 طلباً)
     node local/run.mjs events     تقويم الفدرالي (أحداث قوية قادمة)
     node local/run.mjs learn      قراءة السجل واقتراحات التحسين (بلا شبكة)
     node local/run.mjs analytics  قوة نسبية وارتباط وفجوات (طلب واحد)
     node local/run.mjs both       الكل بالترتيب
     node local/run.mjs serve      خادم محلي لعرض الموقع
     node local/run.mjs publish    نشر البيانات المحلية على فرع data
     أضف ‎--publish‎ لأي أمر جلب لينشر بعده: ‎market --publish‎
   ===================================================================== */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const PORT = Number(process.env.PORT || 8080);

/* ---------- تحميل .env بلا أي تبعية خارجية ---------- */
function loadEnv() {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return 0;
  let n = 0;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (k && !(k in process.env)) { process.env[k] = v; n++; }
  }
  return n;
}

/* =====================================================================
   قفل التشغيل — مهمة واحدة في كل مرة.

   الدورات الثلاث تتشارك حصّة Finnhub نفسها (60 طلباً في الدقيقة)، وكل
   واحدة تستهلكها كاملةً تقريباً. تداخل دورة الأسعار مع دورة الشمعات
   يضاعف المعدّل فيبدأ المزوّد بالرفض — أي أن الجدولة الأكثف تعطي بيانات
   أقل لا أكثر. القفل يجعل المتأخّرة تنسحب بهدوء بدل أن تُفسد السابقة.
   ===================================================================== */
const LOCK = path.join(DATA, ".run.lock");

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

/* =====================================================================
   الانسحاب يُسجَّل — وإلا كان **نجاحاً كاذباً لا أثر له**.

   المنسحبة تخرج بصفر عمداً (انظر عند النداء)، فيسجّل المجدول «نجح»
   لتشغيلٍ لم يعمل. والنتيجة أن ثلاث شهادات تقول إن كل شيء سليم —
   المهمة نشطة، وآخر نتيجة ‎0x0‎، ولا سطر في أي سجل — بينما البيانات
   تتقادم. والدليل الوحيد فجوةُ زمنٍ في `meta.json` يجب أن ينتبه لها
   أحدٌ ويطرح التوقيتات بنفسه.

   وقع فعلاً بعد إصلاح الإزاحات: مهمة العقود ‎19:35‎ خرجت ‎rc=0‎ ولم
   تكتب، وآخر كتابةٍ ‎19:06‎ — أي أن دورة نصف الساعة صارت ساعة، ولا
   شيء يقول ذلك. فالإزاحات تُباعد بين البدايات وحدها، وهي تفترض أن كل
   مهمة تنتهي قبل بداية التالية: افتراضٌ يسقط كلما بطؤت الشبكة.

   فتُكتب كل محاولةٍ منسحبة في `.run.skips.json` بأطرافها الثلاثة — من
   انسحب، وأمام من، ومتى — فيصير السؤال «لماذا تقادمت العقود؟» قابلاً
   للإجابة في سطر. آخر خمسين وحدها: الملف تشخيصٌ لا أرشيف.
   ===================================================================== */
const SKIPS = path.join(DATA, ".run.skips.json");

function noteSkip(job, blocker, waited, outcome) {
  try {
    const all = JSON.parse(fs.readFileSync(SKIPS, "utf8"));
    const list = Array.isArray(all) ? all : [];
    list.push({ job, blocker, waited, outcome, at: Date.now() });
    fs.writeFileSync(SKIPS, JSON.stringify(list.slice(-50)));
  } catch (e) {
    try { fs.writeFileSync(SKIPS, JSON.stringify([{ job, blocker, waited, outcome, at: Date.now() }])); }
    catch (e2) { /* التشخيص لا يُسقط التشغيل */ }
  }
}

/* =====================================================================
   الانتظار بدل الانسحاب — والانسحاب حالةٌ قصوى لا قاعدة.

   كان الانسحاب هو القاعدة، فأعطى قياسُ 2026-09-14 **37 دورة أسعار
   ساقطة من ~113 في 3.8 ساعة** (‎33%‎): ثمانٍ وعشرون حجبتها دورة السوق
   وسبعٌ حجبتها دورة العقود. أي أن دورة الدقيقتين صارت ثلاث دقائق
   فعلياً — وهو ما لاحظه المستخدمون ووصفوه بـ«مشكلة بالثلاث دقائق».

   والانسحاب لم يكن يُصلح شيئاً: المهمة المحجوبة ليست خطراً على الحصّة
   ما دامت **تنتظر** انتهاء السابقة بدل أن تتوازى معها. والغرض الأصلي
   للقفل — ألّا تعمل مهمّتان معاً — يتحقّق بالانتظار كما يتحقّق
   بالانسحاب، والفارق أن الانتظار **ينفّذ العمل**.

   والسقف من دورة المهمة نفسها وأقلّ منها دائماً: انتظارٌ أطول من
   الدورة يجعل تشغيلين ينتظران نفس القفل فيتراكمان بلا نهاية.
   ===================================================================== */
const WAIT_CAP = {          // ثوانٍ — أقلّ من دورة كل مهمة
  quotes: 110, strategies: 110, signals: 110, mdir: 110,
  market: 540, filings: 240, news: 240,
  options: 1500,
  daily: 3000, backtest: 3000, stratbt: 3000
};

/* لماذا لا يُرفع سقف الأسعار فوق ‎110‎ رغم أن دورة السوق تتجاوزها:
   دورة الأسعار دقيقتان، فسقفٌ أطول يجعل تشغيلَين ينتظران القفل معاً
   فيتراكمان — وهو ما جاء السقف ليمنعه.

   والانسحاب هنا **ليس فجوة بيانات**: `fetch-market` يجلب أسعار كل
   الرموز داخل دورته (‎288‎ رمزاً في قياس 2026-09-15)، فالسعر يتجدّد
   من المهمة الحاجبة نفسها. فوسم `gave-up` أمام `market` معلومةُ
   تشخيص، والذي يستحقّ الانتباه هو انسحابٌ أمام مهمةٍ **لا تُسعّر**
   مثل `filings` أو `backtest`. */

/* نومٌ متزامن: الدالّة تُنادى قبل أي عمل غير متزامن، وحلقةُ انتظارٍ
   بـ await تقتضي جعل مسار الإقلاع كلّه غير متزامن بلا مقابل. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* حاملُ القفل الحيّ، أو null إن كان القفل ميتاً أو تالفاً.
   العملية قد تموت **أثناء انتظارنا**، فيُعاد الفحص في كل دورة استطلاع
   لا مرّةً واحدة عند الدخول. */
function lockHolder() {
  try {
    const prev = JSON.parse(fs.readFileSync(LOCK, "utf8"));
    // عملية ماتت دون تنظيف تترك قفلاً أبدياً، فنُسقطه بعد عشرين دقيقة
    if (Date.now() - prev.at < 20 * 60000 && alive(prev.pid)) return prev;
  } catch (e) { /* لا قفل، أو قفل تالف */ }
  return null;
}

/* الكتابة الذرّية: الوضع wx يفشل إن وُجد الملفّ، فلا تبقى فجوة بين
   «رأيتُه حرّاً» و«كتبتُ فيه» تسمح لتشغيلين بأخذه معاً. */
function tryWrite(job) {
  try {
    const fd = fs.openSync(LOCK, "wx");
    fs.writeSync(fd, JSON.stringify({ job, pid: process.pid, at: Date.now() }));
    fs.closeSync(fd);
    return true;
  } catch (e) { return false; }
}

function acquireLock(job) {
  const cap = (WAIT_CAP[job] ?? 120) * 1000;
  const t0 = Date.now();
  let announced = false;

  for (;;) {
    if (tryWrite(job)) {
      if (announced) {
        const sec = Math.round((Date.now() - t0) / 1000);
        console.log("  ▶ تحرّر القفل بعد " + sec + " ثانية — نبدأ");
        noteSkip(job, "—", sec, "queued");
      }
      return true;
    }

    const holder = lockHolder();
    const waited = Date.now() - t0;

    if (!holder) {
      // قفلٌ ميت أو تالف — نُزيله ونعاود المحاولة فوراً
      try { fs.unlinkSync(LOCK); continue; } catch (e) { /* سباقٌ مع غيرنا */ }
    } else if (!announced) {
      console.log("  ⏳ " + holder.job + " تعمل — ننتظر دورنا (سقف " + (cap / 1000) + " ثانية)");
      announced = true;
    }

    if (waited >= cap) {
      const who = holder ? holder.job : "قفل عالق";
      const age = holder ? Math.round((Date.now() - holder.at) / 1000) : 0;
      console.log("  ⏭ " + who + " ما زالت تعمل منذ " + age + " ثانية — انتهى سقف الانتظار، ننسحب");
      noteSkip(job, who, Math.round(waited / 1000), "gave-up");
      return false;
    }
    sleepSync(2000);
  }
}

const releaseLock = () => { try { fs.unlinkSync(LOCK); } catch (e) {} };

/* ---------- تشغيل سكربت الجلب كعملية منفصلة ---------- */
function runScript(name) {
  /* الاسم قد يحمل وسائط («track-strategies.mjs --only-price»): دورة
     الأسعار تشغّل نفس السكربت بوضعٍ آخر، وسكربتان لنفس المنطق يتباعدان. */
  const [file, ...extra] = String(name).split(/\s+/).filter(Boolean);
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, "scripts", file), "--out", DATA, ...extra], {
      stdio: "inherit",
      env: { ...process.env, PREFER_YAHOO: process.env.PREFER_YAHOO ?? "1" }
    });
    p.on("close", (code) => resolve(code));
  });
}

/* ---------- خادم ملفات ثابت ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"
};

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    // الموقع يقرأ من ./data، والصفحة نفسها في stocks/
    const candidates = [path.join(ROOT, "stocks", p), path.join(ROOT, p)];
    const file = candidates.find(f => f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile());
    // نطبع المسار المفقود: ‎404‎ صامتة في سجل المتصفح بلا مسار تكلّف
    // تشخيصاً في كل مرة — والخادم هو الموضع الوحيد الذي يعرفه.
    if (!file) {
      console.warn(`  404  ${p}`);
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("غير موجود");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store"          // البيانات تتغيّر كل تشغيل
    });
    fs.createReadStream(file).pipe(res);
  });
  // منفذ مشغول = غالباً نسخة سابقة ما زالت تعمل، لا عطل. الأثر الكامل
  // للاستثناء كان يُوهم بخطأ في الشيفرة ويخفي أن الموقع يعمل أصلاً.
  server.on("error", (e) => {
    if (e.code !== "EADDRINUSE") throw e;
    console.error(`\n  ✗ المنفذ ${PORT} مشغول — غالباً خادم سابق ما زال يعمل.`);
    console.error(`    جرّب فتح  http://localhost:${PORT}  أولاً،`);
    console.error(`    أو شغّل على منفذ آخر:  PORT=8081 node local/run.mjs serve\n`);
    process.exit(1);
  });
  server.listen(PORT, () => {
    console.log(`\n  ✔ الموقع يعمل على:  http://localhost:${PORT}\n`);
    console.log("  اترك هذه النافذة مفتوحة. للإيقاف: Ctrl+C\n");
  });
}

/* =====================================================================
   نشر البيانات المحلية على فرع data

   لماذا يلزم أصلاً: مهام GitHub تنتج بيانات ناقصة لا معطّلة. الأسعار
   تصل (Finnhub يعمل من السحابة) لكن الشموع لا تصل — Yahoo يرفض عناوين
   الرينرات، وميزانية Twelve Data المجانية تكفي أربعة عشر رمزاً في
   التشغيل الواحد من أصل سبعين. فيظهر الموقع المنشور بسعر اليوم وشارت
   ومؤشرات من شمعات عمرها أيام. الجهاز المنزلي لا يعاني هذا الحظر،
   فنشر بياناته هو ما يجعل الموقع المنشور بجودة المحلي.

   ننسخ إلى مجلد مؤقّت ثم ندفع منه: مستودع git داخل data/ نفسه يخلط
   بيانات متولّدة بحالة نسخ، وحذفه لاحقاً محفوف بالخطأ.
   ===================================================================== */
const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/* بوابة سلامة مطابقة لتلك التي في مهمة GitHub: لا تُنشر بيانات ناقصة
   فوق بيانات سليمة منشورة. */
function validateData() {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
  const sum = read("summary.json"), mkt = read("market.json");
  if (!Array.isArray(sum.rows) || sum.rows.length < 40)
    throw new Error(`summary.json فيه ${(sum.rows || []).length} صفاً فقط — مرفوض`);
  const bad = sum.rows.filter(r => !r.s || !Number.isFinite(r.p) || r.p <= 0);
  if (bad.length) throw new Error(`صفوف بأسعار غير صالحة: ${bad.map(b => b.s).join(", ")}`);
  if (!mkt.status) throw new Error("market.json بلا حالة سوق");
  const files = fs.readdirSync(path.join(DATA, "sym")).length;
  if (files < 40) throw new Error(`${files} ملف سهم فقط في data/sym — مرفوض`);
  const stale = sum.rows.filter(r => r.stale).length;
  return { rows: sum.rows.length, files, stale, updated: sum.updated };
}

function publish() {
  let info;
  try { info = validateData(); }
  catch (e) {
    console.error(`\n  ✗ البيانات المحلية لم تجتز فحص السلامة: ${e.message}`);
    console.error("    شغّل  node local/run.mjs both  أولاً، ولا تنشر قبل أن تمرّ.\n");
    return 1;
  }
  console.log(`  ✓ ${info.rows} صفاً · ${info.files} ملف سهم · ${info.stale} قديماً`);
  if (info.stale > info.rows / 2)
    console.warn("  ⚠ أكثر من نصف الرموز قديمة محلياً — الأفضل تحديثها قبل النشر");

  let url;
  try { url = git(["remote", "get-url", "origin"], ROOT); }
  catch { console.error("  ✗ لا يوجد ريموت origin — شغّل local/link-github.bat أولاً"); return 1; }

  const stage = path.join(os.tmpdir(), "webtrade-publish");
  fs.rmSync(stage, { recursive: true, force: true });

  /* ما لا يُنشر — قائمة **منع** لا قائمة سماح.
   *
   * قائمة السماح تُسقط أي ملف بيانات جديد **بصمت**: يُضاف مُنتَجٌ إلى
   * `data/` وتقرؤه الواجهة، فتجده 404 على الويب ولا شيء يقول لماذا.
   * وهو عطلٌ أسوأ بكثير من بضع مئات الكيلوبايتات.
   *
   * والثلاثة هنا حالةُ خادمٍ بحتة لا يقرؤها المتصفح إطلاقاً:
   *   `.run.lock`  ملف تشغيل — نشرُه دفعةٌ جديدة كل دورة لتغيّر رقم عملية
   *   `i18n.json`  ذاكرة الترجمة (430 ك.ب) — يقرؤها `fetch-news` وحده
   *   `cik.json`   خريطة CIK لـSEC (205 ك.ب) — يقرؤها `fetch-filings` وحده
   *
   * و`check-ui` يحرس القائمة: ملفٌ تشير إليه الواجهة لا يجوز أن يدخلها.
   */
  // `.run.skips.json` تشخيصٌ محلّي لجدولةِ هذا الجهاز — لا معنى له على
  // الويب، والموقع المنشور لا جدولة له أصلاً
  /* و`opportunities-log.json` سجلُّ تدقيقٍ لبوّابة اللقطة — يُقرأ عند
   التشخيص ولا تطلبه الواجهة. و`.opportunities.tmp.json` ملفُّ الكتابة
   الذرّية، ووجودُه عابر. */
  const NO_PUBLISH = new Set([".run.lock", ".run.skips.json", "i18n.json", "cik.json",
                              "opportunities-log.json", ".opportunities.tmp.json"]);
  let skipped = 0;
  for (const n of NO_PUBLISH) {
    if (n.startsWith(".run.")) continue;      // حالةُ خادمٍ لا حجمَ يُعلَن
    try { skipped += fs.statSync(path.join(DATA, n)).size; } catch {}
  }
  fs.cpSync(DATA, stage, { recursive: true, filter: (src) => !NO_PUBLISH.has(path.basename(src)) });
  if (skipped) console.log(`  ⤫ استُبعد ${Math.round(skipped / 1024)} ك.ب حالةَ خادمٍ لا يقرؤها المتصفح`);

  // اسم المؤلّف من إعدادات المستودع الأب إن وُجد، وإلا اسم محايد
  const cfg = (k, d) => { try { return git(["config", k], ROOT) || d; } catch { return d; } };

  try {
    git(["init", "-q", "-b", "snapshot"], stage);
    git(["config", "user.name", cfg("user.name", "webtrade-local")], stage);
    git(["config", "user.email", cfg("user.email", "local@webtrade")], stage);
    git(["remote", "add", "origin", url], stage);
    git(["add", "-A"], stage);
    const when = new Date().toISOString().slice(0, 16).replace("T", " ");
    git(["commit", "-q", "-m", `بيانات محلية ${when} UTC`], stage);
    // ‎-f‎ لأن الفرع يتيم يُعاد بناؤه كل مرة، تماماً كما تفعل مهمة GitHub
    git(["push", "-f", "-q", "origin", "snapshot:data"], stage);
  } catch (e) {
    const why = String(e.stderr || e.message || "").trim().slice(0, 400);
    console.error(`\n  ✗ فشل النشر: ${why}\n`);
    return 1;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }

  console.log(`\n  ✔ نُشرت على فرع data · آخر تحديث ${new Date(info.updated).toISOString()}`);
  console.log("    الموقع المنشور يقرأها خلال دقائق (raw.githubusercontent يخزّن مؤقتاً)\n");
  return 0;
}

/* ---------- التشغيل ---------- */
const argv = process.argv.slice(2);
const wantPublish = argv.includes("--publish");
const cmd = (argv.find(a => !a.startsWith("-")) || "both").toLowerCase();
const loaded = loadEnv();
fs.mkdirSync(DATA, { recursive: true });

if (cmd === "serve") { serve(); }
else if (cmd === "publish") { process.exit(publish()); }
else {
  console.log(`▶ وضع محلي · Yahoo أولاً (بلا حظر ولا سقف) · ${loaded} متغيّراً من .env`);
  if (!process.env.FINNHUB_API_KEY)
    console.warn("  ⚠ FINNHUB_API_KEY غير مضبوط — ستُجلب الأسعار من الشموع بدل السعر اللحظي");

  // الأخبار مع كل تحديث سوق: دورتها دقائق لا يوم، وهي أرخص جزء في
  // التشغيل (بضع خلاصات RSS) فلا تكلّف شيئاً أن تُرافق الأسعار
  const rest = process.argv.slice(3).filter(a => a !== "--publish");
  /* `build-opportunities` **يلي `track-strategies` مباشرةً في دورة
     السوق**، وهذا ليس ترتيباً اعتباطياً: بوّابتُه تشترط أن يصف
     `summary.json` و`strategies.json` الشمعةَ نفسها، وهما يتحقّقان
     بالضرورة حين يُكتبان في التشغيل الواحد من نفس الملفّات.

     وفي دورة الأسعار يُشغَّل أيضاً — ويُمسك في الغالب: `--only-price`
     يقدّم `confBar` كل دقيقتين بينما `cbar` ينتظر دورة السوق، فتفترق
     الشمعتان. والإمساك هو الصواب: الخطأ أن تُمزج شمعتان لا أن تتأخّر
     اللقطة. ووجودُه هناك يلتقط الحالة التي يصادف فيها التوافق. */
  const jobs = cmd === "quotes" ? ["fetch-quotes.mjs", "track-strategies.mjs --only-price", "build-opportunities.mjs"]
             // التتبّع بعد الشمعات مباشرة: يقرأ summary.json الذي كتبته
             // للتوّ، بلا أي طلب شبكة — فتُثبَّت الإشارة لحظة ظهورها
             : cmd === "market" ? ["fetch-market.mjs", "track-signals.mjs", "track-strategies.mjs", "build-opportunities.mjs", "market-direction.mjs", "fetch-news.mjs"]
             : cmd === "signals" ? ["track-signals.mjs"]
             : cmd === "opps" ? ["build-opportunities.mjs"]
             : cmd === "strategies" ? ["track-strategies.mjs", "build-opportunities.mjs", "market-direction.mjs"]
             /* توجّه السوق: بلا شبكة — يقرأ ملفات الرموز المكتوبة للتوّ.
                يلي `track-strategies` لا يسبقه: كلاهما يقرأ نفس الملفات،
                والترتيب يجعل السجلَّ يُثبَّت قبل أن يُقرأ للعرض. */
             : cmd === "mdir" ? ["market-direction.mjs"]
             // الأرشيف اللحظي: 60 يوماً من 15د لكل رمزٍ مرصود (~220
             // طلباً). نافذته أقصر بكثير من الأرشيف اليومي لأن ياهو لا
             // يعطي فريماً لحظياً أبعد من ذلك — وهو حدٌّ معلن لا خيار.
             : cmd === "stratbt" ? ["backtest-strategies.mjs"]
             /* إعادةُ التشغيل والتدقيق يأخذان وسائطَهما كما هي:
                `run.mjs replay --date=2026-09-14 --engine=new` */
             : cmd === "replay" ? ["replay.mjs " + rest.join(" ")]
             : cmd === "audit" ? ["audit-missed.mjs " + rest.join(" ")]
             : cmd === "news"   ? ["fetch-news.mjs"]
             // الأرشيف مع الدورة اليومية: يجلب خمس سنوات لكل رمز (~500
             // طلب) فلا مكان له في دورة عشر دقائق، ونتيجته لا تتغيّر
             // بمعدّل أسرع من يوم على أي حال
             : cmd === "daily"  ? ["fetch-daily.mjs", "fetch-events.mjs", "backtest.mjs", "backtest-strategies.mjs", "analytics.mjs", "learn.mjs"]
             : cmd === "events" ? ["fetch-events.mjs"]
             : cmd === "backtest" ? ["backtest.mjs"]
             : cmd === "learn"  ? ["learn.mjs"]
            : cmd === "analytics" ? ["analytics.mjs"]
             // الخيارات دورة نصف ساعة مستقلة: كل رمز يحتاج طلباً لكل
             // استحقاق، وسلسلة العقود لا تتغيّر بمعدّل الشمعة
             : cmd === "options" ? ["fetch-options.mjs"]
             // الإيداعات دورةٌ مستقلّة كذلك: تصل على مدار الساعة بوتيرةٍ لا
             // علاقة لها بدورة الأسعار، ولا تحتاج مفتاحاً ولا حصّة — فدمجُها
             // في دورة السوق يجعلها تتقاسم قفلاً وميزانيةً بلا سبب
             : cmd === "filings" ? ["fetch-filings.mjs"]
             : ["fetch-daily.mjs", "fetch-events.mjs", "fetch-market.mjs", "track-signals.mjs", "track-strategies.mjs", "market-direction.mjs", "fetch-news.mjs", "fetch-filings.mjs", "fetch-options.mjs", "backtest.mjs", "backtest-strategies.mjs", "analytics.mjs", "learn.mjs"];

  // `acquireLock` تنتظر دورها أولاً، ولا تصل هنا إلا بعد استنفاد سقف
  // الانتظار. والانسحاب حينها ليس فشلاً — نخرج بصفر حتى لا تُعلَّم المهمة
  // المجدولة كفاشلة، والسبب مكتوبٌ في `.run.skips.json` بوسم `gave-up`
  /* =====================================================================
     القفل يحمي **الكتابة على بيانات مشتركة**، ولا شأن له بالتحليل.

     `replay` و`audit` يقرآن ويكتبان في `data/replay/` و`data/audit/`
     وحدهما — لا يمسّان `summary.json` ولا ملفّات الرموز. فإخضاعهما
     للقفل يجعل تحليلاً يدويّاً ينتظر دورةَ جلبٍ ثم **ينسحب** بعد
     انتهاء السقف، فيُقرأ ذلك فشلاً في التحليل وهو ازدحامٌ على قفل.
     وقع فعلاً عند أوّل تجربة: «market تعمل — ننتظر دورنا» ثم انسحاب. */
  const READ_ONLY = ["replay", "audit"];
  if (!READ_ONLY.includes(cmd) && !acquireLock(cmd)) process.exit(0);
  process.on("exit", releaseLock);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { releaseLock(); process.exit(1); });

  let bad = 0;
  for (const j of jobs) {
    console.log(`\n──── ${j} ────`);
    const code = await runScript(j);
    if (code !== 0) { bad++; console.error(`  ✗ ${j} انتهى برمز ${code}`); }
  }
  console.log(bad ? `\n✗ فشل ${bad} من ${jobs.length}` : `\n✔ تم — البيانات في ${DATA}`);
  // النشر بعد الجلب وبشرط نجاحه: لا تُرفع نتيجة تشغيل فاشل فوق بيانات سليمة
  if (!bad && wantPublish) { console.log("\n──── نشر ────"); process.exit(publish()); }
  process.exit(bad ? 1 : 0);
}
