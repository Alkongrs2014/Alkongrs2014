#!/usr/bin/env node
/* =====================================================================
   مسبار زمن وصول شمعة ‎15د‎ من Alpaca SIP واستقرارها — قراءةٌ فقط.

   السؤال الذي يجيبه (V4.1): كم ننتظر بعد إغلاق شمعة ‎15د‎ حتى تكون في
   SIP **كاملةً ونهائية**؟ هامش «+3 دقائق» ورثناه من ياهو (مراجعاتٌ
   لشمعةٍ أُغلقت للتوّ — DELL حجماً، BA في 2026-09-25)، ولم يُقس على SIP.

   عند كل حدّ ربع ساعة H طوال نافذة SIP يُطلب **نفس طلب المخزن**
   (`getCandlesBatch` للكون، ‎15Min‎، sip، split) على إزاحاتٍ من H، ويُسجَّل
   لكل رمز شمعةُ [H−15د، H) كما رآها الطلب. المرجع النهائي: الإزاحة الأخيرة
   (‎+30د‎)، ثم مخزن الليل في التقرير. ولا يكتب في أيّ ملفّ يقرؤه الإنتاج:
   مخرجاته في `data/logs/probe/` وحدها، وبلا قفل (لا يمسّ `data/`).

   node scripts/probe-sip-latency.mjs [--from=ISO] [--to=ISO] [--once]
     بلا وسائط: نافذة SIP لليوم (04:00→20:00 نيويورك) من `session.js`.
     --once   حدٌّ واحد (آخر حدٍّ مضى) للتجربة: يُطلب الآن بإزاحةٍ واحدة.
   التقرير: node scripts/probe-sip-report.mjs [YYYY-MM-DD]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as AL from "./providers/alpaca.mjs";
import { loadEnv } from "./lib/env.mjs";

loadEnv();
const require = createRequire(import.meta.url);
const SES = require("../stocks/session.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const M15 = 15 * 60000;

/* الإزاحات بالثواني بعد الحدّ — كثيفةٌ في الدقيقة الأولى (حيث يقع القرار)، ثم
   تتباعد حتى ‎+30د‎ لالتقاط المراجعات المتأخّرة (صفقاتٌ تُبلَّغ متأخّرة). */
export const OFFSETS = [2, 4, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 90, 120, 150, 180, 240, 300, 600, 1800];

function universe() {
  const U = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
  const syms = U.symbols.map((x) => x.s).slice(0, U.top || 50);
  // المرجعيّة التي يجلبها المخزن (SPY · QQQ …) — من أسماء مجلّداته
  try { const st = path.join(ROOT, "data/bars/alpaca_sip");
    for (const s of fs.readdirSync(st)) if (!syms.includes(s) && fs.existsSync(path.join(st, s, "15m.json"))) syms.push(s); } catch { /* بلا مخزن */ }
  return syms;
}

const OUT_DIR = path.join(ROOT, "data", "logs", "probe");
const outFile = (t) => path.join(OUT_DIR, `sip-${new Date(t).toISOString().slice(0, 10)}.jsonl`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sample(syms, H, off) {
  const t0 = Date.now();
  let bars = {}, cur = 0, err = null;
  try {
    // نفس طلب المخزن (feed=sip · adjustment=split) من بداية الشمعة المعنيّة
    const m = await AL.getCandlesBatch(syms, "15m", { from: H - M15, feed: "sip", adjustment: "split", maxPages: 5 });
    delete m.__skipped;
    for (const [s, arr] of Object.entries(m)) for (const b of arr || []) {
      if (b.t === H - M15) bars[s] = [b.o, b.h, b.l, b.c, b.v];
      else if (b.t >= H) cur++;                       // الشمعة الجارية — هل يعيدها SIP جزئيةً؟
    }
  } catch (e) { err = String(e.message || e).slice(0, 200); }
  const rec = { H, off, at: t0, ms: Date.now() - t0, n: Object.keys(bars).length, cur, bars, ...(err ? { err } : {}) };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(outFile(H), JSON.stringify(rec) + "\n");
  return rec;
}

/* حدودُ ربع الساعة في نافذة SIP لليوم: من أوّل شمعةٍ مغلقة (04:15) حتى 20:00 */
function boundaries(from, to) {
  const out = [];
  for (let H = Math.ceil(from / M15) * M15; H <= to; H += M15) out.push(H);
  return out;
}

async function main() {
  const syms = universe();
  if (!AL.available()) { console.error("✗ لا مفاتيح Alpaca"); process.exit(1); }
  if (process.argv.includes("--once")) {
    const H = Math.floor(Date.now() / M15) * M15;
    const r = await sample(syms, H, Math.round((Date.now() - H) / 1000));
    console.log(`✓ مسبار SIP (مرّة): ${syms.length} رمزاً · حدّ ${new Date(H).toISOString()} · ${r.n} شمعة مغلقة · ${r.cur} جارية · ${r.ms}ms${r.err ? " · ✗ " + r.err : ""}`);
    return;
  }
  const now = Date.now();
  const w = SES.sessionWindows(now);
  if (!w.pre && !arg("from")) { console.log("— لا جلسة اليوم (عطلة) — لا قياس"); return; }
  const from = arg("from") ? Date.parse(arg("from")) : w.pre.start + M15;
  const to = arg("to") ? Date.parse(arg("to")) : w.post.end;
  const Hs = boundaries(Math.max(from, now - 5000), to);
  console.log(`▶ مسبار SIP: ${syms.length} رمزاً · ${Hs.length} حدّاً ${new Date(Hs[0]).toISOString()} → ${new Date(Hs[Hs.length - 1]).toISOString()} · ${OFFSETS.length} إزاحة لكل حدّ`);
  const jobs = [];
  for (const H of Hs) for (const off of OFFSETS) jobs.push({ at: H + off * 1000, H, off });
  jobs.sort((a, b) => a.at - b.at);
  const pending = [];
  for (const j of jobs) {
    const wait = j.at - Date.now();
    if (wait < -60000) continue;                      // فاتت (بدأ المسبار متأخّراً)
    if (wait > 0) await sleep(wait);
    // بلا انتظار للطلب: الإزاحات المتقاربة لا تتأخّر بطلبٍ بطيء
    pending.push(sample(syms, j.H, j.off).then((r) => {
      if (j.off === 2 || j.off === 60 || j.off === 1800)
        console.log(`  ${new Date(j.H).toISOString().slice(11, 16)}Z +${j.off}ث · ${r.n} مغلقة · ${r.cur} جارية · ${r.ms}ms${r.err ? " · ✗ " + r.err : ""}`);
    }));
  }
  await Promise.all(pending);
  console.log("✔ انتهى المسبار — " + outFile(Hs[0]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => { console.error("✗ " + (e.stack || e)); process.exit(1); });
