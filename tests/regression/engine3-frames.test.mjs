/* §4ج — الاستراتيجيات الخمس على الفريمات الأربعة ودورة حياة الصفقة (قرار المالك 2026-10-03).
   ١) النقاط مرّةً واحدة مهما تعدّدت الفريمات: A (المتوسطات 15د + أمس ساعة) = 80 · B (أمس 4س) = 40 ·
      C (أمس 15د+ساعة+4س) = 40 والفريمات الثلاثة معلنة.
   ٢) لا يُشترط توافق الفريمات: إشارةٌ على فريمٍ واحد تكفي، والفريم الأعلى غير المتحقّق لا يلغيها.
   ٣) أنواع حركة السعر حول المستوى: عبور بإغلاق · ثبات بعد عبور · عاد · فوق/تحت منذ الافتتاح · داخل —
      شراءً وبيعاً، والافتتاح فوق القمة ليس اختراقاً جديداً.
   ٤) ترتيب متوسطاتٍ مستمرّ ليس إشارةً جديدة؛ الانقلاب بإغلاق شمعة هو الإشارة.
   ٥) لا شمعة جارية ولا مستقبل: تشويه ما بعد H لا يغيّر قرار اللقطة.
   ٦) WLD (2026-10-03) على شموعها الحقيقية: الصفقة المفعّلة تبقى بخطتها حتى تنتهي بقواعدها،
      ولا تتكرّر خلال دورة حياتها — العلّة كانت بوّابة المخاطرة تُعاد على صفقةٍ دخلت.
   لا يكتب في المثبّتات. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prep, prepCrypto, inputAt, isoWeek, evalSlot, stepOver } from "../../scripts/lib/engine3-run.mjs";
import { build } from "../../scripts/build-trades.mjs";
import { synth } from "../property/synth3.mjs";

const require = createRequire(import.meta.url);
const E = require("../../stocks/engine3.js");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const wkOf = (d) => isoWeek(d);

/* حالة فريماتٍ مصطنعة: كلُّ شيءٍ محايد إلا ما يُمرَّر */
function fa(over, trendDir = 0) {
  const fr = {};
  for (const tf of E.E3_TFS) fr[tf] = { day: tf === "1d" ? { kind: "ref", open: 0 } : { kind: "inside" },
    week: { kind: "inside" }, ma: { dir: 0, flip: false, ok: true }, vwap: tf === "1d" ? null : { side: 0 }, trend: 0 };
  for (const [tf, o] of Object.entries(over)) Object.assign(fr[tf], o);
  return { st: { trend: { dir: trendDir } }, fr };
}
const brk = (d) => ({ kind: "break", d, holds: true, evt: d > 0 ? "pdh_break" : "pdl_break" });
const hold = (d) => ({ kind: "hold", d, holds: true, evt: d > 0 ? "pdh_break" : "pdl_break" });

describe("النقاط مرّةً واحدة لكل استراتيجية", () => {
  it("A: المتوسطات على 15د وأمس على الساعة = 80", () => {
    const s = E.scoreFrames(fa({ "15m": { ma: { dir: 1, ok: true } }, "1h": { day: brk(1) } }), 1);
    expect(s.score).toBe(80);
    expect(s.tfs.ma).toEqual(["15m"]);
    expect(s.tfs.day).toEqual(["1h"]);
  });
  it("B: أمس على 4س وحدها = 40", () => {
    const s = E.scoreFrames(fa({ "4h": { day: brk(1) } }), 1);
    expect(s.score).toBe(40);
    expect(s.tfs.day).toEqual(["4h"]);
  });
  it("C: أمس على 15د والساعة و4س = 40 مرّةً واحدة، والفريمات الثلاثة معلنة", () => {
    const s = E.scoreFrames(fa({ "15m": { day: brk(1) }, "1h": { day: hold(1) }, "4h": { day: hold(1) } }), 1);
    expect(s.score).toBe(40);
    expect(s.pts.day).toBe(40);
    expect(s.tfs.day).toEqual(["15m", "1h", "4h"]);
  });
  it("كلُّ الاستراتيجيات على كل الفريمات لا تتجاوز 100، والتعارض يُسجَّل لا يُطرح", () => {
    const all = {};
    for (const tf of ["15m", "1h", "4h"]) all[tf] = { day: hold(1), week: hold(1), ma: { dir: 1, ok: true }, vwap: { side: 1 } };
    all["1d"] = { ma: { dir: -1, ok: true }, week: hold(-1) };
    const s = E.scoreFrames(fa(all, 1), 1);
    expect(s.score).toBe(100);
    expect(s.opp.ma).toEqual(["1d"]);
    expect(s.opp.week).toEqual(["1d"]);
  });
  it("الاتجاه يبقى إجماع 1h/4h/1d — اتجاه 15د وحده لا يمنح نقاطه", () => {
    const f = fa({ "15m": { trend: 1 } }, 0);
    const s = E.scoreFrames(f, 1);
    expect(s.pts.trend).toBe(0);
    expect(s.tfs.trend).toEqual(["15m"]);
    expect(E.scoreFrames(fa({}, 1), 1).pts.trend).toBe(6.67);
  });
});

describe("لا يُشترط توافق الفريمات، والإشارة الجديدة وحدها تُنشئ فرصة", () => {
  const P = 1000;
  it("أمس على 4س وحدها والبقية محايدة ⇒ مرشّحٌ بأساس أمس على 4س", () => {
    const f = fa({ "4h": { day: { ...brk(1), evEnd: P + 1 } } });
    const c = E.slotCands(f, P);
    expect(c.map((x) => [x.base, x.tf, x.d])).toEqual([["day", "4h", 1]]);
  });
  it("الفريم الأعلى المعاكس لا يلغي فرصة الأدنى — يُسجَّل تعارضاً", () => {
    const f = fa({ "15m": { day: { ...brk(1), evEnd: P + 2 } }, "4h": { ma: { dir: -1, flip: true, ok: true, end: P + 1 } } });
    const c = E.slotCands(f, P);
    expect(c[0]).toMatchObject({ base: "day", tf: "15m", d: 1 });
    expect(c.some((x) => x.d === -1)).toBe(true);
  });
  it("ترتيب متوسطاتٍ مستمرّ ليس إشارة؛ الانقلاب بإغلاق شمعةٍ في النافذة هو الإشارة", () => {
    expect(E.slotCands(fa({ "1d": { ma: { dir: 1, flip: false, ok: true, end: P + 1 } } }), P)).toEqual([]);
    expect(E.slotCands(fa({ "1d": { ma: { dir: 1, flip: true, ok: true, end: P - 1 } } }), P)).toEqual([]);   // انقلابٌ قديم
    expect(E.slotCands(fa({ "1d": { ma: { dir: 1, flip: true, ok: true, end: P + 1 } } }), P)[0]).toMatchObject({ base: "ma", tf: "1d" });
  });
  it("عبورٌ قديم ما زال قائماً ليس إشارةً جديدة", () => {
    expect(E.slotCands(fa({ "15m": { day: { ...hold(1), evEnd: P - 1 } } }), P)).toEqual([]);
  });
  it("أمس يسبق المتوسطات، وبين الفريمات الأحدثُ ثم الأدقّ", () => {
    const f = fa({ "15m": { ma: { dir: 1, flip: true, ok: true, end: P + 9 } }, "1h": { day: { ...brk(1), evEnd: P + 5 } },
                   "4h": { day: { ...brk(1), evEnd: P + 5 } } });
    expect(E.slotCands(f, P)[0]).toMatchObject({ base: "day", tf: "1h" });
  });
});

describe("نوع حركة السعر حول المستوى (H=100 · L=90)", () => {
  const b = (o, c, i) => ({ t: i, o, h: Math.max(o, c), l: Math.min(o, c), c, end: i + 1 });
  const k = (bars) => E.levelKind(bars.map((x, i) => b(x[0], x[1], i)), 100, 90, "pd");
  it("شراء: عبورٌ بإغلاق · ثباتٌ بعده · افتتاحٌ فوق القمة بلا عبور ليس اختراقاً", () => {
    expect(k([[95, 96], [99, 101]])).toMatchObject({ kind: "break", evt: "pdh_break", d: 1 });
    expect(k([[99, 101], [101, 103]])).toMatchObject({ kind: "hold", evt: "pdh_break", d: 1, holds: true });
    expect(k([[102, 103], [103, 104]])).toMatchObject({ kind: "open_above", side: 1 });
    expect(k([[102, 103], [103, 104]]).evt).toBeUndefined();
  });
  it("بيع: كسرٌ بإغلاق · ثباتٌ تحته · افتتاحٌ تحت القاع · وعودةٌ عبر المستوى", () => {
    expect(k([[92, 91], [91, 89]])).toMatchObject({ kind: "break", evt: "pdl_break", d: -1 });
    expect(k([[91, 89], [89, 88]])).toMatchObject({ kind: "hold", d: -1 });
    expect(k([[88, 87], [87, 86]])).toMatchObject({ kind: "open_below", side: -1 });
    expect(k([[99, 101], [101, 100.5], [100.5, 99.5]]).kind).toBe("break");     // فقد القمة حدثٌ جديد معاكس
    expect(k([[99, 101], [100.5, 99.8], [99.8, 99.5]])).toMatchObject({ kind: "hold", evt: "pdh_loss", d: -1 });   // فُقدت قبل شمعة
    expect(k([[99, 101], [101, 99.5], [99.5, 100.5]])).toMatchObject({ kind: "break", evt: "pdh_break" });          // عادت فوقها بعبورٍ جديد
    expect(k([[95, 96], [96, 97]])).toMatchObject({ kind: "inside" });
  });
});

describe("لا شمعة جارية ولا نظر إلى المستقبل في قرار اللقطة", () => {
  const A = synth(7, 240), S = prep(A.b15, A.b1d);
  const from = S.r15.findIndex((x) => x.t >= Date.parse("2025-06-01"));
  it("تشويه كل ما بعد H (±8% وأكثر) لا يغيّر القرار ولا حالة الفريمات", () => {
    let tested = 0;
    for (let i = from; i < S.r15.length && tested < 12; i += 37) {
      const T = S.r15[i].end;
      if (T % 1800000 !== 0) continue;
      const a = evalSlot(S, T, T - 1800000).r;
      const mut = A.b15.map((x) => x.t >= T ? { ...x, o: x.o * 1.08, h: x.h * 1.3, l: x.l * 0.7, c: x.c * 0.92, v: x.v * 5 } : x);
      const d1m = A.b1d.map((x) => x.t >= T - 12 * 3600e3 ? { ...x, h: x.h * 1.5, l: x.l * 0.5 } : x);
      const b = evalSlot(prep(mut, d1m), T, T - 1800000).r;
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      tested++;
    }
    expect(tested).toBeGreaterThan(5);
  });
});

describe("WLD 2026-10-03 — على شموعها الحقيقية", () => {
  const rec = JSON.parse(fs.readFileSync(path.join(HERE, "../fixtures/v3/WLD-USD-2026-10-03.json"), "utf8"));
  const S = { "WLD-USD": prepCrypto(rec) };
  const H0 = Date.parse("2026-10-03T10:15:00Z"), H1 = Date.parse("2026-10-03T18:15:00Z");
  it("الصفقة المفعّلة تبقى بخطتها حتى تنتهي بقواعدها ولا تتكرّر — والمحرّك القديم كان يُسقطها بالمخاطرة", () => {
    let state = null, born = null, slotsActive = 0;
    const oldRejects = [];
    for (let H = H0; H <= H1; H += 900000) {          // كلَّ ربع ساعة كالحيّ (V4.2)
      const r = build({ now: H + 60000, book: "crypto", out: "/nonexistent", S, state });
      expect(r.ok).toBe(true);
      state = JSON.parse(JSON.stringify(r.state));
      const all = [...r.doc.open, ...r.doc.active];
      expect(all.filter((t) => t.s === "WLD-USD").length).toBeLessThanOrEqual(1);   // لا تكرار
      const t = all.find((x) => x.s === "WLD-USD");
      if (born) {
        expect(t, new Date(H).toISOString()).toBeTruthy();                           // لا اختفاء قبل الوقف/الهدف
        expect([t.e, t.st, JSON.stringify(t.tg)]).toEqual(born.plan);
        slotsActive++;
      } else if (t && r.doc.open.includes(t)) born = { id: t.id, plan: [t.e, t.st, JSON.stringify(t.tg)], H };
      const old = E.evaluateHour(inputAt(S["WLD-USD"], S["WLD-USD"].r15.findIndex((b) => b.end === H)), wkOf);
      if (old.reject === "risk") oldRejects.push(new Date(H).toISOString().slice(11, 16));
    }
    expect(born).toBeTruthy();
    expect(new Date(born.H).toISOString()).toBe("2026-10-03T11:00:00.000Z");      // كسر قمة أمس على الساعة — عند إغلاق شمعتها نفسها (V4.2؛ كانت 11:15 بلقطة الثلاثين)
    expect(slotsActive).toBeGreaterThanOrEqual(12);
    expect(oldRejects).toEqual(expect.arrayContaining(["12:15", "14:15", "14:45", "15:15"]));
  });
  it("الإدارة نفسها خارج البناء: لا وقف ولا هدف حتى 18:15 (أعلى سعر 0.6151 والهدف الأول 0.6451)", () => {
    const S1 = S["WLD-USD"], H = Date.parse("2026-10-03T11:15:00Z");
    const r = evalSlot(S1, H, H - 1800000).r;
    expect(r.reject).toBeNull();
    expect(r.sig.baseTf).toBe("1h");
    expect(r.sig.score).toBe(100);
    const tr = { d: r.sig.d, e: r.sig.e, st: r.sig.st, tg: r.sig.tg, risk: r.sig.risk, atrD: r.sig.atrD, status: "confirmed" };
    stepOver(tr, S1, H, Date.parse("2026-10-03T18:15:00Z"));
    expect(tr.status).toBe("active");
    expect(tr.hit).toBe(0);
  });
});
