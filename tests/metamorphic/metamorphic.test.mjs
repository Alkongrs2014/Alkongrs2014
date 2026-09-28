/* =====================================================================
   اختبارات التحوّل — لا تحتاج رقماً متوقّعاً، بل علاقةً بين تشغيلين.

   · تحجيمُ كلّ الأسعار بـ4 (ضربٌ دقيق في الفاصلة العائمة الثنائية) لا يغيّر
     النتيجة ولا الاستراتيجيات العشر: كلُّ عتبةٍ نسبةٌ من ATR أو من السعر.
   · إضافةُ رمزٍ مستقلّ لا تغيّر صفوف غيره (INV-23).
   · عكسُ ترتيب الرموز لا يغيّر شيئاً (INV-22) — في الطبيب أيضاً.
   · نفس اللقطة عشر مرّات ⇒ نفس البصمة (INV-24).
   · ترتيبُ مفاتيح الفريمات في ملفّ الرمز لا يغيّر النتيجة.
   ===================================================================== */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runOnce } from "../../scripts/track-strategies.mjs";
import { buildSnapshot } from "../../scripts/build-opportunities.mjs";

const require = createRequire(import.meta.url);
const S = require("../../stocks/strategies.js");
const SC = require("../../stocks/score.js");
const IND = require("../../stocks/indicators.js");
const P = require("../../stocks/plan.js");
const SESS = require("../../stocks/session.js");

const FIX = path.resolve("tests/fixtures/data");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const summary = rd("summary.json"), strat = rd("strategies.json");
const cbarMax = Math.max(...summary.rows.map((r) => r.cbar || 0));
const cnow = (cbarMax + 900) * 1000 + 1;
const SYMS = summary.rows.slice(0, 20).map((r) => r.s);

function evalSym(rec, row) {
  const mkt = rec.mkt || row.mkt || null;
  const c = S.buildCtx({ rec, row, now: strat.updated, px: row.p, cnow, sess: SESS.sessionOf(cnow, mkt),
    win: SESS.currentWindow(cnow, mkt), sessOf: (t) => SESS.sessionOf(t, mkt) });
  return S.evalAllConfirmed(c).map((r) => [r.id, r.dir || 0, r.sc ?? null, !!r.off]);
}
function scaleRec(rec, k) {
  const r = structuredClone(rec);
  for (const box of [r.tf, r.tfx]) for (const tf in box || {}) box[tf].c = box[tf].c.map(([t, o, h, l, c, v]) => [t, o * k, h * k, l * k, c * k, v]);
  delete r.an; delete r.anx;
  return r;
}

describe("التحجيم السعري", () => {
  for (const k of [4, 0.25]) it(`×${k}: النتيجة لكل فريم والاستراتيجيات العشر كما هي (${SYMS.length} رمزاً)`, () => {
    for (const s of SYMS) {
      const rec = rd(`sym/${s}.json`), row = summary.rows.find((r) => r.s === s);
      for (const tf of ["15m", "1h", "4h", "1d"]) {
        const c = rec.tf[tf] && rec.tf[tf].c; if (!c) continue;
        const a = IND.analyze(P.unpackK(IND.closedBars(c, tf, cnow).slice(-259)));
        const b = IND.analyze(P.unpackK(IND.closedBars(scaleRec(rec, k).tf[tf].c, tf, cnow).slice(-259)));
        expect(b.score, `${s}.${tf}`).toBeCloseTo(a.score, 9);
      }
      const base = evalSym(rec, row);
      const scaled = evalSym(scaleRec(rec, k), { ...row, p: row.p * k, pc: row.pc * k, w52h: row.w52h * k, w52l: row.w52l * k,
                                                 atr: row.atr * k, e20: row.e20 * k, e50: row.e50 * k, e200: row.e200 * k });
      expect(scaled, s).toEqual(base);
    }
  });
});

describe("ترتيب المفاتيح والتكرار", () => {
  it("ترتيبُ مفاتيح الفريمات في ملفّ الرمز لا يغيّر الاستراتيجيات", () => {
    for (const s of SYMS.slice(0, 8)) {
      const rec = rd(`sym/${s}.json`), row = summary.rows.find((r) => r.s === s);
      const rev = { ...rec, tf: Object.fromEntries(Object.entries(rec.tf).reverse()) };
      expect(evalSym(rev, row), s).toEqual(evalSym(rec, row));
    }
  });
  it("INV-24: نفس اللقطة عشر مرّات ⇒ نفس البصمة", () => {
    const io = { rd: (f) => { try { return rd(f); } catch { return null; } }, sym: (s) => { try { return rd(`sym/${s}.json`); } catch { return null; } } };
    const hashes = new Set(Array.from({ length: 10 }, () => buildSnapshot(strat.updated, io).rowsHash));
    expect(hashes.size).toBe(1);
  });
});

describe("INV-23: رمزٌ مستقلّ مُضاف لا يغيّر غيره", () => {
  it("صفوف الاستراتيجيات لكل رمزٍ قائم لا تتغيّر بإضافة رمزٍ جديد", () => {
    const base = (rel, d = null) => { try { return rd(rel); } catch { return d; } };
    const extra = { ...summary.rows[0], s: "ZZZZ" };
    const withExtra = (rel, d = null) => {
      if (rel === "summary.json") return { ...summary, rows: [...summary.rows, extra] };
      if (rel === "sym/ZZZZ.json") return { ...rd(`sym/${summary.rows[0].s}.json`), s: "ZZZZ" };
      return base(rel, d);
    };
    const strip = (rows) => JSON.stringify(rows.filter((r) => r.s !== "ZZZZ").map(({ pAt, ...x }) => x)
      .sort((a, b) => (a.s + a.st).localeCompare(b.s + b.st)));
    /* مجلّدٌ مؤقّت لا المثبّتات: `runOnce` يكتب سجلّ تشغيله في `out`، والكتابة في
       المثبّتات الملتزمة تُفسد المرجع المجمَّد (وقع فعلاً: logs/ ظهر فيها) */
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "wt-meta-"));
    const a = runOnce({ out, now: strat.updated, io: base }), b = runOnce({ out, now: strat.updated, io: withExtra });
    /* الحذف عند الخروج لا فوراً: مسجّلُ التشغيل يكتب بلا انتظار، وحذفُ المجلّد
       تحته يرمي خطأً غير ملتقَط يُسقط عامل الاختبار (أسقط Stryker فعلاً) */
    process.once("exit", () => { try { fs.rmSync(out, { recursive: true, force: true }); } catch {} });
    expect(strip(b.rows)).toBe(strip(a.rows));
    expect(b.rows.some((r) => r.s === "ZZZZ")).toBe(a.rows.some((r) => r.s === summary.rows[0].s));
  });
});
