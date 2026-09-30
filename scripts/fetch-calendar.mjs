#!/usr/bin/env node
/* =====================================================================
   تقويم البورصة الرسمي — من Alpaca، مرّةً يومياً.

   يكتب `data/market-calendar.json` (عطلات، أنصاف أيام، ساعات الجلسة
   الممتدة لكل يوم)، ويقارنه بجداول `stocks/session.js` اليدوية. واختلافُهما
   **فشلٌ صريح** (رمز خروج ‎1‎): الجدول اليدوي يحكم الواجهة والتحليل،
   وعطلةٌ ناقصة فيه تجعل يوماً مغلقاً «جلسةً» تنتظر شموعاً لن تأتي.

     node scripts/fetch-calendar.mjs --out data
     node scripts/fetch-calendar.mjs --check     (بلا شبكة)
   ===================================================================== */
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PROV from "./providers/index.mjs";
import { refreshCalendar, checkTables, marketDataSession, officialDay } from "./lib/market-session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const OUT = (() => { const i = args.indexOf("--out"); return i >= 0 ? path.resolve(args[i + 1]) : path.join(ROOT, "data"); })();

function selfCheck() {
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n} — ${e.message}`); fail++; } };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
  const day = (date, close = "16:00", sc = "2000") => ({ date, open: "09:30", close, session_open: "0400", session_close: sc });
  const cal = { from: "2026-11-23", to: "2026-11-30",
    days: [day("2026-11-23"), day("2026-11-24"), day("2026-11-25"), day("2026-11-27", "13:00", "1700"), day("2026-11-30")] };
  cal.byDate = Object.fromEntries(cal.days.map(d => [d.date, d]));
  t("حدود الجلسة الممتدة من التقويم", () => {
    eq(marketDataSession(Date.parse("2026-11-24T08:59:00Z"), cal).state, "CLOSED", "03:59 ET");
    eq(marketDataSession(Date.parse("2026-11-24T09:00:00Z"), cal).state, "PRE", "04:00 ET");
    eq(marketDataSession(Date.parse("2026-11-24T14:30:00Z"), cal).state, "REGULAR", "09:30 ET");
    eq(marketDataSession(Date.parse("2026-11-24T21:00:00Z"), cal).state, "AFTER", "16:00 ET");
    eq(marketDataSession(Date.parse("2026-11-25T01:00:00Z"), cal).state, "CLOSED", "20:00 ET");
  });
  t("العطلة ونصف اليوم", () => {
    eq(marketDataSession(Date.parse("2026-11-26T16:00:00Z"), cal).holiday, true, "عيد الشكر");
    eq(marketDataSession(Date.parse("2026-11-27T18:30:00Z"), cal).state, "AFTER", "13:30 ET نصف يوم");
    eq(marketDataSession(Date.parse("2026-11-27T22:00:00Z"), cal).state, "CLOSED", "17:00 ET نصف يوم");
  });
  t("خارج مدى التقويم يُحكم بجداول session.js ويُقال ذلك", () => {
    eq(officialDay(cal, "2027-01-04"), undefined, "خارج المدى");
    eq(marketDataSession(Date.parse("2027-01-04T15:00:00Z"), cal).source, "session.js", "المصدر");
  });
  t("الجداول اليدوية تطابق هذا التقويم", () => eq(checkTables(cal), [], "لا اختلاف"));
  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل`);
  process.exit(fail ? 1 : 0);
}

async function main() {
  const cal = await refreshCalendar(OUT, PROV.get("alpaca"));
  const bad = checkTables(cal);
  console.log(`✔ تقويم ${cal.days.length} يوم تداول (${cal.from} … ${cal.to}) · الجلسة الآن: ${marketDataSession(Date.now(), cal).state}`);
  if (bad.length) {
    console.error(`✗ جداول stocks/session.js تخالف التقويم الرسمي في ${bad.length} يوماً:\n  ` + bad.slice(0, 10).join("\n  "));
    process.exit(1);
  }
}

if (args.includes("--check")) selfCheck();
else main().catch(e => { console.error("✗ " + e.message); process.exit(1); });
