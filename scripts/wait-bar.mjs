#!/usr/bin/env node
/* =====================================================================
   بوّابة جاهزية شمعة ‎15د‎ (V4.1) — متى يبدأ التأكيد بعد إغلاق الشمعة؟

   كان Confirm يبدأ عند ‎H+3د‎ بالمجدول: هامشٌ ورثناه من ياهو (مراجعاتٌ لشمعةٍ
   أُغلقت للتوّ — DELL حجماً، BA في 2026-09-25)، ولم يُقس على SIP. الآن يبدأ
   المجدول عند الحدّ نفسه، وهذه البوّابة:
     ١) تنتظر **أدنى انتظارٍ آمن** بعد H (`minWaitS` — رقمٌ يُثبَّت من قياس
        المسبار `probe-sip-report.mjs` في جلسةٍ حقيقية، لا من التقدير)،
     ٢) ثم تتحقّق أن SIP أصدر شمعة [H−15د، H) للرموز المرجعية (SPY · QQQ —
        تتداول كلَّ ربع ساعة في نافذة SIP كلّها) بطلبٍ واحد، وتعيد كلَّ `retryS`
        حتى `capS`. وبعد السقف تمضي الدورة كما كانت (لا تُعطَّل بقية النظام)
        ويُسجَّل التأخّر.
   خارج نافذة SIP لا شمعة تُنتظر فلا انتظار (الليل والعطلة: الدورة تمضي فوراً).
   لا تمسّ المحرّك ولا الشموع: الشموع المغلقة وحدها تدخل الإشارات كما كانت
   (`evalSlot` يقطع عند H) — هذه تقرّر **متى** يُجلب، لا **ماذا** يُحسب.

   node scripts/wait-bar.mjs [--now=ISO] [--check]
   ===================================================================== */
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";

const require = createRequire(import.meta.url);
const SES = require("../stocks/session.js");
const M15 = 15 * 60000;

/* `minWaitS` من `CONFIRM_WAIT_S` في session.js (مصدرٌ واحد مع موعد التقاط الواجهة):
   180 هو الهامش القديم نفسه حتى يُثبت المسبار أقصر منه في جلسةٍ حقيقية. */
export const BAR_READY = {
  minWaitS: Number(process.env.CONFIRM_MIN_WAIT_S ?? SES.CONFIRM_WAIT_S),
  refs: ["SPY", "QQQ"],
  retryS: 10,
  capS: 120
};

/* الحدّ الذي يخصّه التشغيل: آخر حدّ ربع ساعة ≤ now (المجدول يطلق عند الحدّ) */
export const boundaryOf = (now) => Math.floor(now / M15) * M15;
/* هل يُنتظر لهذا الحدّ شمعةٌ أصلاً؟ داخل نافذة SIP (04:00→20:00 أو 17:00) وحدها */
export function expectsBar(H) {
  const w = SES.sessionWindows(H - 1);
  return !!(w && w.pre && H - M15 >= w.pre.start && H <= w.post.end);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitBar({ now = Date.now(), cfg = BAR_READY, fetchBars, log = console.log, sleepFn = sleep, clock = Date.now } = {}) {
  const H = boundaryOf(now);
  if (!expectsBar(H)) { log(`  ⏱ انتظار الشمعة: خارج نافذة SIP — لا شمعة تُنتظر`); return { H, wait: 0, ready: null }; }
  // تشغيلٌ يدويٌّ متأخّر (بعد الحدّ بأكثر من دقائق) لا ينتظر شيئاً: الشمعة نهائيةٌ منذ زمن
  const until = H + cfg.minWaitS * 1000;
  if (until > clock()) await sleepFn(until - clock());
  const deadline = H + (cfg.minWaitS + cfg.capS) * 1000;
  let tries = 0, ready = false;
  for (;;) {
    tries++;
    try {
      const m = await fetchBars(cfg.refs, H - M15);
      ready = cfg.refs.every((s) => (m[s] || []).some((b) => b.t === H - M15));
    } catch (e) { log(`  ⚠ فحص الجاهزية: ${String(e.message || e).slice(0, 120)}`); }
    if (ready || clock() + cfg.retryS * 1000 > deadline) break;
    await sleepFn(cfg.retryS * 1000);
  }
  const wait = Math.round((clock() - H) / 1000);
  log(ready ? `  ⏱ الشمعة ${new Date(H - M15).toISOString().slice(11, 16)}Z جاهزة عند +${wait}ث (${tries} فحص)`
            : `  ⚠ الشمعة ${new Date(H - M15).toISOString().slice(11, 16)}Z لم تظهر حتى +${wait}ث — الدورة تمضي (تُلتقط في الجلب التالي)`);
  return { H, wait, ready, tries };
}

async function selfCheck() {
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m + ": " + JSON.stringify(a)); };
  // الحدود: 09:45 نيويورك (13:45Z صيفاً) يُنتظر · 02:00 نيويورك لا · السبت لا
  eq(expectsBar(Date.parse("2026-10-01T13:45:00Z")), true, "داخل الجلسة");
  eq(expectsBar(Date.parse("2026-10-01T08:15:00Z")), true, "أوّل شمعة 04:00–04:15");
  eq(expectsBar(Date.parse("2026-10-01T08:00:00Z")), false, "قبل 04:00 لا شمعة");
  eq(expectsBar(Date.parse("2026-10-02T00:00:00Z")), true, "آخر شمعة 19:45–20:00");
  eq(expectsBar(Date.parse("2026-10-02T00:15:00Z")), false, "بعد 20:00");
  eq(expectsBar(Date.parse("2026-10-03T15:00:00Z")), false, "السبت");
  // ساعةٌ افتراضية: الشمعة تظهر عند +25ث، والأدنى 10ث، والإعادة كل 10ث ⇒ جاهزة عند +30ث بثلاثة فحوص
  const H = Date.parse("2026-10-01T13:45:00Z");
  let t = H + 1000;
  const fake = { clock: () => t, sleepFn: async (ms) => { t += ms; },
    fetchBars: async (refs, from) => (t >= H + 25000 ? Object.fromEntries(refs.map((s) => [s, [{ t: from }]])) : {}), log: () => {} };
  const r = await waitBar({ now: t, cfg: { ...BAR_READY, minWaitS: 10, retryS: 10, capS: 60 }, ...fake });
  eq([r.ready, r.wait, r.tries], [true, 30, 3], "جاهزة عند +30ث");
  // لا تظهر أبداً ⇒ تمضي بعد السقف بلا تعليق
  t = H + 1000;
  const r2 = await waitBar({ now: t, cfg: { ...BAR_READY, minWaitS: 10, retryS: 10, capS: 30 }, ...fake, fetchBars: async () => ({}) });
  eq([r2.ready, r2.wait <= 40], [false, true], "تمضي بعد السقف");
  // خارج النافذة: لا انتظار ولا طلب
  let called = 0;
  const r3 = await waitBar({ now: Date.parse("2026-10-03T15:00:30Z"), ...fake, fetchBars: async () => { called++; return {}; } });
  eq([r3.ready, r3.wait, called], [null, 0, 0], "العطلة بلا انتظار");
  console.log("✓ wait-bar --check");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) { await selfCheck(); process.exit(0); }
  loadEnv();
  const AL = await import("./providers/alpaca.mjs");
  const a = process.argv.find((x) => x.startsWith("--now="));
  const fetchBars = async (refs, from) => {
    const m = await AL.getCandlesBatch(refs, "15m", { from, feed: "sip", adjustment: "split", maxPages: 2 });
    delete m.__skipped; return m;
  };
  await waitBar({ now: a ? Date.parse(a.slice(6)) : Date.now(), fetchBars });
}
