/* جدول لقطات V3 للأسهم (قرار المالك 2026-10-01): قاعدةٌ واحدة طوال نافذة SIP —
   05:15 نيويورك ثم كلَّ 30 دقيقة حتى نهاية ما بعد الإغلاق. لا استثناء للافتتاح ولا
   للإغلاق: 09:45 و16:15 تقعان في الدورة نفسها. والرياض عرضٌ يتبع التوقيت الصيفي وحده. */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { stockSlotAt } from "../../scripts/lib/engine3-run.mjs";
const SES = createRequire(import.meta.url)("../../stocks/session.js");

const fmt = (tz) => (t) => new Date(t).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
const ny = fmt("America/New_York"), ry = fmt("Asia/Riyadh");
const expected = [];
for (let m = 5 * 60 + 15; m <= 20 * 60; m += 30) expected.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));

describe("جدول لقطات الأسهم", () => {
  it("يومٌ عادي صيفاً: 05:15 … 19:45 كلَّ 30 دقيقة، و09:45 و16:15 من نفس الدورة", () => {
    const s = SES.scanSlotsOf(Date.parse("2026-09-30T15:00:00Z"));
    expect(s.map(ny)).toEqual(expected);
    expect(s.length).toBe(30);
    expect(s.map(ny)).toContain("09:45");
    expect(s.map(ny)).toContain("16:15");
    for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBe(30 * 60000);   // لا خطوة خاصة
    expect(ry(s[0])).toBe("12:15");
    expect(ry(s[s.indexOf(s.find((t) => ny(t) === "09:45"))])).toBe("16:45");
  });

  it("الشتاء: نفس ساعات نيويورك، والرياض تتأخّر ساعة تلقائياً", () => {
    const s = SES.scanSlotsOf(Date.parse("2026-12-02T15:00:00Z"));
    expect(s.map(ny)).toEqual(expected);
    expect(ry(s[0])).toBe("13:15");
  });

  it("نصف اليوم: تنتهي اللقطات 16:45 (ما بعد الإغلاق حتى 17:00)", () => {
    const s = SES.scanSlotsOf(Date.parse("2026-11-27T15:00:00Z"));
    expect(ny(s[0])).toBe("05:15");
    expect(ny(s[s.length - 1])).toBe("16:45");
  });

  it("العطلة ونهاية الأسبوع بلا لقطات، واللقطة القائمة آخرُ لقطة يوم التداول السابق", () => {
    expect(SES.scanSlotsOf(Date.parse("2026-10-03T15:00:00Z"))).toEqual([]);    // سبت
    const h = stockSlotAt(Date.parse("2026-10-04T12:00:00Z"));                  // الأحد
    expect(new Date(h).toISOString()).toBe("2026-10-02T23:45:00.000Z");         // الجمعة 19:45 نيويورك
    // قبل أوّل لقطة اليوم: آخرُ لقطة الأمس
    expect(ny(stockSlotAt(Date.parse("2026-10-01T09:10:00Z")))).toBe("19:45");
    expect(ny(stockSlotAt(Date.parse("2026-10-01T09:15:00Z")))).toBe("05:15");
  });

  it("اللقطة القائمة ثابتةٌ داخل نصف ساعتها وتتقدّم عند الحدّ", () => {
    const a = Date.parse("2026-10-01T13:45:00Z");                               // 09:45 نيويورك
    expect(stockSlotAt(a - 1)).toBe(a - 30 * 60000);
    expect(stockSlotAt(a)).toBe(a);
    expect(stockSlotAt(a + 29 * 60000)).toBe(a);
    expect(SES.nextScanSlot(a)).toBe(a + 30 * 60000);
  });
});
