#!/usr/bin/env node
/* =====================================================================
   التحقّق من المنشور — `npm run verify`. الرابط الحقيقي على GitHub Pages.

   HTTP 200 ليس تحقّقاً. هنا:
     ١) النسخة المنشورة هي نسخة الالتزام: بصمةُ `sw.js` و`index.html` على
        Pages تطابق الملفّين المحلّيين (مع انتظار وصول النشر `--wait`).
     ٢) البيانات المنشورة (فرع data بالتزامه المحدَّد) تطابق مخطّطاتها،
        والمفتاحُ على شبكته، وحداثتُها معلنة.
     ٣) الواجهة الحيّة (بعد حجب عامل الخدمة): كلُّ شاشةٍ على سطح المكتب
        والهاتف بلا NaN/undefined ولا استثناء ولا طلبٍ حرج فاشل، ولا خلطٌ
        بين الدفترين — مجموعة Playwright نفسها بـ`E2E_BASE`.
     ٤) `check-live`: الشيفرة المنشورة = شيفرة القرص، والقائمة لا تتبدّل بعد
        ظهورها، وتذبذب السعر لا يحرّكها.
   ويكتب reports/verify-report.json.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/snapshot.mjs";
import { validateDoc } from "./lib/validate-schemas.mjs";
import { BOOK_SCHEMAS } from "../schemas/index.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(k + "=")); return a ? a.slice(k.length + 1) : d; };
const SITE = opt("--url", "https://alkongrs2014.github.io/Alkongrs2014/");
const WAIT = Number(opt("--wait", "0")) * 1000;
const REPO = "Alkongrs2014/Alkongrs2014";
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex").slice(0, 16);
const norm = (t) => t.replace(/\r\n/g, "\n");
const results = [];
const add = (id, ok, detail = "", sev = "CRITICAL") => { results.push({ id, ok: !!ok, sev, detail }); console.log(`${ok ? "✔" : sev === "CRITICAL" ? "✗" : "⚠"} ${id}${detail ? " — " + detail : ""}`); };
const get = async (u, ms = 20000) => { const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error("HTTP " + r.status + " " + u); return r.text(); };

/* ١) النسخة */
async function versionMatch() {
  const local = {};
  for (const f of ["sw.js", "index.html"]) local[f] = sha(norm(fs.readFileSync(path.join(ROOT, "stocks", f), "utf8")));
  const t0 = Date.now();
  for (;;) {
    let remote = {};
    try { for (const f of ["sw.js", "index.html"]) remote[f] = sha(norm(await get(`${SITE}stocks/${f}?v=${Date.now()}`))); }
    catch (e) { remote = { err: e.message }; }
    const ok = remote["sw.js"] === local["sw.js"] && remote["index.html"] === local["index.html"];
    if (ok || Date.now() - t0 >= WAIT) {
      add("version.deployed=local", ok, ok ? `sw ${local["sw.js"]} · index ${local["index.html"]}`
        : `المحلي ${JSON.stringify(local)} · المنشور ${JSON.stringify(remote)}`);
      return ok;
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
}

/* ٢) البيانات المنشورة */
async function dataCheck() {
  let dsha = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits/data`, { headers: { Accept: "application/vnd.github.sha" }, signal: AbortSignal.timeout(15000) });
    if (r.ok) dsha = (await r.text()).trim();
  } catch { /* يسقط إلى الفرع */ }
  const base = `https://raw.githubusercontent.com/${REPO}/${dsha || "data"}/`;
  const now = Date.now();
  for (const [book, sub] of [["stocks", ""], ["crypto", "crypto/"]]) {
    for (const f of ["summary.json", "opportunities.json", "strategies.json", "market.json"]) {
      try {
        const doc = JSON.parse(await get(base + sub + f));
        const e = validateDoc(BOOK_SCHEMAS[book][f], doc);
        add(`data.schema.${book}.${f}`, !e.length, e.slice(0, 2).join(" · "));
        if (f === "opportunities.json") {
          const grid = book === "stocks" ? 900 : 300;
          add(`data.grid.${book}`, doc.candleKey % grid === 0, "candleKey=" + doc.candleKey);
          const age = Math.round((now - doc.generatedAt) / 60000);
          /* الطزاجة تحذيرٌ لا حرج: توقّفُ الجهاز قيدُ بنيةٍ تحتية لا خللٌ في الحساب */
          add(`data.fresh.${book}`, age <= (book === "crypto" ? 30 : 60 * 72), `عمر اللقطة ${age} دقيقة`, "WARNING");
        }
      } catch (e) { add(`data.read.${book}.${f}`, false, e.message); }
    }
  }
  if (!dsha) add("data.sha", false, "تعذّر حلّ التزام فرع data عبر الواجهة", "WARNING");
  else add("data.sha", true, dsha.slice(0, 10), "INFO");
}

/* ٣) الواجهة الحيّة — نفس مجموعة Playwright */
function uiCheck() {
  const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["playwright", "test", "--reporter=line"],
    { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32", env: { ...process.env, E2E_BASE: SITE }, timeout: 900000, maxBuffer: 32 << 20 });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+) passed/), f = out.match(/(\d+) failed/);
  add("ui.playwright.live", r.status === 0, `${m ? m[1] : 0} نجح · ${f ? f[1] : 0} فشل`);
  if (r.status !== 0) console.log(out.split("\n").filter((l) => /✘|Error|expect/.test(l)).slice(0, 12).join("\n"));
}

/* ٤) check-live */
function liveCheck() {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/check-live.mjs"), SITE + "stocks/"],
    { cwd: ROOT, encoding: "utf8", timeout: 900000, maxBuffer: 32 << 20 });
  const out = (r.stdout || "") + (r.stderr || "");
  add("ui.check-live", r.status === 0, out.trim().split("\n").slice(-1)[0]);
}

const t0 = Date.now();
const vOk = await versionMatch();
await dataCheck();
if (vOk || args.includes("--ui-anyway")) { uiCheck(); liveCheck(); }
const crit = results.filter((r) => !r.ok && r.sev === "CRITICAL");
const report = { at: new Date().toISOString(), site: SITE, ms: Date.now() - t0, status: crit.length ? "FAIL" : "PASS",
                 critical: crit.length, results };
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", "verify-report.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.status} — ${results.length} فحصاً · ${crit.length} حرج · ${Math.round(report.ms / 1000)}ث`);
process.exit(crit.length ? 1 : 0);
