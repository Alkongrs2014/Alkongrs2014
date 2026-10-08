/* لا فرصة بلا تداولٍ في آخر 15 دقيقة (قرار المالك 2026-10-01، INV-67) — على مخزن SIP اصطناعي:
   ١) كلُّ فرصةٍ منشورة دخولُها من شمعة اللقطة نفسها (t = candleKey) في كل لقطات يومٍ كامل،
      ممتدّاً ورسمياً.
   ٢) رمزٌ بلا شمعةٍ في آخر ربع ساعة يُستبعد وحده: بقية الفرص كما هي حرفياً، والسبب في stats.
   ٣) الاستبعاد مؤقّت: حين تأتي شمعةٌ فيها تداول تعود الفرصة بنفس أرقام البناء من الصفر.
   لا يكتب في المثبّتات: كلُّ شيءٍ في مجلّدٍ مؤقّت. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "../../scripts/build-trades.mjs";
import { prep, evalSlot } from "../../scripts/lib/engine3-run.mjs";
import { synth, writeStore } from "../property/synth3.mjs";

const SES = createRequire(import.meta.url)("../../stocks/session.js");
const M15 = 15 * 60000;
const SYMS = ["AAPL", "NVDA", "MSFT", "AMD", "META", "CRM", "PANW", "COST"];
const DATA = SYMS.map((s, i) => [s, synth(31 + i, 200)]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "v3-fresh-"));
function storeAt(dir, now, drop = null) {
  const bars = path.join(dir, "bars", "alpaca_sip");
  for (const [s, d] of DATA) {
    const b15 = drop && drop.s === s ? d.b15.filter((b) => b.t !== drop.t) : d.b15;
    writeStore(fs, path, bars, s, { b15, b1d: d.b1d }, now);
  }
  return bars;
}
const run = (H, drop) => { const dir = tmp(); const now = H + 4 * 60000;
  return build({ now, out: dir, barsDir: storeAt(dir, now, drop), fresh: true }); };
/* لقطاتٌ فيها إشارة: شرط 15د (قرار 2026-10-08) أندر من «أمس أو المتوسطات»، فلا يكفي آخر يوم —
   تُمسح آخر 90 يوماً في الذاكرة (`evalSlot`، بلا كتابة) وتُؤخذ أوّل 12 لقطةٍ فيها فرصةٌ لرمزٍ ما،
   ممتدّةً ورسمية، ثم تُبنى كاملةً على المخزن كما كانت. */
const lastT = DATA[0][1].b15[DATA[0][1].b15.length - 1].t;
const PREP = DATA.map(([s, d]) => [s, prep(d.b15, d.b1d)]);
const slots = [];
for (let k = 90; k >= 0 && slots.length < 12; k--)
  for (const H of SES.scanSlotsOf(lastT - k * 86400000)) {
    if (H > lastT || slots.length >= 12) continue;
    if (PREP.some(([, S]) => { const x = evalSlot(S, H, SES.scanSlotAt(H - 1)); return x.i >= 0 && !x.r.reject && S.r15[x.i].t === H - M15; })) slots.push(H);
  }

describe("INV-67 — لا دخولٌ من شمعةٍ أقدم من شمعة اللقطة", () => {
  // تنازلٌ عن الحلقة بين اللقطات: بخطوة 15 دقيقة (V4.1) تضاعفت اللقطات فصار الحجب المتزامن يُسقط
  // عامل vitest بمهلة RPC «onTaskUpdate» والاختبارات ناجحة
  const yieldLoop = () => new Promise((r) => setImmediate(r));
  it("كلُّ فرصةٍ في كل لقطةٍ على شمعة اللقطة", async () => {
    let n = 0;
    for (const H of slots) {
      await yieldLoop();
      const r = run(H);
      expect(r.ok).toBe(true);
      for (const t of r.doc.open) { expect(t.t).toBe(r.doc.candleKey); n++; }
    }
    expect(slots.length).toBeGreaterThanOrEqual(8);
    expect(n).toBeGreaterThanOrEqual(slots.length);
  });

  it("الاستبعاد للرمز بلا تداول وحده، ومؤقّت", async () => {
    let tested = 0;
    for (const H of slots) {
      await yieldLoop();
      const base = run(H);
      const victim = base.doc.open[0];
      if (!victim) continue;
      const cut = run(H, { s: victim.s, t: H - M15 });          // لا تداول للرمز في آخر ربع ساعة
      expect(cut.doc.open.some((t) => t.s === victim.s)).toBe(false);
      // §4ج: الشمعة المحذوفة قد تكون نفسَها شمعةَ الإشارة الجديدة، فيُستبعد الرمز بلا إشارة (nobase)
      // أو بلا تداول (notrade) — والسبب في stats بأيٍّ منهما
      expect((cut.doc.stats.notrade || 0) + (cut.doc.stats.nobase || 0)).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(cut.doc.open)).toBe(JSON.stringify(base.doc.open.filter((t) => t.s !== victim.s)));
      // تعود حين تأتي شمعةٌ فيها تداول: لقطةُ الحدّ نفسه بلا حذفٍ = الأصل حرفياً
      const back = run(H);
      expect(back.doc.open.find((t) => t.s === victim.s)).toEqual(victim);
      tested++;
    }
    expect(tested).toBeGreaterThanOrEqual(8);
  });
});
