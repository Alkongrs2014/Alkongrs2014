/* العزل والحالات اليدوية للمحرّك V3.
   ١) لا يدخل المحرّكان السابقان (legacy_strategy_engine/) في V3 ولا في أيّ ملفّ تشغيل.
   ٢) حالاتٌ محسوبة يدوياً من المواصفة (عبور الجسم، الأوزان، الأهداف، الإدارة). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const E = require("../../stocks/engine3.js");
const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const imports = (src) => [...src.matchAll(/(?:import\s[^"']*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\))/g)]
  .map((m) => m[1] || m[2] || m[3]);

describe("عزل المحرّك V3", () => {
  it("engine3.js مكتفٍ بذاته — لا استيراد إطلاقاً", () => {
    expect(imports(rd("stocks/engine3.js"))).toEqual([]);
  });
  it("مسار V3 لا يستورد شيئاً من المحرّكين السابقين", () => {
    const OLD = /(scans|strategies|consensus|confluence|direction|opportunities|plan|score|evaluate)\.js$|build-opportunities|track-strategies|track-signals|engine2|legacy_strategy_engine/;
    for (const f of ["scripts/lib/engine3-run.mjs", "scripts/build-trades.mjs", "scripts/validate-engine3.mjs"]) {
      if (!fs.existsSync(path.join(ROOT, f))) continue;
      const bad = imports(rd(f)).filter((x) => OLD.test(x));
      expect(bad, f).toEqual([]);
    }
  });
  it("لا ملفّ تشغيلٍ يستورد من legacy_strategy_engine/", () => {
    const bad = [];
    for (const dir of ["scripts", "stocks", "local", "schemas"]) {
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(m?js|html)$/.test(e.name) && /legacy_strategy_engine/.test(imports(fs.readFileSync(p, "utf8")).join("\n"))) bad.push(p);
      } };
      walk(path.join(ROOT, dir));
    }
    expect(bad).toEqual([]);
  });
  it("المسار الحيّ لا يشغّل مهامّ المحرّك القديم", () => {
    const run = rd("local/run.mjs");
    const jobs = run.slice(run.indexOf("const jobs = cmd"), run.indexOf("if (!jobs.length)"));
    for (const old of ["track-signals", "track-strategies", "build-opportunities", "backtest-strategies", "scan-ma200-open", "learn.mjs"])
      expect(jobs.includes(old), old).toBe(false);
    expect(jobs).toContain("build-trades.mjs");
  });
});

describe("حالاتٌ يدوية من المواصفة", () => {
  const ev = (o, c) => E.crossEvents({ o, c }, 100, 90, "pd");
  it("العبور بالجسم: الافتتاح والإغلاق على جانبي المستوى — لا الذيل", () => {
    expect(ev(99.5, 100.5)).toEqual(["pdh_break"]);     // O ≤ H و C > H
    expect(ev(100, 100.01)).toEqual(["pdh_break"]);     // الافتتاح عند القمة نفسها يُحتسب
    expect(ev(100.2, 101)).toEqual([]);                 // فوقها أصلاً — ليس كسراً
    expect(ev(89.9, 90.1)).toEqual(["pdl_reclaim"]);    // O < L و C > L
    expect(ev(90, 90.5)).toEqual([]);                   // من القاع نفسه — ليس استعادة
    expect(ev(90, 89.9)).toEqual(["pdl_break"]);        // O ≥ L و C < L
    expect(ev(100.1, 99.9)).toEqual(["pdh_loss"]);      // O > H و C < H
    expect(E.crossEvents({ o: 99, c: 99.5, h: 105, l: 85 }, 100, 90, "pd")).toEqual([]);   // ذيلان فقط
  });
  it("الأوزان: 40+40+6.67+6.67 = 93.34 · والخمس = 100 · والأساسيتان = 80", () => {
    const st = (el) => ({ day: el[0] ? { d: 1, holds: true } : null, ma: { dir: el[1] ? 1 : 0 },
      trend: { dir: el[2] ? 1 : 0 }, vwap: 10, px: el[3] ? 11 : 9, week: el[4] ? { d: 1, holds: true } : null });
    expect(E.scoreFor(st([1, 1, 1, 1, 0]), 1).score).toBe(93.34);
    expect(E.scoreFor(st([1, 1, 1, 1, 1]), 1).score).toBe(100);
    expect(E.scoreFor(st([1, 1, 0, 0, 0]), 1).score).toBe(80);
    expect(E.scoreFor(st([1, 0, 0, 0, 0]), 1).score).toBe(40);
    expect(E.scoreFor(st([1, 1, 1, 1, 1]), -1).score).toBe(0);    // كلّها شراء ⇒ صفرٌ للبيع
  });
  it("الأهداف: مستوياتٌ ≥ 1R أولاً ثم إكمالٌ بمضاعف المخاطرة موسوماً", () => {
    // دخول 100، مخاطرة 2 ⇒ 101 (0.5R) يُسقط، 104 (2R) يُقبل، ثم 3R = 106 إكمالاً
    const st = { pd: { h: 101, l: 95 }, pw: { h: 104, l: 90 }, atrD: 5 };
    expect(E.targetsOf(100, 1, 2, st, [])).toEqual([{ p: 104, src: "PWH" }, { p: 106, src: "R3" }]);
    // لا مستوى أمام الدخول ⇒ 1R و2R
    expect(E.targetsOf(100, 1, 2, { pd: { h: 99, l: 95 }, pw: null, atrD: 5 }, [])).toEqual([{ p: 102, src: "R1" }, { p: 104, src: "R2" }]);
  });
  it("الإدارة: فجوةٌ خلف الوقف قبل الدخول = إلغاء · والوقف يغلب الهدف في الشمعة نفسها", () => {
    const mk = () => ({ d: 1, e: 100, st: 99, tg: [{ p: 101 }, { p: 102 }], atrD: 1, risk: 1, status: "confirmed" });
    expect(E.fillTrade(mk(), { o: 98.9, h: 99, l: 98, c: 98.5, d: 1 }).status).toBe("cancelled");
    const t = E.fillTrade(mk(), { o: 100, h: 101.5, l: 98.9, c: 100, d: 1 });
    expect(t.end.k).toBe("stop");
    const u = E.fillTrade(mk(), { o: 100, h: 100.5, l: 99.5, c: 100.2, d: 1 });
    E.stepTrade(u, { o: 100.2, h: 101.2, l: 100.1, c: 101, d: 1 });          // T1 ⇒ الوقف إلى التنفيذ
    E.stepTrade(u, { o: 101, h: 101.1, l: 99.9, c: 100, d: 1 });
    expect(u.end).toMatchObject({ k: "be", px: 100 });
  });
});
