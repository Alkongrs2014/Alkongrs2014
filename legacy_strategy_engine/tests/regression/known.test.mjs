/* =====================================================================
   اختبارات الانحدار — كلُّ علّةٍ موثّقة في CLAUDE.md تصير اختباراً دائماً.

   كلُّ حالةٍ تحمل معرّفها (REG-…) ووصفاً سطرياً لما وقع. والفحوص التي
   تغطّيها `--check` أو `check-*` قائمةً (تُشغَّل في `npm run checks`) لا
   تُكرَّر هنا — يُذكر مكانها في نهاية الملفّ.
   ===================================================================== */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { carryFrames, guardFrames, stale } from "../../scripts/fetch-market.mjs";
import { rp } from "../../scripts/lib/round.mjs";
import { decide } from "../../scripts/build-opportunities.mjs";
import { chartCandles } from "../../scripts/lib/yahoo.mjs";

const require = createRequire(import.meta.url);
const IND = require("../../stocks/indicators.js");
const SC = require("../../stocks/score.js");
const DIR = require("../../stocks/direction.js");
const P = require("../../stocks/plan.js");
const ROOT = path.resolve(".");

const bars = (n) => Array.from({ length: n }, (_, i) => [1_790_000_000 + i * 900, 1, 1, 1, 1, 1]);
const rec = (tfs) => ({ tf: Object.fromEntries(tfs.map((t) => [t, { c: bars(3) }])) });

describe("سلامة البيانات", () => {
  it("REG-FRAMES-DROP: التأكيد السريع (15د وحده) لا يمحو الساعة واليومي", () => {
    const next = carryFrames(rec(["15m", "1h", "4h", "1d"]), rec(["15m"]), "core");
    expect(Object.keys(next.tf).sort()).toEqual(["15m", "1d", "1h", "4h"]);
  });
  it("REG-FRAMES-DROP: الحارس يرفض الكتابة حين يُفقد فريم", () => {
    expect(() => guardFrames(rec(["15m", "1h", "1d"]), rec(["15m"]), "core")).toThrow(/فقدُ فريمات/);
  });
  it("REG-YAHOO-OPEN-OUTSIDE: شمعة ياهو اليومية أوّل الجلسة بافتتاحٍ خارج مداها تُتخطّى ولا تُحفظ", () => {
    // 2026-09-28 13:33Z: TSM اليوم o=452.395 (افتتاحُ الجمعة) و h=449.6 — فرفض الطبيبُ
    // السريع (INV-04/05) كلَّ نشرٍ للدفترين حتى أُعيد جلب اليومي.
    const res = { timestamp: [1790343000, 1790602200], indicators: { quote: [{
      open: [452.4, 452.395], high: [455.03, 449.6], low: [449.01, 447.01],
      close: [450.61, 449.15], volume: [7751900, 506499] }] } };
    const c = chartCandles(res);
    expect(c.map((x) => x.t)).toEqual([1790343000000]);
    for (const x of c) expect(x.h >= Math.max(x.o, x.c) && Math.min(x.o, x.c) >= x.l && x.l > 0).toBe(true);
  });
  it("REG-PARTIAL-1H: شمعة ساعةٍ جُلبت جاريةً ثم أُغلقت تُعاد جلباً لا تُقرأ مغلقةً ناقصة", () => {
    // 2026-09-28: جُلبت الساعة 13:48Z وشمعة 13:30 فيها 18 دقيقة، وبصلاحية 55 دقيقة
    // لم تُجدَّد حتى 14:48 — فقرأ التأكيدُ عند 14:33 (مفتاح 14:15) الناقصةَ مغلقةً:
    // 1h لستّة عشر سهماً خاطئة (KLAC +35.3 والصحيح −23.5).
    const T = (h, m, s = 0) => Date.UTC(2026, 8, 28, h, m, s);
    const prev = { tf: { "1h": { updated: T(13, 48, 1), c: [[T(12, 30) / 1000, 1, 1, 1, 1, 1], [T(13, 30) / 1000, 1, 1, 1, 1, 1], [T(13, 48, 12) / 1000, 1, 1, 1, 1, 0]] } } };
    expect(stale(prev, "1h", T(14, 18))).toBe(false);   // 13:30 ما زالت جارية — لا جلب بلا سبب
    expect(stale(prev, "1h", T(14, 33))).toBe(true);    // أُغلقت 14:30 وما حُفظ منها ناقص
    const fresh = { tf: { "1h": { updated: T(14, 33), c: [[T(13, 30) / 1000, 1, 1, 1, 1, 1], [T(14, 30) / 1000, 1, 1, 1, 1, 1]] } } };
    expect(stale(fresh, "1h", T(14, 48))).toBe(false);  // جُلبت بعد إغلاقها — كاملة
  });
  it("REG-WIDE-DEMOTE: رمزٌ نُزِّل إلى الواسعة تسقط فريماتُه اللحظية لا تبقى متقادمة", () => {
    const next = carryFrames(rec(["15m", "1h", "4h", "1d"]), { tf: {} }, "wide");
    expect(Object.keys(next.tf)).toEqual(["1d"]);
  });
});

describe("الشمعة المغلقة والتجميع", () => {
  it("REG-PARTIAL-MINUTE: طبعة ياهو الجزئية (…:17ث) تُحذف ومعها الجارية", () => {
    const k = [[1790363700, 1, 1, 1, 1, 1], [1790364600, 1, 1, 1, 1, 1], [1790364617, 1, 1, 1, 1, 1]];
    expect(IND.closedBars(k, "15m", 1790365400000).length).toBe(1);
  });
  it("REG-DAILY-FUTURE: شمعة يومٍ بعد ساعة التأكيد جارية لا مغلقة (>=)", () => {
    expect(IND.isLiveBar("1d", 1790294400000 + 86400000, 1790330000000)).toBe(true);
  });
  it("REG-CLOSED-KEPT: المغلقة الأخيرة تبقى — لا عمى عن جلسةٍ انتهت", () => {
    expect(IND.closedBars([[1790208000, 1, 1, 1, 1, 1], [1790294400, 1, 1, 1, 1, 1]], "1d", 1790400000000).length).toBe(2);
  });
  it("REG-4H-INDEX: شمعة 4س لا تزحف بتدحرج نافذة الساعة", () => {
    const h = Array.from({ length: 40 }, (_, i) => ({ t: 1_789_000_000_000 - (1_789_000_000_000 % 14400000) + i * 3600000, o: i, h: i + 1, l: i, c: i + 0.5, v: 1 }));
    const a = IND.aggregate(h, 4), b = IND.aggregate(h.slice(3), 4);
    expect(JSON.stringify(a.slice(-5))).toBe(JSON.stringify(b.slice(-5)));
  });
});

describe("النتيجة والاتجاه", () => {
  it("REG-ISFINITE-NULL: المتوسّط الغائب (null) بوابةٌ غائبة لا صفرٌ صالح", () => {
    expect(SC.scoreFrom({ px: 10, e200: null, atr: 1 })).toBe(0);
    expect(SC.scoreFrom({ px: 10, e200: null, e20: 9, atr: 1 })).toBe(100);
  });
  it("REG-FROZEN-EQUAL: سلسلةٌ مجمّدة (تساوٍ تامّ) نتيجتُها صفر لا −50", () => {
    expect(SC.scoreFrom({ px: 5, e20: 5, e50: 5, e200: 5, bbMid: 5, atr: 0 })).toBe(0);
  });
  it("REG-BAND-EDGE: ‎−45‎ «ميل هابط» لا «هابط قوي» (الحدّ للأعلى في الجهتين)", () => {
    expect(SC.bandOf(-45)).toBe(1); expect(SC.bandOf(45)).toBe(4);
  });
  it("REG-DIR-UNDEFINED: غيابُ الاتجاه في الشرط يعني اتجاه الرمز لا «يُستبعد»", () => {
    const r = DIR.resolveOpp({ score: 30, band: 3, tfScore: {}, hits: [{ id: "vol" }] });
    expect(r.kept.map((h) => h.id)).toEqual(["vol"]);
  });
  it("REG-GS: إجماع الفريمات الهابط يعلو على نطاقٍ متأخّر وفرضٍ صاعد", () => {
    const r = DIR.resolveOpp({ score: -45.88, band: 1, tfScore: { "15m": -30, "1h": -40, "4h": -20, "1d": -60 },
      hits: [{ id: "vol", forced: 1 }, { id: "alignDn", dir: -1 }] });
    expect(r.dir).toBe(-1); expect(r.dropped.map((h) => h.id)).toEqual(["vol"]);
  });
});

describe("الخطة والتقريب", () => {
  it("REG-RP-SHIB: التقريب بالأرقام المعنوية لا يمحو الأصل الرخيص", () => {
    expect(rp(0.00000529)).toBeGreaterThan(0);
    expect(rp(0.00000529) - rp(0.00000511)).toBeGreaterThan(0);
  });
  it("REG-PLAN-SIDE: خطة الهبوط أهدافُها تحت الدخول ووقفُها فوقه", () => {
    const p = P.planFrom({ px: 100, atr: 2, resAll: [{ p: 104 }, { p: 108 }], supAll: [{ p: 96 }, { p: 92 }, { p: 88 }] }, -1);
    if (p) { expect(P.validatePlan(p)).toEqual([]); expect(p.targets.every((t) => t.p < p.entry)).toBe(true); expect(p.stop).toBeGreaterThan(p.entry); }
  });
});

describe("لقطة الفرص", () => {
  const deep = { sources: { depth: { four: 100, rows: 100 } } };
  it("REG-STUCK-SNAPSHOT: إصلاحٌ في خطّ المعالجة يسمح بإعادة بناءٍ واحدة داخل الشمعة", () => {
    const prev = { candleKey: 1, rowsHash: "a", strategyVersion: "s", ...deep };
    expect(decide({ candleKey: 1, rowsHash: "b", strategyVersion: "s", pipelineVersion: "p", ...deep }, prev).write).toBe(true);
    expect(decide({ candleKey: 1, rowsHash: "c", strategyVersion: "s", pipelineVersion: "p", ...deep },
                  { ...prev, rowsHash: "b", pipelineVersion: "p" }).write).toBe(false);
  });
  it("REG-KEY-BACKWARDS: مفتاحٌ إلى الوراء لا يُكتب", () => {
    expect(decide({ candleKey: 0, rowsHash: "b", strategyVersion: "s" }, { candleKey: 1, rowsHash: "a", strategyVersion: "s", ...deep }).write).toBe(false);
  });
});

/* ---------------------------------------------------------------------
   حرّاس بنيويّة — تقرأ الشيفرة نفسها (lint) فتمنع عودة نمطٍ عُولج
   --------------------------------------------------------------------- */
const files = (dir, re) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (["node_modules", ".git", "fixtures", "data"].includes(e.name) ? [] : files(path.join(dir, e.name), re))
  : re.test(e.name) ? [path.join(dir, e.name)] : []);

describe("حرّاس بنيويّة", () => {
  it("REG-NO-FORCE-PUSH (INV-14): لا دفعٌ قسريٌّ غير مشروط في أيّ مسار", () => {
    const hits = [];
    for (const f of [...files(path.join(ROOT, "scripts"), /\.m?js$/), ...files(path.join(ROOT, "local"), /\.(m?js|ps1|bat)$/),
                     ...files(path.join(ROOT, ".github"), /\.ya?ml$/)]) {
      /* التعليقات الكتلية تُمحى أوّلاً (مع إبقاء الأسطر كي يصحّ الرقم): شرحٌ
         يذكر «push -f» ليس دفعاً */
      const s = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).split("\n");
      s.forEach((l, i) => {
        if (/^\s*(\/\/|\*|#)/.test(l)) return;
        if (/push[^\n]*(\s-f\b|"-f"|'-f'|--force(?!-with-lease))|["']\+refs\//.test(l)) hits.push(path.relative(ROOT, f) + ":" + (i + 1));
      });
    }
    expect(hits).toEqual([]);
  });
  it("REG-SINGLE-WRITER (INV-15): مهامّ السحابة لا تكتب فرع data", () => {
    const wf = files(path.join(ROOT, ".github"), /\.ya?ml$/).map((f) => [f, fs.readFileSync(f, "utf8")]);
    const DATA_WRITE = new RegExp(["snapshot:data", "refs/heads/data(?![-\\w])", "push[^\\n]*\\sdata(?![-\\w])"].join("|"));
    const bad = wf.filter(([, s]) => DATA_WRITE.test(s)).map(([f]) => path.relative(ROOT, f));
    expect(bad).toEqual([]);
  });
  it("REG-FETCH-TIMEOUT: كلُّ fetch في شيفرة مجدولة يحمل مهلة (signal)", () => {
    const bad = [];
    for (const f of files(path.join(ROOT, "scripts"), /\.mjs$/)) {
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l) || !/\bfetch\(/.test(l) || /function fetch|\.fetch\(|typeof fetch/.test(l)) return;
        const win = lines.slice(i, i + 12).join(" ");
        if (!/signal|timeout|AbortSignal|withTimeout|req\(|curlGet/.test(win)) bad.push(path.relative(ROOT, f) + ":" + (i + 1));
      });
    }
    expect(bad).toEqual([]);
  });
  it("REG-READ-CONSISTENCY (INV-17): فحوص البيانات تقبل لقطةً (WEBTRADE_DATA) لا data/ الحيّ حصراً", () => {
    const bad = files(path.join(ROOT, "scripts"), /^check-.*\.mjs$/)
      .filter((f) => /path\.join\(ROOT, "data/.test(fs.readFileSync(f, "utf8").replace(/process\.env\.WEBTRADE_DATA \|\| path\.join\(ROOT, "data"\)/g, "")))
      .map((f) => path.basename(f));
    expect(bad).toEqual([]);
  });
});

/* مغطّاةٌ في مكانها (تُشغَّل في `npm run checks`):
   REG-SW-SHELL (check-ui) · REG-DUP-NAMES (check-ui) · REG-CONV-TRUTHY (check-ui) ·
   REG-CANDLECLOCK (fetch-market --check) · REG-CONFBAR-CBAR (build-opportunities --check) ·
   REG-INTRA-CANDLE (check-opportunity-stability · check-opportunity-list · check-snapshot-purity) ·
   REG-BOOKS (check-books) · REG-DIR-HOLD (check-strategies) · REG-SESSION (check-session) ·
   REG-LAZY-RACE (tests/e2e) · REG-PUBLISH-RACES (tests/race) · REG-TFPIN (tfpin.test.mjs). */
