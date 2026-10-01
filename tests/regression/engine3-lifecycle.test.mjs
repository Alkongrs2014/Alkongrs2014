/* لقطة الساعة للمحرّك V3 (قرار المالك 2026-10-01) — على مخزن SIP اصطناعي في مجلّدٍ مؤقّت:
   ١) داخل الساعة الواحدة: نفس اللقطة مهما تقدّمت الساعة أو تحرّكت الشمعة الجارية.
   ٢) كلُّ ساعة بدايةٌ جديدة: البناء فوق لقطة الساعة السابقة = البناء من الصفر حرفياً —
      فلا يُورَث دخولٌ ولا وقفٌ ولا هدفٌ ولا فرصة.
   ٣) كلُّ فرصة مبنيّةٌ في ساعتها، ولا مغلقةَ ولا نشطةَ محمولة.
   لا يكتب في المثبّتات: كلُّ شيءٍ في مجلّدٍ مؤقّت. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "../../scripts/build-trades.mjs";
import { synth, writeStore } from "../property/synth3.mjs";
import { createRequire } from "node:module";
const SES = createRequire(import.meta.url)("../../stocks/session.js");

const SYMS = ["AAPL", "NVDA", "MSFT", "AMD", "META"];
const DATA = SYMS.map((s, i) => [s, synth(11 + i, 200)]);
const all15 = DATA[0][1].b15;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "v3-hour-"));
function storeAt(dir, now) {
  const bars = path.join(dir, "bars", "alpaca_sip");
  for (const [s, d] of DATA) writeStore(fs, path, bars, s, d, now);
  return bars;
}
const put = (dir, doc) => fs.writeFileSync(path.join(dir, "trades.json"), JSON.stringify(doc));
// حدود اللقطة (05:15 ثم كلَّ 30 دقيقة — `scanSlotsOf`) التي تقع على نهاية شمعةٍ في البيانات
const ends = new Set(all15.map((b) => b.t + 15 * 60000));
const hours = [...new Set(all15.map((b) => SES.scanSlotsOf(b.t)).flat())].filter((h) => ends.has(h)).sort((a, b) => a - b).slice(-140);

describe("لقطة الساعة — المسار الحيّ", () => {
  it("داخل اللقطة الواحدة (30 دقيقة): نفس اللقطة", () => {
    const H = hours[70];
    const d1 = tmp(), d2 = tmp();
    const a = build({ now: H + 3 * 60000, out: d1, barsDir: storeAt(d1, H + 3 * 60000) });
    const b = build({ now: H + 28 * 60000, out: d2, barsDir: storeAt(d2, H + 28 * 60000) });
    expect(a.ok && b.ok).toBe(true);
    expect(a.doc.hour).toBe(b.doc.hour);
    expect(a.doc.rowsHash).toBe(b.doc.rowsHash);
    // والبناء الثاني داخل نفس الساعة فوق لقطتها لا يغيّر شيئاً
    put(d1, a.doc);
    const c = build({ now: H + 20 * 60000, out: d1, barsDir: storeAt(d1, H + 20 * 60000) });
    expect(c.same).toBe(true);
  });

  it("كلُّ ساعة من الصفر: البناء فوق الساعة السابقة = البناء من الصفر، ولا وراثة", () => {
    const dir = tmp();
    let prev = null, both = 0, recomputed = 0;
    for (const H of hours) {
      const now = H + 3 * 60000;
      const bars = storeAt(dir, now);
      const r = build({ now, out: dir, barsDir: bars });            // فوق لقطة الساعة السابقة
      const f = build({ now, out: tmp(), barsDir: bars, fresh: true });   // من الصفر
      expect(r.ok && f.ok).toBe(true);
      expect(r.same).toBeFalsy();
      expect(r.doc.rowsHash).toBe(f.doc.rowsHash);
      for (const t of r.doc.open) {
        expect(t.h).toBe(r.doc.hour);
        expect(t.id).toBe(`${t.s}|${r.doc.hour}`);
      }
      expect(r.doc.closed).toEqual([]);
      if (prev) for (const t of r.doc.open) {
        const p = prev.open.find((x) => x.s === t.s);
        if (!p) continue;
        both++;
        if (p.e !== t.e || p.st !== t.st || JSON.stringify(p.tg) !== JSON.stringify(t.tg)) recomputed++;
      }
      put(dir, r.doc);
      prev = r.doc;
    }
    expect(both).toBeGreaterThan(20);          // رموزٌ ظهرت في ساعتين متتاليتين فعلاً
    expect(recomputed).toBeGreaterThan(0);     // وخطّتُها أُعيد حسابها لا أُورثت
  });

  it("كلُّ فرصة مكتملة ومرتّبة بالدرجة", () => {
    const dir = tmp(), H = hours[hours.length - 1];
    const r = build({ now: H + 3 * 60000, out: dir, barsDir: storeAt(dir, H + 3 * 60000) });
    expect(r.doc.open.every((t, i) => !i || r.doc.open[i - 1].score >= t.score)).toBe(true);
    for (const t of r.doc.open) {
      expect(t.tg.length).toBeGreaterThanOrEqual(2);
      expect((t.e - t.st) * t.d).toBeGreaterThan(0);
      expect(t.tg.every((x) => (x.p - t.e) * t.d > 0)).toBe(true);
      expect(["day", "ma"]).toContain(t.base);
      expect(t.score).toBeGreaterThanOrEqual(40);
    }
  });
});
