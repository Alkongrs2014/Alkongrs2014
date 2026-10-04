#!/usr/bin/env node
/* =====================================================================
   قياس أداء الدورة (V4.1) — هل يتّسع ربعُ الساعة لدورةٍ كاملة، وكم تستغرق
   كلُّ مرحلةٍ من إغلاق الشمعة إلى الملفّ الجاهز للنشر؟

   طلباتٌ حقيقية (Alpaca SIP للأسهم · Binance للكريبتو) والمحرّك نفسه على
   شموعٍ تاريخية **مغلقة**: كلُّ حدٍّ H يُبنى بشموعٍ نهايتُها ≤ H (`evalSlot`
   و`stepOver` يقطعان عند H)، والحالة تُحمَل من حدٍّ إلى الذي يليه كما في الحيّ.
   لا يقيس دقّة الاستراتيجيات ولا نتائج التداول.

   **لا يمسّ data/ الحيّ**: يعمل على مجلّد البيانات تحت جذر الشيفرة التي
   يُشغَّل منها — شغّله من worktree بنسخةٍ من data/ (المجدول يكتب في الرئيسية).
   والنشر يُقاس على مستودعٍ محلّيّ فارغ (لا كاتب ثانٍ لفرع data): لقطةٌ
   وبوّابات وطبيبٌ والتزامٌ ودفعٌ محلّي. زمنُ الدفع عبر الشبكة من سجلّ النشر الحيّ.

   node scripts/bench-cycle.mjs [--runs=5] [--skip=crypto,publish,…] [--json=f]
   ===================================================================== */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";

loadEnv();

const require = createRequire(import.meta.url);
const SES = require("../stocks/session.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const RUNS = Number(arg("runs", "5"));
const SKIP = new Set((arg("skip", "") || "").split(",").filter(Boolean));
const M15 = 15 * 60000;

if (path.resolve(ROOT) === path.resolve("D:/Ai/ClaudeCode/trade/webtrade") && !process.argv.includes("--allow-main")) {
  console.error("✗ شغّله من worktree بنسخةٍ من data/ — الشجرة الرئيسية يكتب فيها المجدول"); process.exit(2);
}

const stats = (a) => {
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  return n ? { n, avg: +(s.reduce((x, y) => x + y, 0) / n).toFixed(2), min: +s[0].toFixed(2), max: +s[n - 1].toFixed(2),
    p50: +s[n >> 1].toFixed(2) } : { n: 0 };
};
const R = {};
const add = (k, v) => (R[k] ||= []).push(v);

function run(file, args = [], env = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let out = "";
    const p = spawn(process.execPath, [path.join(ROOT, "scripts", file), ...args], { cwd: ROOT, env: { ...process.env, ...env } });
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => resolve({ code, sec: (Date.now() - t0) / 1000, out }));
  });
}
const phaseOf = (out, re) => { const m = re.exec(out); return m ? Number(m[1]) : null; };

/* ١) الأسهم: جلبُ التأكيد (Alpaca SIP: الأسعار ثم المخزن ثم بناء ملفّات العرض) */
async function benchStockFetch() {
  for (let i = 0; i < RUNS; i++) {
    const r = await run("fetch-market.mjs", ["--out", DATA], { FAST_CONFIRM: "1" });
    if (r.code !== 0) { console.log("  ✗ fetch-market: " + r.out.slice(-300)); add("stocks.fetch.fail", 1); continue; }
    const pre = phaseOf(r.out, /قبل الشموع.*?\) · ([\d.]+)ث/), post = phaseOf(r.out, /بعد الشموع · ([\d.]+)ث/);
    add("stocks.fetch.total", r.sec);
    if (pre !== null) add("stocks.fetch.network(quotes+store)", pre);
    if (pre !== null && post !== null) add("stocks.fetch.symbols(analysis+files)", post - pre);
    if (post !== null) add("stocks.fetch.summary+write", r.sec - post);
    console.log(`  الأسهم جلب #${i + 1}: ${r.sec.toFixed(1)}ث (شبكة ${pre}ث · رموز ${(post - pre).toFixed(1)}ث)`);
  }
}

/* ٢) الأسهم: المخزن وحده (ما يحتاجه V3 فعلاً) — طلبات SIP حقيقية */
async function benchStore() {
  const { updateStore, storeDir } = await import("./lib/bars-store.mjs");
  const AL = await import("./providers/alpaca.mjs");
  const U = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
  const syms = U.symbols.map((x) => x.s).slice(0, U.top || 50);
  for (const s of fs.readdirSync(storeDir(DATA))) if (!syms.includes(s) && fs.existsSync(path.join(storeDir(DATA), s, "15m.json"))) syms.push(s);
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now();
    const st = await updateStore({ dir: storeDir(DATA), symbols: syms, provider: AL });
    add("stocks.store.update", (Date.now() - t0) / 1000);
    console.log(`  مخزن SIP #${i + 1}: ${((Date.now() - t0) / 1000).toFixed(2)}ث · ${st.requests} طلباً · ${syms.length} رمزاً`);
  }
}

/* ٣) المحرّك V3 على حدودٍ تاريخية مغلقة — الحالة محمولة كالحيّ */
async function benchEngine(book) {
  const { build } = await import("./build-trades.mjs");
  const out = book === "crypto" ? path.join(DATA, "crypto") : DATA;
  let Hs = [];
  if (book === "crypto") {
    const H1 = Math.floor((Date.now() - M15) / M15) * M15;
    for (let H = H1 - 24 * 3600000; H <= H1; H += M15) Hs.push(H);
  } else {
    // آخر يوم تداولٍ كامل في المخزن: كلُّ ربع ساعة من 05:15 إلى 19:45 نيويورك
    const last = SES.scanSlotAt(Date.now());
    const day = SES.scanSlotsOf(last);
    const first = day[0];
    for (let H = first; H <= day[day.length - 1]; H += M15) Hs.push(H);
  }
  // البناء البارد (قراءة الشموع من القرص + التقييم) — ما يدفعه كلُّ تشغيلٍ مجدول
  for (let i = 0; i < Math.min(RUNS, 3); i++) {
    const t0 = Date.now(); const r = build({ now: Hs[Hs.length - 1] + 1000, out, book, fresh: true });
    add(`${book}.engine.cold(load+eval)`, (Date.now() - t0) / 1000);
    if (!r.ok) console.log("  ✗ build: " + r.why);
  }
  // دورة الحياة على اليوم: التقييم وحده لكل حدّ (الشموع محمَّلة) والحالة تُحمل
  let state = null; const per = [];
  const t0 = Date.now();
  for (const H of Hs) {
    const t1 = Date.now();
    const r = build({ now: H + 1000, out, book, state: state || null, fresh: !state });
    if (r.ok && !r.same) state = r.state;
    per.push((Date.now() - t1) / 1000);
  }
  for (const x of per) add(`${book}.engine.slot`, x);
  console.log(`  ${book} V3: ${Hs.length} حدّاً في ${((Date.now() - t0) / 1000).toFixed(1)}ث · وسيط ${stats(per).p50}ث · أقصى ${stats(per).max}ث · قائمة ${(state && state.active.length) || 0}`);
}

/* ٤) توجّه السوق (شاشة «السوق»، دورة Market) */
async function benchMdir() {
  for (let i = 0; i < Math.min(RUNS, 3); i++) {
    const r = await run("market-direction.mjs", ["--out", DATA]);
    add("stocks.mdir", r.sec);
  }
}

/* ٥) الكريبتو: Binance — الكون والشموع المغلقة */
async function benchCryptoFetch() {
  for (let i = 0; i < RUNS; i++) {
    const r = await run("fetch-crypto.mjs", ["--out", path.join(DATA, "crypto")]);
    if (r.code !== 0) { console.log("  ✗ fetch-crypto: " + r.out.slice(-300)); continue; }
    const req = /(\d+) طلب شمعات/.exec(r.out);
    add("crypto.fetch", r.sec);
    console.log(`  الكريبتو جلب #${i + 1}: ${r.sec.toFixed(1)}ث · ${req ? req[1] : "?"} طلب`);
  }
}

/* ٦) النشر محلياً: لقطة + بوّابتا الدفترين + الطبيب السريع + التزام + دفعٌ محلّي */
async function benchPublish() {
  const { publishData } = await import("./lib/publish.mjs");
  const { quickDoctor } = await import("./lib/doctor-core.mjs");
  for (let i = 0; i < Math.min(RUNS, 3); i++) {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "bench-remote-"));
    execFileSync("git", ["init", "-q", "--bare", bare]);
    const t0 = Date.now();
    const r = await publishData({ root: ROOT, dataDir: DATA, remote: bare, quick: quickDoctor, requireProvider: "alpaca_sip", log: () => {} });
    const sec = (Date.now() - t0) / 1000;
    add("publish.local.total", sec);
    for (const [k, v] of Object.entries(r.ms || {})) add(`publish.local.${k}`, v / 1000);
    let size = 0;
    try { size = Number(/size-pack: (\d+)/.exec(execFileSync("git", ["count-objects", "-v"], { cwd: bare, encoding: "utf8" }))[1]); } catch {}
    add("publish.packKB", size);
    console.log(`  نشر محلي #${i + 1}: ${sec.toFixed(1)}ث · ${r.code}${r.ok ? "" : " — " + r.why} · حزمة ${(size / 1024).toFixed(1)} م.ب · ${JSON.stringify(r.ms)}`);
    fs.rmSync(bare, { recursive: true, force: true });
  }
}

/* ٧) التزامن: دورة أسهم ودورة كريبتو معاً من run.mjs نفسه (قفلان منفصلان) —
   لا انتظار ولا فقدان: كلٌّ يكتب لقطته، والملفّات صالحة JSON بعدهما */
async function benchConcurrency() {
  const runJob = (job) => new Promise((resolve) => {
    const t0 = Date.now(); let out = "";
    const p = spawn(process.execPath, [path.join(ROOT, "local/run.mjs"), job], { cwd: ROOT });
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => resolve({ job, code, sec: (Date.now() - t0) / 1000, waited: /ننتظر دورنا/.test(out), out }));
  });
  for (let i = 0; i < Math.min(RUNS, 3); i++) {
    const [a, b] = await Promise.all([runJob("confirm"), runJob("crypto")]);
    const okJson = ["summary.json", "trades.json", "crypto/summary.json", "crypto/trades.json"].every((f) => {
      try { JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); return true; } catch { return false; } });
    add("concurrent.confirm", a.sec); add("concurrent.crypto", b.sec);
    add("concurrent.ok", a.code === 0 && b.code === 0 && okJson ? 1 : 0);
    add("concurrent.lockWait", (a.waited || b.waited) ? 1 : 0);
    console.log(`  تزامن #${i + 1}: confirm ${a.sec.toFixed(1)}ث (رمز ${a.code}) · crypto ${b.sec.toFixed(1)}ث (رمز ${b.code}) · انتظار قفل ${a.waited || b.waited} · JSON سليم ${okJson}`);
    if (a.code || b.code) console.log(a.out.slice(-400) + "\n" + b.out.slice(-400));
  }
}

const steps = [["stocks-fetch", benchStockFetch], ["store", benchStore], ["engine-stocks", () => benchEngine("stocks")],
  ["mdir", benchMdir], ["crypto", benchCryptoFetch], ["engine-crypto", () => benchEngine("crypto")],
  ["publish", benchPublish], ["concurrency", benchConcurrency]];
const T0 = Date.now();
for (const [k, f] of steps) {
  if (SKIP.has(k)) continue;
  console.log(`\n── ${k} ──`);
  await f();
}
const table = Object.fromEntries(Object.entries(R).map(([k, v]) => [k, stats(v)]));
console.log("\nالمرحلة | n | متوسط | أسرع | أبطأ | وسيط (ثوانٍ)");
for (const [k, s] of Object.entries(table)) if (s.n) console.log(`${k} | ${s.n} | ${s.avg} | ${s.min} | ${s.max} | ${s.p50}`);
console.log(`\n✔ القياس ${((Date.now() - T0) / 1000).toFixed(0)}ث`);
const jf = arg("json", null);
if (jf) fs.writeFileSync(jf, JSON.stringify({ at: new Date().toISOString(), runs: RUNS, table, raw: R }, null, 1));
