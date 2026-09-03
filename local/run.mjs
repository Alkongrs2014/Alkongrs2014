#!/usr/bin/env node
/* =====================================================================
   مشغّل محلي — يقوم بما كانت تقوم به مهام GitHub Actions، لكن على جهازك.

   الفرق الجوهري ليس الراحة بل الشبكة: Yahoo يحظر عناوين مزوّدي السحابة
   (رينرات GitHub تحديداً ترجع 429 على كل طلب)، بينما لا يحظر الشبكات
   المنزلية. فمن جهازك يصير Yahoo متاحاً ومجانياً وبلا سقف يومي، وتسقط
   الحاجة لميزانية الطلبات ولحصة Twelve Data.

   الاستخدام:
     node local/run.mjs market     أسعار وشموع (شغّلها كل 10 دقائق)
     node local/run.mjs daily      أساسيات وترتيب وأخبار (مرة يومياً)
     node local/run.mjs both       الاثنان بالترتيب
     node local/run.mjs serve      خادم محلي لعرض الموقع
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
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

/* ---------- التشغيل ---------- */
const cmd = (process.argv[2] || "both").toLowerCase();
const loaded = loadEnv();
fs.mkdirSync(DATA, { recursive: true });

if (cmd === "serve") { serve(); }
else {
  console.log(`▶ وضع محلي · Yahoo أولاً (بلا حظر ولا سقف) · ${loaded} متغيّراً من .env`);
  if (!process.env.FINNHUB_API_KEY)
    console.warn("  ⚠ FINNHUB_API_KEY غير مضبوط — ستُجلب الأسعار من الشموع بدل السعر اللحظي");

  const jobs = cmd === "market" ? ["fetch-market.mjs"]
             : cmd === "daily"  ? ["fetch-daily.mjs"]
             : ["fetch-daily.mjs", "fetch-market.mjs"];

  let bad = 0;
  for (const j of jobs) {
    console.log(`\n──── ${j} ────`);
    const code = await runScript(j);
    if (code !== 0) { bad++; console.error(`  ✗ ${j} انتهى برمز ${code}`); }
  }
  console.log(bad ? `\n✗ فشل ${bad} من ${jobs.length}` : `\n✔ تم — البيانات في ${DATA}`);
  process.exit(bad ? 1 : 0);
}
