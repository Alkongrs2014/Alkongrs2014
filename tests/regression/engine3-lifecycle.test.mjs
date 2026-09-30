/* المسار الحيّ للمحرّك V3 (build-trades) على مخزن SIP اصطناعي في مجلّدٍ مؤقّت:
   ١) لا يتغيّر شيءٌ داخل الشمعة الواحدة (الشمعة الجارية لا تدخل CONFIRMED).
   ٢) الصفقة النشطة لا تختفي بعد الدخول — تبقى مفتوحةً أو تُغلق بسببها.
   ٣) البناء التزايديّ شمعةً شمعة = البناء المتواصل (الحيّ = المقيس).
   لا يكتب في المثبّتات: كلُّ شيءٍ في مجلّدٍ مؤقّت. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "../../scripts/build-trades.mjs";
import { synth, writeStore } from "../property/synth3.mjs";

const SYMS = ["AAPL", "NVDA", "MSFT"];
const DATA = SYMS.map((s, i) => [s, synth(11 + i, 200)]);
const all15 = DATA[0][1].b15;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "v3-life-"));
/* مخزنٌ يحوي كلَّ ما «حدث» حتى لحظة now — بما فيها شمعةٌ جارية لم تُغلق */
function storeAt(dir, now) {
  const bars = path.join(dir, "bars", "alpaca_sip");
  for (const [s, d] of DATA) writeStore(fs, path, bars, s, d, now);
  return bars;
}
const run = (dir, now) => {
  const bars = storeAt(dir, now);
  const r = build({ now, out: dir, barsDir: bars });
  if (r.ok && !r.same) {
    fs.writeFileSync(path.join(dir, "trades.json"), JSON.stringify(r.doc));
    fs.writeFileSync(path.join(dir, "trades-state.json"), JSON.stringify(r.state));
  }
  return r;
};
// نهايات شموعٍ في آخر ستين جلسة من العيّنة
const ends = all15.map((b) => b.t + 900000).filter((t) => t > all15[all15.length - 1].t - 60 * 86400000);

describe("engine3 — المسار الحيّ", () => {
  it("داخل الشمعة الواحدة: نفس البصمة مهما تقدّمت الساعة أو تحرّكت الشمعة الجارية", () => {
    const T = ends[Math.floor(ends.length / 2)];
    const a = build({ now: T + 60000, out: tmp(), barsDir: storeAt(tmp(), T + 60000), fresh: true });
    const d2 = tmp();
    const b = build({ now: T + 13 * 60000, out: d2, barsDir: storeAt(d2, T + 13 * 60000), fresh: true });
    expect(a.ok && b.ok).toBe(true);
    expect(a.doc.candleKey).toBe(b.doc.candleKey);
    expect(a.doc.rowsHash).toBe(b.doc.rowsHash);
  });

  it("الصفقة النشطة لا تختفي، والبناء التزايديّ = البناء المتواصل", () => {
    const dir = tmp();
    const steps = ends.slice(-120);          // ~5 جلسات شمعةً شمعة
    let prev = null, seenActive = 0, vanished = [];
    for (const T of steps) {
      const r = run(dir, T + 60000);
      expect(r.ok).toBe(true);
      const doc = JSON.parse(fs.readFileSync(path.join(dir, "trades.json"), "utf8"));
      if (prev) {
        const ids = new Set([...doc.open, ...doc.closed].map((t) => t.id));
        for (const t of prev.open) if (t.status === "active") { seenActive++; if (!ids.has(t.id)) vanished.push(t.id); }
        // والصفقة التي بقيت مفتوحة تحمل نفس دخولها ووقفها الأصليّ وأهدافها
        for (const t of doc.open) {
          const p = prev.open.find((x) => x.id === t.id);
          if (p) expect([t.e, t.st, JSON.stringify(t.tg)]).toEqual([p.e, p.st, JSON.stringify(p.tg)]);
        }
      }
      prev = doc;
    }
    expect(seenActive).toBeGreaterThan(2);
    expect(vanished).toEqual([]);
    // التزايديّ يطابق بناءً متواصلاً يبدأ من نفس نافذة الإحماء
    const inc = JSON.parse(fs.readFileSync(path.join(dir, "trades.json"), "utf8"));
    const d2 = tmp();
    const first = run(d2, steps[0] + 60000);
    expect(first.ok).toBe(true);
    const cont = run(d2, steps[steps.length - 1] + 60000);
    const doc2 = JSON.parse(fs.readFileSync(path.join(d2, "trades.json"), "utf8"));
    expect(doc2.rowsHash).toBe(inc.rowsHash);
    expect(cont.ok).toBe(true);
  });

  it("لقطةٌ مرتّبة بالدرجة، وكلُّ صفقةٍ مكتملة (دخول ووقف وهدفان على الأقل)", () => {
    const dir = tmp();
    run(dir, ends[ends.length - 1] + 60000);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, "trades.json"), "utf8"));
    expect(doc.open.every((t, i) => !i || doc.open[i - 1].score >= t.score)).toBe(true);
    for (const t of [...doc.open, ...doc.closed]) {
      expect(t.tg.length).toBeGreaterThanOrEqual(2);
      expect((t.e - t.st) * t.d).toBeGreaterThan(0);
      expect(t.tg.every((x) => (x.p - t.e) * t.d > 0)).toBe(true);
      expect(["day", "ma"]).toContain(t.base);
    }
  });
});
