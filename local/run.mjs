#!/usr/bin/env node
/* =====================================================================
   مشغّل محلي — يقوم بما كانت تقوم به مهام GitHub Actions، لكن على جهازك.

   الفرق الجوهري ليس الراحة بل الشبكة: Yahoo يحظر عناوين مزوّدي السحابة
   (رينرات GitHub تحديداً ترجع 429 على كل طلب)، بينما لا يحظر الشبكات
   المنزلية. فمن جهازك يصير Yahoo متاحاً ومجانياً وبلا سقف يومي، وتسقط
   الحاجة لميزانية الطلبات ولحصة Twelve Data.

   الاستخدام:
     node local/run.mjs market     أسعار وشموع + أخبار (شغّلها كل 10 دقائق)
     node local/run.mjs news       الأخبار وحدها (سريعة)
     node local/run.mjs daily      أساسيات وترتيب (مرة يومياً)
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

/* ---------- تشغيل سكربت الجلب كعملية منفصلة ---------- */
function runScript(name) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, "scripts", name), "--out", DATA], {
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
    if (!file) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("غير موجود"); }
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
  fs.cpSync(DATA, stage, { recursive: true });

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
  const jobs = cmd === "market" ? ["fetch-market.mjs", "fetch-news.mjs"]
             : cmd === "news"   ? ["fetch-news.mjs"]
             : cmd === "daily"  ? ["fetch-daily.mjs"]
             : ["fetch-daily.mjs", "fetch-market.mjs", "fetch-news.mjs"];

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
