/* =====================================================================
   طزاجة الفرص — «جديدة الآن» غيرُ «مستمرّة منذ أيام».

   العلّة (قِيست 2026-09-28): «جديدة» كانت بفريم الشرط، واليوميّ يومان،
   فظهرت فرصٌ أعمارها ‎67–283‎ ساعة بجانب إطلاقٍ على آخر إغلاق في ترتيبٍ
   واحد. والجديدة الآن إطلاقٌ أو تجديدٌ أو دخولٌ على إحدى آخر أربع شمعات
   ‎15د‎ مغلقة (`freshOf`)، وتتقدّم المستمرّة في كل مسح (`freshFirst`).

   كلُّ اختبارٍ هنا يمرّ بـ`buildSnapshot` نفسه على المثبّتات (قراءةً في
   الذاكرة — لا كتابة فيها)، والحالة السابقة تُحقن لقطةً سابقة.
   ===================================================================== */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSnapshot, freshOf, freshFirst, FRESH_WIN } from "../../scripts/build-opportunities.mjs";

const require = createRequire(import.meta.url);
const { resolveOpp } = require("../../stocks/direction.js");
const FIX = path.resolve("tests/fixtures/data");
const rdf = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const strat = rdf("strategies.json");

/* المدخلات من المثبّتات، واللقطة السابقة تُحقن. `signals.json` غائبٌ عمداً:
   البذرُ منه يُدخل أعماراً من سجلٍّ لا يتحكّم فيه الاختبار. */
const ioWith = (prev) => ({
  rd: (f) => f === "opportunities.json" ? prev : f === "signals.json" ? null : (() => { try { return rdf(f); } catch { return null; } })(),
  sym: (s) => { try { return rdf(`sym/${s}.json`); } catch { return null; } }
});
const run = (prev) => {
  const d = buildSnapshot(strat.updated, ioWith(prev));
  if (!d.ok) throw new Error(d.why);
  return d;
};
const rowsOf = (d) => Object.entries(d.scans).flatMap(([id, rs]) => rs.map((r) => ({ ...r, scan: id })));
const keyOf = (r) => `${r.s}|${r.scan}|${r.sd}`;
/* لقطةٌ سابقة كلُّ دورات حياتها عمرُها `days` يوماً — مستمرّةٌ لم تنتهِ */
const aged = (d, days) => ({
  candleKey: d.candleKey, scans: d.scans, bySym: d.bySym,
  life: Object.fromEntries(Object.entries(d.life).map(([k, L]) => [k, { ...L, since: d.candleKey - days * 86400, re: undefined }]))
});

const first = run({ life: {} });            // كلُّ ما يُطلق يولد الآن
const K = first.candleKey;

describe("الطزاجة: جديدة ≠ مستمرّة", () => {
  it("إطلاقٌ على آخر شمعة مغلقة ⇒ جديدة في نفس دورة النشر", () => {
    const rs = rowsOf(first).filter((r) => r.sd === 1 || r.sd === -1);
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) expect([r.s, r.fr, r.fw, r.fa]).toEqual([r.s, 1, "trig", K]);
  });

  for (const days of [2, 5, 10]) it(`فرصةٌ عمرها ${days} أيام مستمرّةٌ لا جديدة`, () => {
    const d = run(aged(first, days));
    const rs = rowsOf(d);
    expect(rs.length).toBe(rowsOf(first).length);
    for (const r of rs) {
      expect(r.fr, keyOf(r)).toBe(0);
      expect(r.since, keyOf(r)).toBe(K - days * 86400);
    }
  });

  it("النافذة أربعُ شمعات ‎15د‎ بالضبط — الحدّ لا يتسرّب", () => {
    const L = (since, extra = {}) => ({ since, ...extra });
    expect(FRESH_WIN).toBe(3600);
    expect(freshOf(L(K), K).fr).toBe(1);
    expect(freshOf(L(K - 2700), K).fr).toBe(1);           // الشمعة الرابعة
    expect(freshOf(L(K - 3600), K).fr).toBe(0);           // الخامسة
    expect(freshOf(L(K, { seed: 1 }), K).fr).toBe(0);     // عمرٌ مبذورٌ من سجلٍّ قديم ليس إطلاقاً
  });

  it("دخولٌ على شمعةٍ مغلقة حديثة يعيد تأكيد إعدادٍ قديم — ويُوسَم «دخول» لا «جديدة»", () => {
    const f = freshOf({ since: K - 5 * 86400, inAt: K - 900 }, K);
    expect(f).toEqual({ fr: 1, fa: K - 900, fw: "fill" });
    expect(freshOf({ since: K - 5 * 86400, inAt: K - 5 * 86400 + 900 }, K).fr).toBe(0);
  });
});

describe("التجديد والتكرار", () => {
  it("فرصةٌ قديمة لا تحجب إعداداً جديداً: انتهت بوقفٍ أو هدف ⇒ خطةٌ جديدة بتاريخٍ جديد", () => {
    for (const k of ["stop", "tgt"]) {
      const prev = aged(first, 6);
      const [key] = Object.keys(prev.life);
      prev.life[key] = { ...prev.life[key], end: { k, at: K - 900 }, e: -1, st: -2, t: [-3] };
      const d = run(prev);
      const r = rowsOf(d).find((x) => keyOf(x) === key);
      expect(r, `${key} ${k}`).toBeTruthy();
      expect([r.fr, r.fw, r.since]).toEqual([1, "renew", K]);
      expect(r.e).not.toBe(-1);                            // خطةٌ جديدة لا الموروثة
      expect(d.closedNow).toContainEqual([key, k]);        // والسابقة مسجّلةٌ منتهية
    }
  });

  it("فرصٌ قديمة كثيرة لا تُنقص العضوية: لا سقف ولا إزاحة", () => {
    const setA = new Set(rowsOf(first).map(keyOf));
    const setB = new Set(rowsOf(run(aged(first, 9))).map(keyOf));
    expect([...setB].sort()).toEqual([...setA].sort());
  });

  it("إعدادٌ مستمرّ لا يولّد نسخةً كل ربع ساعة: مفتاحٌ واحد وتاريخٌ واحد", () => {
    const prev = aged(first, 3);
    const d1 = run(prev), d2 = run({ ...d1, life: d1.life });
    for (const d of [d1, d2]) {
      const ks = rowsOf(d).map(keyOf);
      expect(new Set(ks).size).toBe(ks.length);
      for (const r of rowsOf(d)) expect(r.since).toBe(K - 3 * 86400);
    }
    expect(Object.keys(d2.life).sort()).toEqual(Object.keys(prev.life).sort());
  });

  it("دورةٌ غاب شرطها شمعتين تُحذف — فلا تبقى حاجزاً أمام إطلاقٍ لاحق", () => {
    const ghost = "ZZZZ|align|1";
    const prev = aged(first, 4);
    prev.life[ghost] = { d: 1, since: K - 4 * 86400, t: [], hit: 0, in: 0, upto: K, miss: 1, k: K - 900, end: null };
    const d = run(prev);
    expect(d.life[ghost]).toBeUndefined();
    expect(d.closedNow).toContainEqual([ghost, "gone"]);
  });
});

describe("الترتيب والسجلّ", () => {
  it("في كل مسح: الجديدةُ أولاً، وداخل كل فئةٍ ترتيبُ الدرجة كما هو", () => {
    const mixed = aged(first, 3);
    const keys = Object.keys(mixed.life);
    keys.filter((_, i) => i % 2).forEach((k) => { mixed.life[k].since = K; });
    const d = run(mixed);
    for (const [id, rs] of Object.entries(d.scans)) {
      const fr = rs.map((r) => r.fr);
      expect(fr, id).toEqual([...fr].sort((a, b) => b - a));
      for (const f of [0, 1]) {
        const q = rs.filter((r) => r.fr === f).map((r) => r.q);
        expect(q, `${id}/${f}`).toEqual([...q].sort((a, b) => b - a));
      }
    }
    const x = [{ fr: 0, q: 9 }, { fr: 1, q: 1 }, { fr: 0, q: 5 }, { fr: 1, q: 0 }];
    expect(freshFirst(x)).toEqual([x[1], x[3], x[0], x[2]]);
  });

  it("الدرجة والعضوية لا تتغيّران بالطزاجة — الفرق الترتيبُ والوسم وحدهما", () => {
    const qOf = (d) => Object.fromEntries(rowsOf(d).map((r) => [keyOf(r), [r.q, r.q0, r.v]]));
    expect(qOf(run(aged(first, 0.001)))).toEqual(qOf(first));
  });

  it("دورة الحياة محفوظة: خطةُ المستمرّة وتاريخُها وما بلغته لا تُمسّ", () => {
    const prev = aged(first, 7);
    const d = run(prev);
    for (const [k, L] of Object.entries(prev.life)) {
      expect(d.life[k], k).toBeTruthy();
      expect([d.life[k].since, d.life[k].e, d.life[k].st, d.life[k].t]).toEqual([L.since, L.e, L.st, L.t]);
    }
  });
});

describe("تناظر CALL وPUT", () => {
  it("قواعد الطزاجة لا تقرأ الجهة", () => {
    for (const L of [{ since: K }, { since: K - 9e5 }, { since: K - 9e5, inAt: K }])
      expect(freshOf({ ...L, d: 1 }, K)).toEqual(freshOf({ ...L, d: -1 }, K));
  });

  it("الجهتان في اللقطة تحملان الحقول نفسها بالقواعد نفسها", () => {
    const rs = rowsOf(run(aged(first, 3)));
    for (const d of [1, -1]) for (const r of rs.filter((x) => x.sd === d)) expect([r.fr, r.fw]).toEqual([0, null]);
    const byDir = (d) => rowsOf(first).filter((x) => x.sd === d).every((r) => r.fr === 1 && r.fw === "trig");
    expect(byDir(1) && byDir(-1)).toBe(true);
  });

  it("المرآة: عكسُ كل المدخلات يعكس الاتجاه المحسوم (خارج النطاق المحايد)", () => {
    const cases = [
      { score: 60, band: 4, tf: [30, 40, 50, 20] }, { score: 20, band: 3, tf: [20, -10, 30, 25] },
      { score: 50, band: 4, tf: [40, 30, 20, 16] }, { score: 30, band: 3, tf: [-20, 10, 5, -30] }
    ];
    for (const c of cases) {
      const tfS = (k) => ({ "15m": k * c.tf[0], "1h": k * c.tf[1], "4h": k * c.tf[2], "1d": k * c.tf[3] });
      for (const hits of [[{ id: "a", dir: 1, forced: null }], [{ id: "a", dir: 1, forced: 1 }, { id: "b", dir: -1, forced: null }]]) {
        const up = resolveOpp({ score: c.score, band: c.band, tfScore: tfS(1), hits });
        const dn = resolveOpp({ score: -c.score, band: 4 - c.band, tfScore: tfS(-1),
          hits: hits.map((h) => ({ ...h, dir: -h.dir, forced: h.forced == null ? null : -h.forced })) });
        expect((dn.dir || 0), JSON.stringify(c)).toBe(-(up.dir || 0));
        expect(dn.kept.map((h) => h.id).sort()).toEqual(up.kept.map((h) => h.id).sort());
      }
    }
  });

  /* **لاتناظرٌ معلومٌ مثبَّت — لا علّةٌ تُصلَح هنا.** `baseDirOf` تحسم النطاق
     المحايد (‎2‎) صعوداً (حدُّ `planDirOf` ‎−15‎ منذ البداية)، فشرطٌ هابطٌ غيرُ
     مفروض على سهمٍ محايد يُسقَط ونظيرُه الصاعد يُقبل. قِيس على إعادة ‎13‎ جلسة:
     «تباعد هابط ▼» في النطاق ‎2‎ ‎259‎ إطلاقاً (‎15‎ رمزاً-يوماً) ⇒ صفر معروض.
     تغييرُه يغيّر اتجاه الخطط التي قاسها الأرشيف — قرارُ المالك. وهذا الاختبار
     يجعل أيَّ تغييرٍ فيه مرئياً. */
  it("النطاق المحايد يُحسم صعوداً — لاتناظرٌ موثَّق ينتظر قرار المالك", () => {
    const hit = (d) => [{ id: "x", dir: d, forced: null }];
    const tf = { "15m": 5, "1h": -5, "4h": 10, "1d": -10 };
    expect(resolveOpp({ score: 5, band: 2, tfScore: tf, hits: hit(1) }).dir).toBe(1);
    expect(resolveOpp({ score: -5, band: 2, tfScore: tf, hits: hit(-1) }).dir).toBe(null);
  });
});
