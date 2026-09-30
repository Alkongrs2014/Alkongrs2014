/* =====================================================================
   جلستان لا جلسة — `MARKET_DATA_SESSION` و`ANALYSIS_SESSION`.

   · **جلسةُ البيانات**: متى يُجلب ويُحدَّث ويُنشر. تمتدّ من بدء ما قبل
     الافتتاح (‎04:00 ET‎) إلى نهاية ما بعد الإغلاق (‎20:00 ET‎، و‎17:00‎ في
     نصف اليوم) — فلا ينتظر النظام الجرس، ولا يتوقّف عنده.
   · **جلسةُ التحليل**: أيُّ الشموع تدخل الحساب المؤكَّد. الجلسة الرسمية
     وحدها (`RTH`) — `tf` رسمية و`tfx` ممتدّة (انظر `applyStore`). وهي
     **ثابتٌ معلَن لا يتغيّر في مهمّة نقل البيانات**: إدخالُ الممتدة في
     `tf` يغيّر كل مؤشّرٍ في الكون ويُبطل الأرشيف.

   والمصدر: **تقويم البورصة الرسمي من Alpaca** (`/v2/calendar`) مخزَّناً
   يومياً في `data/market-calendar.json` — عطلاتٌ وأنصافُ أيامٍ وساعاتُ
   الجلسة الممتدة لكل يوم. وحين يغيب الملفّ (أوّل تشغيل، أو فشل الشبكة)
   نسقط إلى جداول `stocks/session.js` **ونقول ذلك** (`source`). والفحص
   `checkTables` يقارن الجدولين فيُسقط الحصن إن اختلفا — كي لا يبقى الجدول
   اليدويّ صحيحاً بالصدفة حتى أوّل عطلةٍ تُضاف.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const SES = createRequire(import.meta.url)("../../stocks/session.js");

export const ANALYSIS_SESSION = "RTH";
export const CALENDAR_FILE = "market-calendar.json";

const hm = (s) => { const t = String(s).replace(":", ""); return Number(t.slice(0, 2)) * 60 + Number(t.slice(2, 4)); };

export function readCalendar(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, CALENDAR_FILE), "utf8")); } catch { return null; }
}

/* يوم نيويورك في التقويم الرسمي: `{ pre, open, close, post }` بالدقائق، أو
   `null` لعطلةٍ داخل مدى التقويم، أو `undefined` لتاريخٍ خارج مداه. */
export function officialDay(cal, date) {
  if (!cal?.days?.length) return undefined;
  if (date < cal.from || date > cal.to) return undefined;
  const d = cal.byDate?.[date] ?? cal.days.find(x => x.date === date);
  if (!d) return null;
  if (!d.session_open || !d.session_close) return undefined;   // تقويمٌ بلا ساعاتٍ ممتدة لا يُحكم به
  return { pre: hm(d.session_open), open: hm(d.open), close: hm(d.close), post: hm(d.session_close) };
}

/* جلسةُ البيانات للحظةٍ ما: `PRE · REGULAR · AFTER · CLOSED`، ومصدرُ الحكم. */
export function marketDataSession(now = Date.now(), cal = null) {
  const p = SES.etParts(now);
  const day = officialDay(cal, p.date);
  if (day === undefined) return { state: SES.sessionOf(now), source: "session.js" };
  if (day === null) return { state: "CLOSED", source: "alpaca-calendar", holiday: p.wd !== "Sat" && p.wd !== "Sun" };
  const m = p.mins;
  const state = m < day.pre ? "CLOSED" : m < day.open ? "PRE" : m < day.close ? "REGULAR" : m < day.post ? "AFTER" : "CLOSED";
  return { state, source: "alpaca-calendar", half: day.close < 16 * 60 };
}

/* هل يُجلب الآن؟ الجلسة الممتدة كلُّها، وهامشٌ بعد نهايتها يلتقط آخر شمعة
   ومراجعة المزوّد لها. */
export function dataSessionOpen(now = Date.now(), cal = null, graceMin = 20) {
  if (marketDataSession(now, cal).state !== "CLOSED") return true;
  return marketDataSession(now - graceMin * 60e3, cal).state !== "CLOSED";
}

export async function refreshCalendar(dataDir, provider, now = Date.now()) {
  const from = new Date(now - 14 * 86400e3).toISOString().slice(0, 10);
  const to = new Date(now + 400 * 86400e3).toISOString().slice(0, 10);
  const days = await provider.getCalendar(from, to);
  if (!Array.isArray(days) || days.length < 200) throw new Error(`تقويمٌ ناقص (${days && days.length} يوماً)`);
  let clock = null;
  try { clock = await provider.getMarketStatus(); } catch { /* الساعة تكميلية */ }
  const cal = { src: "alpaca", fetchedAt: now, from, to, clock, days,
                byDate: Object.fromEntries(days.map(d => [d.date, d])) };
  const f = path.join(dataDir, CALENDAR_FILE);
  fs.writeFileSync(f + ".tmp", JSON.stringify(cal));
  fs.renameSync(f + ".tmp", f);
  return cal;
}

/* جداول `session.js` مقابل التقويم الرسمي على مداه: كلُّ يوم عمل (الإثنين
   ـ الجمعة) — هل هو يوم تداول عند الاثنين؟ وهل هو نصف يوم عند الاثنين؟ */
export function checkTables(cal) {
  const bad = [];
  if (!cal?.days?.length) return ["لا تقويم"];
  for (let t = Date.parse(cal.from + "T17:00:00Z"); t <= Date.parse(cal.to + "T17:00:00Z"); t += 86400e3) {
    const p = SES.etParts(t);
    if (p.wd === "Sat" || p.wd === "Sun") continue;
    const off = cal.byDate[p.date];
    const tbl = SES.isTradingDay(t);
    if (!!off !== tbl) bad.push(`${p.date}: التقويم ${off ? "تداول" : "عطلة"} والجدول ${tbl ? "تداول" : "عطلة"}`);
    else if (off && (hm(off.close) < 16 * 60) !== SES.isHalfDay(p)) bad.push(`${p.date}: نصف يوم ${hm(off.close) < 960 ? "في التقويم" : "في الجدول"} وحده`);
  }
  return bad;
}
