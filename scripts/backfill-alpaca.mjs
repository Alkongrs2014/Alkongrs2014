#!/usr/bin/env node
/* =====================================================================
   مخزن Alpaca SIP — تعبئة التاريخ وتقرير جودته.

   المخزن نفسه الذي تبني منه دورةُ السوق فريماتها (`lib/bars-store.mjs`)،
   فالتاريخ المُعبَّأ هنا **هو** مجموعةُ البيانات التي ستقيس عليها مرحلةُ
   التحقّق التاريخي — لا نسخةٌ ثانية. مصدرُه `alpaca_sip` في اسم مجلّده،
   وملفّات ياهو القديمة لا تُمسّ ولا تُخلط.

     node scripts/backfill-alpaca.mjs                      تحديث + تقرير
     node scripts/backfill-alpaca.mjs --report             تقرير الجودة وحده (بلا شبكة)
     BARS_15M_DAYS=730 BARS_1D_DAYS=3650 node scripts/backfill-alpaca.mjs   عمقٌ أبعد
     node scripts/backfill-alpaca.mjs --symbols=AAPL,MSFT

   والكون من `stocks/symbols.json` (وبدائل المؤشّرات) أو من `--symbols` —
   لا عددٌ مرقون: توسيعُه قائمةٌ أطول لا شيفرةٌ أخرى.

   الكتابة تحت قفل `data/.run.lock` نفسه: دورةُ السوق تكتب نفس الملفّات.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as PROV from "./providers/index.mjs";
import { updateStore, storeDir, readSeries, validBar, SPEC } from "./lib/bars-store.mjs";
import { acquire, release } from "./lib/lockfile.mjs";

const SES = createRequire(import.meta.url)("../stocks/session.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const DATA = opt("out") ? path.resolve(opt("out")) : path.join(ROOT, "data");
const DIR = storeDir(DATA);

function universe() {
  if (opt("symbols")) return opt("symbols").split(",").map(s => s.trim()).filter(Boolean);
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks/symbols.json"), "utf8"));
  return [...new Set([...(cfg.symbols || []).filter(m => m.mkt !== "crypto").map(m => m.s),
                      ...(cfg.indices || []).map(i => i.proxy).filter(Boolean)])];
}

/* =====================================================================
   تقرير الجودة — ما يجب أن يكون صفراً، وما يُشرح إن لم يكن.
   · تكرار الختم، وختمٌ خارج الشبكة، وشمعةٌ مشوّهة: صفرٌ شرط.
   · شمعةٌ يومية في يومٍ ليس يوم تداول: صفرٌ شرط.
   · فجواتُ الجلسة الرسمية: خانةُ ‎15د‎ بلا شمعة داخل الجلسة. SIP لا
     يطبع شمعةً بلا صفقة، فالفجوة في سهمٍ سائل نادرة وفي الهادئ مشروعة —
     تُعدّ وتُعرض ولا تُسقط.
   · اليوم الجاري: شمعةٌ يومية لتاريخ اليوم جزئيةٌ بالتعريف — تُذكر.
   ===================================================================== */
export function quality(sym, s15, s1d, now = Date.now()) {
  const q = { sym, n15: s15.length, n1d: s1d.length, dup: 0, offGrid: 0, invalid: 0, nonTradingDaily: 0,
              gaps: 0, sessions: { PRE: 0, REGULAR: 0, AFTER: 0, CLOSED: 0 }, partialDaily: false,
              from15: s15[0] ? new Date(s15[0].t).toISOString() : null, to15: s15.length ? new Date(s15[s15.length - 1].t).toISOString() : null };
  const seen = new Set();
  const perDay = new Map();
  for (const b of s15) {
    if (seen.has(b.t)) q.dup++; seen.add(b.t);
    if (b.t % 900e3) q.offGrid++;
    if (!validBar(b)) q.invalid++;
    const st = SES.sessionOf(b.t); q.sessions[st] = (q.sessions[st] || 0) + 1;
    if (st === "REGULAR") { const d = SES.etParts(b.t).date; perDay.set(d, (perDay.get(d) || 0) + 1); }
  }
  for (const [d, n] of perDay) {
    const noon = Date.parse(d + "T17:00:00Z");
    const exp = Math.round((SES.sessionCloseAt(noon) - SES.atEtMinutes(noon, SES.REG_OPEN)) / 900e3);
    if (d !== SES.etParts(now).date && n < exp) q.gaps += exp - n;
  }
  const seenD = new Set();
  for (const b of s1d) {
    if (seenD.has(b.t)) q.dup++; seenD.add(b.t);
    if (!validBar(b)) q.invalid++;
    if (!SES.isTradingDay(b.t + 12 * 3600e3)) q.nonTradingDaily++;
  }
  const last = s1d[s1d.length - 1];
  q.partialDaily = !!last && SES.etParts(last.t + 12 * 3600e3).date === SES.etParts(now).date;
  return q;
}

async function main() {
  const syms = universe();
  if (!args.includes("--report")) {
    const lock = path.join(DATA, ".run.lock");
    if (!(await acquire(lock, "backfill", 600000))) throw new Error("تعذّر أخذ القفل");
    try {
      const AL = PROV.get("alpaca");
      const t0 = Date.now();
      const { stats } = await updateStore({ dir: DIR, symbols: syms, provider: AL, log: console.log });
      console.log(`✔ مخزن SIP: ${syms.length} رمزاً · ${stats.requests} طلباً · ${stats.bars} شمعة · تعبئة ${stats.backfilled.length}` +
        ` · مراجَعة ${stats.revised} · مشوّهة ${stats.invalid} · ${((Date.now() - t0) / 1000).toFixed(1)}ث` +
        ` · تغذية ${JSON.stringify(AL.alStats.feeds)}`);
      if (Object.keys(stats.missing).length) console.log(`  ⚠ بلا شموع: ${JSON.stringify(stats.missing)}`);
    } finally { release(lock); }
  }
  const rows = syms.map(s => quality(s, readSeries(DIR, s, "15m")?.bars || [], readSeries(DIR, s, "1d")?.bars || []));
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  console.log(`\nتقرير الجودة — ${rows.length} رمزاً · عمق ‎15د‎ ${SPEC["15m"].days} يوماً · اليومي ${SPEC["1d"].days} يوماً · المصدر alpaca_sip`);
  console.log(`  شموع ‎15د‎ ${sum("n15")} · يومية ${sum("n1d")}`);
  console.log(`  تكرار ${sum("dup")} · خارج الشبكة ${sum("offGrid")} · مشوّهة ${sum("invalid")} · يوميةٌ في غير يوم تداول ${sum("nonTradingDaily")}`);
  const ses = rows.reduce((a, r) => { for (const [k, v] of Object.entries(r.sessions)) a[k] = (a[k] || 0) + v; return a; }, {});
  console.log(`  جلسات ‎15د‎: ${JSON.stringify(ses)}`);
  const withGaps = rows.filter(r => r.gaps).sort((a, b) => b.gaps - a.gaps);
  console.log(`  فجوات الجلسة الرسمية (خانة ‎15د‎ بلا صفقة): ${sum("gaps")} في ${withGaps.length} رمزاً` +
    (withGaps.length ? ` — أكثرها ${withGaps.slice(0, 5).map(r => r.sym + ":" + r.gaps).join(" ")}` : ""));
  console.log(`  يومية اليوم الجاري جزئية في ${rows.filter(r => r.partialDaily).length} رمزاً (متوقَّع أثناء الجلسة وبعدها قبل منتصف الليل)`);
  const empty = rows.filter(r => !r.n15 || !r.n1d);
  if (empty.length) console.log(`  ✗ بلا تاريخ: ${empty.map(r => r.sym).join(",")}`);
  const hard = sum("dup") + sum("offGrid") + sum("invalid") + sum("nonTradingDaily") + empty.length;
  console.log(hard ? `\n✗ ${hard} مخالفة صلبة` : "\n✔ لا مخالفة صلبة");
  process.exit(hard ? 1 : 0);
}

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) main().catch(e => { console.error("✗ " + e.message); process.exit(1); });
