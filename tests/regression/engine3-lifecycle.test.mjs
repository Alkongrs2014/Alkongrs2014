/* لقطات المحرّك V3 ودورة حياة الصفقة (§4ج، قرار المالك 2026-10-03) — على مخزن SIP اصطناعي
   في مجلّدٍ مؤقّت:
   ١) داخل اللقطة الواحدة: نفس اللقطة مهما تقدّمت الساعة أو تحرّكت الشمعة الجارية.
   ٢) الصفقة بعد إصدارها تُحمَل بخطتها نفسها (دخول/وقف/أهداف) حتى تنتهي بوقفٍ أو آخر هدف أو
      انقضاء مدّتها — ولا تختفي بصمت، ولا تتكرّر للرمز نفسه خلال دورة حياتها.
   ٣) البناء التزايديّ من الحالة على القرص = البناء المتسلسل في الذاكرة حرفياً.
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

  it("الصفقة تُحمَل بخطتها حتى تنتهي بقواعدها، بلا تكرارٍ ولا اختفاءٍ صامت، والتزايديّ = المتسلسل", () => {
    const dir = tmp();
    let mem = null, carried = 0, ended = 0;
    const plan = new Map(), live = new Map();
    for (const H of hours) {
      const now = H + 3 * 60000;
      const bars = storeAt(dir, now);
      const r = build({ now, out: dir, barsDir: bars });                       // من الحالة على القرص
      const m = build({ now, out: tmp(), barsDir: bars, state: mem });          // متسلسلٌ في الذاكرة
      expect(r.ok && m.ok).toBe(true);
      expect(r.same).toBeFalsy();
      expect(r.doc.rowsHash).toBe(m.doc.rowsHash);
      fs.writeFileSync(path.join(dir, "trades-state.json"), JSON.stringify(r.state));
      put(dir, r.doc);
      mem = JSON.parse(JSON.stringify(m.state));
      // كلُّ جديدة مولودةٌ في لقطتها، وصفقةٌ واحدة لكل رمز بين الجديدة والقائمة
      for (const t of r.doc.open) { expect(t.h).toBe(r.doc.hour); expect(t.id).toBe(`${t.s}|${r.doc.hour}`); }
      const syms = [...r.doc.open, ...r.doc.active].map((t) => t.s);
      expect(new Set(syms).size).toBe(syms.length);
      // الخطة مثبّتة: القائمة تحمل أرقام إصدارها بالحرف
      for (const t of r.doc.active) {
        expect(t.h).toBeLessThan(r.doc.hour);
        expect(plan.get(t.id)).toBe(JSON.stringify([t.e, t.st, t.tg]));
        carried++;
      }
      for (const t of r.doc.open) plan.set(t.id, JSON.stringify([t.e, t.st, t.tg]));
      // لا اختفاء صامت: ما غاب من الجديدة/القائمة موجودٌ في المنتهية بسببٍ من قواعدها
      const here = new Set([...r.doc.open, ...r.doc.active].map((t) => t.id));
      const done = new Map(r.doc.closed.map((t) => [t.id, t]));
      for (const id of live.keys()) if (!here.has(id)) {
        const c = done.get(id);
        expect(c, id).toBeTruthy();
        expect(["stop", "be", "tgt", "exp", "gap"]).toContain(c.end.k);
        ended++;
      }
      live.clear(); for (const id of here) live.set(id, 1);
    }
    expect(carried).toBeGreaterThan(20);       // صفقاتٌ عبرت لقطاتٍ فعلاً
    expect(ended).toBeGreaterThan(0);          // وانتهت بقواعدها
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
