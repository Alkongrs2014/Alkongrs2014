/* المحرّك V2 مقابل المرجع المستقلّ، ومنع النظر إلى المستقبل، والحتمية —
   على سوقٍ اصطناعي بتقويم نيويورك الحقيقي (بلا بيانات خارجية). */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { prep, inputAt, idxAt } from "../../scripts/lib/engine2-input.mjs";
import { evaluateRef, manageRef } from "../reference/engine2-ref.mjs";

const require = createRequire(import.meta.url);
const E = require("../../stocks/engine2.js");
const SES = require("../../stocks/session.js");

function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* سوقٌ اصطناعي: السهم والسوق يتشاركان أنظمة الميل (بذرة الميل واحدة) كي
   تتحقّق البوّابة أحياناً، وضجيجُ كلٍّ منفصل. */
export function synth(seed, driftSeed, days = 420) {
  const r = rngOf(seed), rd = rngOf(driftSeed), b15 = [], b1d = [];
  let px = 100, drift = 0;
  for (let t = Date.parse("2024-10-01T12:00:00Z"); b1d.length < days; t += 86400000) {
    const w = SES.sessionWindows(t);
    if (!w.regular) continue;
    if (rd() < 0.05) drift = (rd() - 0.5) * 0.006;
    let o = null, h = -Infinity, l = Infinity, c = null;
    for (let s = w.regular.start; s < w.regular.end; s += 900000) {
      const bo = px, bc = px * (1 + (r() - 0.5) * 0.008 + drift);
      const bh = Math.max(bo, bc) * (1 + r() * 0.002), bl = Math.min(bo, bc) * (1 - r() * 0.002);
      b15.push({ t: s, o: bo, h: bh, l: bl, c: bc, v: 1000 + Math.floor(r() * 5000) });
      o ??= bo; h = Math.max(h, bh); l = Math.min(l, bl); c = bc; px = bc;
    }
    b1d.push({ t: w.regular.start, o, h, l, c, v: 1 });
  }
  return { b15, b1d };
}

const A = synth(7, 3), M = synth(11, 3);
const SA = prep(A.b15, A.b1d), SM = prep(M.b15, M.b1d);
const steps = SA.r15.filter(b => b.t > Date.parse("2025-03-01")).map(b => b.end);

describe("engine2 مقابل المرجع المستقلّ", () => {
  it("نفس القرار عند كل خطوة", () => {
    let n = 0, sig = 0, managed = 0;
    const bad = [];
    const near = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));
    for (const T of steps) {
      const inp = inputAt(SA, SM, T);
      const a = E.evaluateAt(inp), b = evaluateRef(inp);
      n++;
      if ((a.reject || null) !== b.reject || (a.gate && a.gate.d !== b.d)) { bad.push([T, "reject", a.reject, b.reject]); continue; }
      if (a.reject) continue;
      sig++;
      const s = a.signal;
      if (s.count !== b.count || JSON.stringify(s.el) !== JSON.stringify(b.el) ||
          JSON.stringify(s.trig) !== JSON.stringify(b.trig) || !near(s.st, b.stop) ||
          s.tg.length !== b.tg.length || s.tg.some((x, i) => !near(x, b.tg[i]))) { bad.push([T, "signal"]); continue; }
      const ix = idxAt(SA, T), rest = SA.r15.slice(ix.i15 + 1);
      let tr = null;
      for (const bar of rest) { tr = tr ? E.stepTrade(tr, bar) : E.openTrade(s, bar); if (tr.end) break; }
      const m = manageRef({ ...s }, rest);
      if (tr && tr.end && m) {
        managed++;
        if (tr.end.k !== m.k || !near(E.tradeR(tr), m.R)) bad.push([T, "manage", tr.end.k, m.k]);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(n).toBeGreaterThan(5000);
    expect(sig).toBeGreaterThan(10);            // يمرّ بإشاراتٍ فعلاً لا بالرفض وحده
    expect(managed).toBeGreaterThan(10);
  });
});

describe("engine2 — لا نظر إلى المستقبل", () => {
  it("تشويه كل ما بعد T لا يغيّر القرار عند T", () => {
    // لحظاتُ الإشارات نفسها (أهمّ ما يُحرس) مع عيّنةٍ متباعدة من البقية
    const sig = steps.filter(T => !E.evaluateAt(inputAt(SA, SM, T)).reject).slice(0, 6);
    const sample = [...sig, ...steps.filter((_, i) => i % 1500 === 0)];
    expect(sig.length).toBeGreaterThan(3);
    for (const T of sample) {
      const base = E.evaluateAt(inputAt(SA, SM, T));
      const mut = (arr) => arr.map(b => b.t >= T ? { ...b, o: b.o * 3, h: b.h * 5, l: b.l * 0.2, c: b.c * 4, v: b.v * 9 } : b);
      const d1m = A.b1d.map(b => b.t >= T - 12 * 3600e3 ? { ...b, h: b.h * 5, l: b.l * 0.2 } : b);
      const S2 = prep(mut(A.b15), d1m), M2 = prep(mut(M.b15), M.b1d);
      const again = E.evaluateAt(inputAt(S2, M2, T));
      expect(JSON.stringify(again)).toBe(JSON.stringify(base));
    }
  });
  it("الحتمية: نفس المدخل ×10 ⇒ نفس الناتج", () => {
    const inp = inputAt(SA, SM, steps[steps.length >> 1]);
    const s0 = JSON.stringify(E.evaluateAt(inp));
    for (let i = 0; i < 10; i++) expect(JSON.stringify(E.evaluateAt(inp))).toBe(s0);
  });
});
