/* المحرّك V3 مقابل مرجعه المستقلّ — القرار والدرجة والوقف والأهداف والإدارة —
   ومنعُ النظر إلى المستقبل، والحتمية. على سوقٍ اصطناعي بلا بيانات خارجية. */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { prep, inputAt, isoWeek } from "../../scripts/lib/engine3-run.mjs";
import { evaluateRef, manageRef, evaluateHourRef } from "../reference/engine3-ref.mjs";
import { synth } from "./synth3.mjs";

const require = createRequire(import.meta.url);
const E = require("../../stocks/engine3.js");
const wkOf = (d) => isoWeek(d);
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

const A = synth(7, 240);
const S = prep(A.b15, A.b1d);
const from = S.r15.findIndex((b) => b.t >= Date.parse("2025-06-01"));

describe("engine3 مقابل المرجع المستقلّ", () => {
  it("نفس القرار والدرجة والوقف والأهداف والإدارة عند كل شمعة", () => {
    const bad = [];
    let n = 0, sig = 0, managed = 0, byBase = { day: 0, ma: 0 };
    for (let i = from; i < S.r15.length - 1; i++) {
      const inp = inputAt(S, i);
      const a = E.evaluate(inp, wkOf, inp.maPrev), b = evaluateRef(inp, wkOf, inp.maPrev);
      n++;
      if ((a.reject || null) !== b.reject) { bad.push([i, "reject", a.reject, b.reject]); continue; }
      if (a.reject) continue;
      sig++; byBase[a.sig.base]++;
      const s = a.sig;
      if (s.d !== b.d || s.base !== b.base || JSON.stringify(s.el) !== JSON.stringify(b.el) || s.score !== b.score ||
          !near(s.st, b.st) || s.tg.length !== b.tg.length || s.tg.some((x, k) => !near(x.p, b.tg[k]))) { bad.push([i, "signal"]); continue; }
      const rest = S.r15.slice(i + 1);
      const tr = { d: s.d, e: s.e, st: s.st, tg: s.tg, atrD: s.atrD, risk: s.risk, status: "confirmed" };
      let t2 = null;
      for (const bar of rest) { t2 = t2 ? E.stepTrade(t2, bar) : E.fillTrade(tr, bar); if (t2.status === "closed" || t2.status === "cancelled") break; }
      const m = manageRef({ d: s.d, st: s.st, tg: s.tg.map((x) => x.p) }, rest);
      if (t2 && t2.end && m) {
        managed++;
        if (t2.end.k !== m.k || (m.px !== undefined && !near(t2.end.px, m.px))) bad.push([i, "manage", t2.end.k, m.k]);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(n).toBeGreaterThan(2000);
    expect(sig).toBeGreaterThan(10);                 // يمرّ بإشاراتٍ فعلاً لا بالرفض وحده
    expect(byBase.day).toBeGreaterThan(0);
    expect(managed).toBeGreaterThan(10);
  });
});

describe("لقطة الساعة (قرار 2026-10-01) مقابل المرجع المستقلّ", () => {
  it("نفس الجهة والأساس والدرجة والدخول والوقف والأهداف عند كل حدّ ساعة", () => {
    const bad = [];
    let n = 0, sig = 0, bases = { day: 0, ma: 0 };
    for (let i = from; i < S.r15.length; i++) {
      if ((S.r15[i].t - Date.parse("2025-01-02T14:30:00Z")) % 3600000 !== 0) continue;   // حدود :30
      const inp = inputAt(S, i);
      const a = E.evaluateHour(inp, wkOf), b = evaluateHourRef(inp, wkOf);
      n++;
      if ((a.reject || null) !== b.reject) { bad.push([i, "reject", a.reject, b.reject]); continue; }
      if (a.reject) continue;
      sig++; bases[a.sig.base]++;
      const s = a.sig;
      if (s.d !== b.d || s.base !== b.base || JSON.stringify(s.el) !== JSON.stringify(b.el) || s.score !== b.score ||
          !near(s.e, b.e) || !near(s.st, b.st) || s.tg.length !== b.tg.length || s.tg.some((x, k) => !near(x.p, b.tg[k]))) bad.push([i, "sig"]);
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(n).toBeGreaterThan(300);
    expect(sig).toBeGreaterThan(20);
    expect(bases.day).toBeGreaterThan(0);
    expect(bases.ma).toBeGreaterThan(0);
  });
});

describe("engine3 — لا نظر إلى المستقبل · الحتمية · الدرجة", () => {
  it("تشويه كل ما بعد شمعة القرار لا يغيّر القرار", () => {
    const sigs = [];
    for (let i = from; i < S.r15.length - 1 && sigs.length < 6; i++) if (!E.evaluate(inputAt(S, i), wkOf, inputAt(S, i).maPrev).reject) sigs.push(i);
    expect(sigs.length).toBeGreaterThan(3);
    for (const i of [...sigs, from + 500, from + 1500]) {
      const T = S.r15[i].end;
      const base = E.evaluate(inputAt(S, i), wkOf, inputAt(S, i).maPrev);
      const mut = A.b15.map((b) => b.t >= T ? { ...b, o: b.o * 3, h: b.h * 5, l: b.l * 0.2, c: b.c * 4, v: b.v * 9 } : b);
      const d1m = A.b1d.map((b) => b.t >= T - 12 * 3600e3 ? { ...b, h: b.h * 5, l: b.l * 0.2 } : b);
      const S2 = prep(mut, d1m), i2 = S2.r15.findIndex((b) => b.end === T);
      const again = E.evaluate(inputAt(S2, i2), wkOf, inputAt(S2, i2).maPrev);
      expect(JSON.stringify(again)).toBe(JSON.stringify(base));
    }
  });
  it("الحتمية: نفس المدخل ×10 ⇒ نفس الناتج", () => {
    const inp = inputAt(S, from + 700);
    const s0 = JSON.stringify(E.evaluate(inp, wkOf, inp.maPrev));
    for (let k = 0; k < 10; k++) expect(JSON.stringify(E.evaluate(inp, wkOf, inp.maPrev))).toBe(s0);
  });
  it("الدرجة لا تتجاوز 100 وهي مجموع الأوزان المتوافقة بالضبط", () => {
    const W = E.E3.W;
    for (let m = 0; m < 32; m++) {
      const el = { day: !!(m & 1), ma: !!(m & 2), trend: !!(m & 4), vwap: !!(m & 8), week: !!(m & 16) };
      const st = { day: el.day ? { d: 1, holds: true } : null, ma: { dir: el.ma ? 1 : 0 }, trend: { dir: el.trend ? 1 : 0 },
                   vwap: 10, px: el.vwap ? 11 : 9, week: el.week ? { d: 1, holds: true } : null };
      const s = E.scoreFor(st, 1);
      const want = Math.round(Object.keys(W).reduce((a, k) => a + (el[k] ? W[k] : 0), 0) * 100) / 100;
      expect(s.score).toBe(want);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });
});
