/* وحداتُ البنية: القفل، واللقطة، والمخطّطات، والتقاط الإخفاق. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tryLock, acquire, release, lockHolder } from "../../scripts/lib/lockfile.mjs";
import { takeSnapshot, dropSnapshot } from "../../scripts/lib/snapshot.mjs";
import { validateDoc } from "../../scripts/lib/validate-schemas.mjs";
import { BOOK_SCHEMAS, marketDirSchema } from "../../schemas/index.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "wt-unit-"));
const FIX = path.resolve("tests/fixtures/data");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));

describe("القفل", () => {
  it("wx ذرّي: الأخذ الثاني يفشل ما دام الأوّل حيّاً", () => {
    const f = path.join(tmp(), "l");
    expect(tryLock(f, "a")).toBe(true);
    expect(tryLock(f, "b")).toBe(false);
    release(f);
    expect(tryLock(f, "c")).toBe(true);
  });
  it("قفلُ عمليةٍ ميتة يُسقط ولا يحجب إلى الأبد", async () => {
    const f = path.join(tmp(), "l");
    fs.writeFileSync(f, JSON.stringify({ job: "x", pid: 999999, at: Date.now() }));
    expect(lockHolder(f)).toBe(null);
    expect(await acquire(f, "y", 2000, 50)).toBe(true);
  });
  it("لا يُحرَّر قفلُ غيرنا", () => {
    const f = path.join(tmp(), "l");
    fs.writeFileSync(f, JSON.stringify({ job: "x", pid: process.pid + 1, at: Date.now() }));
    release(f);
    expect(fs.existsSync(f)).toBe(true);
  });
  it("السقف: قفلٌ حيّ يُنهي الانتظار بـfalse لا بالكسر", async () => {
    const f = path.join(tmp(), "l");
    tryLock(f, "held");
    expect(await acquire(f, "w", 300, 50)).toBe(false);
  });
});

describe("اللقطة", () => {
  it("تستبعد السجلّات والأرشيف والأقفال والملفّات المؤقّتة", async () => {
    const src = tmp();
    for (const d of ["logs", ".archive", "replay", ".monitor", "audit", "sym"]) fs.mkdirSync(path.join(src, d));
    fs.writeFileSync(path.join(src, "sym", "A.json"), "{}");
    fs.writeFileSync(path.join(src, "logs", "x.log"), "x");
    fs.writeFileSync(path.join(src, "summary.json"), "{}");
    fs.writeFileSync(path.join(src, ".opportunities.tmp.json"), "{}");
    const s = await takeSnapshot({ src });
    try {
      expect(fs.readdirSync(s).sort()).toEqual(["summary.json", "sym"]);
      expect(fs.existsSync(path.join(s, "sym", "A.json"))).toBe(true);
    } finally { dropSnapshot(s); }
  });
});

describe("المخطّطات — ترفض ما يجب رفضه", () => {
  it("فريم 5د في ملفّ سهم (INV-01)", () => {
    const sym = rd("sym/NVDA.json"); sym.tf["5m"] = sym.tf["15m"];
    expect(validateDoc(BOOK_SCHEMAS.stocks["sym/*"], sym).length).toBeGreaterThan(0);
  });
  it("NaN صار null في رقمٍ إلزاميّ (INV-18)", () => {
    const s = rd("summary.json"); s.rows[0].score = JSON.parse(JSON.stringify(NaN));
    expect(validateDoc(BOOK_SCHEMAS.stocks["summary.json"], s).length).toBeGreaterThan(0);
  });
  it("صفُّ كريبتو في ملخّص الأسهم (INV-40)", () => {
    const s = rd("summary.json"); s.rows[0].mkt = "crypto";
    expect(validateDoc(BOOK_SCHEMAS.stocks["summary.json"], s).length).toBeGreaterThan(0);
  });
  it("15د في توجّه السوق (INV-02)", () => {
    const m = rd("market-dir.json"); m.tfs = ["15m", "4h", "1d"];
    expect(validateDoc(marketDirSchema, m).length).toBeGreaterThan(0);
  });
  it("المثبّتات السليمة تمرّ", () => {
    for (const f of ["summary.json", "opportunities.json", "strategies.json", "market.json", "market-dir.json"])
      expect(validateDoc(BOOK_SCHEMAS.stocks[f], rd(f)), f).toEqual([]);
  });
});
