/* §4ج — الاستراتيجيات الخمس على الفريمات ودورة حياة الصفقة (قرار المالك 2026-10-03)، والمتوسطات
   البسيطة بأوزانها الجديدة (قرار المالك 2026-10-08).
   ١) الأوزان: المتوسطات 60 (15د 30 · ساعة 20 · 4س 10) · أمس 20 · VWAP 10 · الأسبوع 5 · الاتجاه 5،
      والبقية مرّةً واحدة مهما تعدّدت الفريمات.
   ٢) لا فرصة بلا شرط 15د: أوّلُ افتتاحٍ عبر SMA200 بترتيب SMA35/50 المعاكس، بشمعةٍ أُغلقت في النافذة.
      عبورُ أمس والساعة و4س تقييمٌ لا مُنشئ.
   ٣) حالاتٌ ذهبية محسوبةٌ يدوياً لشروط الفريمات الثلاثة (صعوداً وهبوطاً، والحدود الصارمة).
   ٤) أنواع حركة السعر حول المستوى (أمس/الأسبوع) كما كانت.
   ٥) لا شمعة جارية ولا مستقبل: تشويه ما بعد H لا يغيّر قرار اللقطة.
   ٦) WLD على شموعها الحقيقية: الصفقة تبقى بخطتها حتى تنتهي بقواعدها ولا تتكرّر.
   لا يكتب في المثبّتات. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prep, prepCrypto, evalSlot } from "../../scripts/lib/engine3-run.mjs";
import { build } from "../../scripts/build-trades.mjs";
import { synth } from "../property/synth3.mjs";

const require = createRequire(import.meta.url);
const E = require("../../stocks/engine3.js");
const HERE = path.dirname(fileURLToPath(import.meta.url));

/* حالة فريماتٍ مصطنعة: كلُّ شيءٍ محايد إلا ما يُمرَّر */
const MA0 = { up: false, dn: false, dir: 0, ev: 0, flip: false, ok: true };
function fa(over, trendDir = 0) {
  const fr = {};
  for (const tf of E.E3_TFS) fr[tf] = { day: tf === "1d" ? { kind: "ref", open: 0 } : { kind: "inside" },
    week: { kind: "inside" }, ma: { ...MA0, na: tf === "1d" }, vwap: tf === "1d" ? null : { side: 0 }, trend: 0 };
  for (const [tf, o] of Object.entries(over)) Object.assign(fr[tf], o);
  return { st: { trend: { dir: trendDir } }, fr };
}
const brk = (d) => ({ kind: "break", d, holds: true, evt: d > 0 ? "pdh_break" : "pdl_break" });
const hold = (d) => ({ kind: "hold", d, holds: true, evt: d > 0 ? "pdh_break" : "pdl_break" });
const up = (x = {}) => ({ ma: { ...MA0, up: true, dir: 1, ...x } });
const dn = (x = {}) => ({ ma: { ...MA0, dn: true, dir: -1, ...x } });

describe("الأوزان ونقاط الفريمات (قرار 2026-10-08)", () => {
  it("مجموع الأوزان 100 ونقاط المتوسطات 30/20/10 = 60", () => {
    const W = E.E3.W;
    expect(W.ma + W.day + W.vwap + W.week + W.trend).toBe(100);
    expect([W.ma, W.day, W.vwap, W.week, W.trend]).toEqual([60, 20, 10, 5, 5]);
    expect(E.E3.MA_TF).toEqual({ "15m": 30, "1h": 20, "4h": 10 });
  });
  it("15د وحده = 30، ومعه أمس على الساعة = 50", () => {
    const s = E.scoreFrames(fa({ "15m": up(), "1h": { day: brk(1) } }), 1);
    expect(s.pts.ma).toBe(30);
    expect(s.score).toBe(50);
    expect(s.tfs.ma).toEqual(["15m"]);
    expect(s.el.ma).toBe(true);
  });
  it("المتوسطات على الثلاثة = 60، والخمس كلُّها = 100، والتعارض يُسجَّل لا يُطرح", () => {
    const all = {};
    for (const tf of ["15m", "1h", "4h"]) all[tf] = { day: hold(1), week: hold(1), vwap: { side: 1 }, ...up() };
    all["1d"] = { week: hold(-1) };
    const s = E.scoreFrames(fa(all, 1), 1);
    expect(s.pts).toEqual({ day: 20, ma: 60, trend: 5, vwap: 10, week: 5 });
    expect(s.score).toBe(100);
    expect(s.opp.week).toEqual(["1d"]);
  });
  it("الساعة و4س بلا 15د: نقاطُهما 30 لكن المتوسطات «غير متحقّقة» (الأساس 15د)", () => {
    const s = E.scoreFrames(fa({ "1h": up(), "4h": up() }), 1);
    expect(s.pts.ma).toBe(30);
    expect(s.el.ma).toBe(false);
  });
  it("الهبوط مرآة الصعود", () => {
    expect(E.scoreFrames(fa({ "15m": dn(), "4h": dn() }), -1).pts.ma).toBe(40);
    expect(E.scoreFrames(fa({ "15m": dn() }), 1).pts.ma).toBe(0);
  });
  it("الاتجاه يبقى إجماع 1h/4h/1d بوزن 5 — اتجاه 15د وحده لا يمنح نقاطه", () => {
    const s = E.scoreFrames(fa({ "15m": { trend: 1 } }, 0), 1);
    expect(s.pts.trend).toBe(0);
    expect(s.tfs.trend).toEqual(["15m"]);
    expect(E.scoreFrames(fa({}, 1), 1).pts.trend).toBe(5);
  });
});

describe("لا فرصة بلا شرط 15د", () => {
  const P = 1000;
  it("حدث 15د في النافذة ⇒ مرشّحٌ وحيد بأساس المتوسطات على 15د، صعوداً وهبوطاً", () => {
    expect(E.slotCands(fa({ "15m": up({ ev: 1, flip: true, end: P + 1 }) }), P)).toEqual([{ base: "ma", tf: "15m", d: 1, end: P + 1, o: 0 }]);
    expect(E.slotCands(fa({ "15m": dn({ ev: -1, flip: true, end: P + 1 }) }), P)[0]).toMatchObject({ d: -1, tf: "15m" });
  });
  it("حدثٌ قديم (شمعته قبل النافذة) ليس إشارة، وحالةٌ قائمة بلا حدث ليست إشارة", () => {
    expect(E.slotCands(fa({ "15m": up({ ev: 1, flip: true, end: P - 1 }) }), P)).toEqual([]);
    expect(E.slotCands(fa({ "15m": up({ end: P + 1 }) }), P)).toEqual([]);
  });
  it("عبور أمس وتأكيد الساعة و4س وحدها لا تُنشئ فرصة", () => {
    const f = fa({ "15m": { day: { ...brk(1), evEnd: P + 1 } }, "1h": { day: { ...brk(1), evEnd: P + 1 }, ...up({ end: P + 1 }) },
                   "4h": up({ end: P + 1 }) });
    expect(E.slotCands(f, P)).toEqual([]);
  });
});

/* حالاتٌ ذهبية محسوبةٌ يدوياً. كلُّ متوسطٍ على إغلاقات ما قبل الشمعة المقيسة. */
describe("شروط المتوسطات — حالاتٌ ذهبية", () => {
  const mk = (closes, over) => {
    const bars = closes.map((c, i) => ({ t: i, o: c, h: c, l: c, c, end: i + 1 }));
    for (const [k, o] of Object.entries(over)) Object.assign(bars[Number(k)], o);
    return bars;
  };
  /* 15د: 150 إغلاقاً عند 110 ثم 53 عند 90 (203 شمعة، الأخيرة 202):
       SMA200 حتى 201 = (148×110 + 52×90)/200 = 104.8 · وحتى 200 = (149×110 + 51×90)/200 = 104.9
       SMA35 = SMA50 = 90 < 104.8  ⇒ صعودٌ إن افتتحت 202 فوق 104.8 وافتتحت 201 عند/تحت 104.9 */
  const up15 = (o201, o202) => E.smaFrame("15m", mk([...Array(150).fill(110), ...Array(53).fill(90)], { 201: { o: o201 }, 202: { o: o202 } }));
  it("15د صعود: أوّلُ افتتاحٍ فوق SMA200 بـ35/50 تحته", () => {
    const r = up15(100, 105);
    expect(r.v.base).toBeCloseTo(104.8, 10);
    expect(r.v.f35).toBe(90);
    expect(r.ev).toBe(1);
    expect(r.up).toBe(true);
  });
  it("15د: الافتتاح عند SMA200 تماماً ليس فوقه، وافتتاحُ السابقة فوقه يجعلها ليست الأولى", () => {
    expect(up15(100, 104.8).ev).toBe(0);
    expect(up15(104.95, 105).ev).toBe(0);
    expect(up15(104.9, 105).ev).toBe(1);                 // السابقة عند مستواها (104.9) = ليست فوقه
  });
  /* الهبوط: 150 عند 90 ثم 53 عند 110: SMA200 حتى 201 = 95.2 · حتى 200 = 95.1 · و35/50 = 110 فوقه */
  it("15د هبوط: أوّلُ افتتاحٍ تحت SMA200 بـ35/50 فوقه", () => {
    const r = E.smaFrame("15m", mk([...Array(150).fill(90), ...Array(53).fill(110)], { 201: { o: 100 }, 202: { o: 95 } }));
    expect(r.v.base).toBeCloseTo(95.2, 10);
    expect(r.ev).toBe(-1);
  });
  it("15د: افتتاحٌ فوق SMA200 و35/50 فوقه أيضاً ليس شرط الصعود", () => {
    const r = E.smaFrame("15m", mk([...Array(150).fill(90), ...Array(53).fill(110)], { 201: { o: 95 }, 202: { o: 96 } }));
    expect(r.ev).toBe(0);
    expect(r.up).toBe(true);
  });
  /* الساعة: 51 إغلاقاً عند 100 ⇒ SMA50 حتى 50 = 100، والشمعة 51 تُقاس بافتتاحها */
  it("الساعة: افتتاحُ آخر شمعة فوق/تحت SMA50", () => {
    const h = (o) => E.smaFrame("1h", mk(Array(52).fill(100), { 51: { o } }));
    expect([h(101).up, h(101).dn]).toEqual([true, false]);
    expect([h(99).up, h(99).dn]).toEqual([false, true]);
    expect([h(100).up, h(100).dn]).toEqual([false, false]);
  });
  /* 4س: 16 إغلاقاً عند 100 ⇒ SMA15 = 100 حتى 15 وحتى 14؛ والشمعة 16 */
  it("4س: افتتاحٌ أو منتصف جسمٍ في الجهة أو إغلاقٌ يخترق SMA15", () => {
    const q = (o, c) => E.smaFrame("4h", mk(Array(17).fill(100), { 16: { o, c } }));
    expect(q(101, 100.2)).toMatchObject({ up: true, dn: false, dir: 1 });   // افتتاحٌ ومنتصف فوقه
    expect(q(98, 99)).toMatchObject({ up: false, dn: true, dir: -1 });
    expect(q(99, 103)).toMatchObject({ up: true, dn: true });               // منتصف 101 وإغلاقٌ مخترق، والافتتاح تحته
    expect(q(99.5, 100.4)).toMatchObject({ up: true });                     // اختراقٌ بالإغلاق وحده (منتصف 99.95)
  });
  it("اليومي بلا متوسطات", () => {
    expect(E.smaFrame("1d", mk(Array(250).fill(100), {}))).toMatchObject({ na: true, up: false, dn: false });
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

describe("WLD — على شموعها الحقيقية (2026-09-26 → 2026-10-03)", () => {
  const rec = JSON.parse(fs.readFileSync(path.join(HERE, "../fixtures/v3/WLD-USD-2026-10-03.json"), "utf8"));
  const S = { "WLD-USD": prepCrypto(rec) };
  it("الصفقة المفعّلة تبقى بخطتها حتى تنتهي بقواعدها ولا تتكرّر خلال دورة حياتها", () => {
    const r15 = S["WLD-USD"].r15;
    let state = null, cur = null;
    const births = [];
    for (let H = r15[210].end; H <= r15[r15.length - 1].end; H += 900000) {
      const r = build({ now: H + 60000, book: "crypto", out: "/nonexistent", S, state });
      expect(r.ok).toBe(true);
      state = JSON.parse(JSON.stringify(r.state));
      const all = [...r.doc.open, ...r.doc.active].filter((t) => t.s === "WLD-USD");
      expect(all.length).toBeLessThanOrEqual(1);                                     // لا تكرار
      const t = all[0];
      if (cur && t && t.id === cur.id) expect([t.e, t.st, JSON.stringify(t.tg)]).toEqual(cur.plan);
      if (t && r.doc.open.includes(t)) { cur = { id: t.id, plan: [t.e, t.st, JSON.stringify(t.tg)] }; births.push([new Date(H).toISOString().slice(0, 16), t.d]); }
      if (cur && !t) cur = null;
    }
    // تثبيتٌ لنتيجة المحرّك على هذه الشموع (قرار 2026-10-08)
    expect(births).toEqual([["2026-09-29T15:00", 1], ["2026-10-01T13:30", -1]]);
  });
});
