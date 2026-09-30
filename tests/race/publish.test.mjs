/* =====================================================================
   السباقات والتزامن في النشر — على مستودعٍ عارٍ محليّ بدل GitHub.

   كلُّ حالةٍ تُثبت ثابتاً: الأقدم لا يكتب فوق الأحدث (INV-12/13)، الفشل
   لا يُنشر (INV-16)، الجزئي لا يستبدل الكامل (INV-10)، لا يُقرأ نصفُ ملفّ
   (INV-17)، والرجوع إلى آخر نسخة سليمة يعمل.
   ===================================================================== */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { publishData, rollbackData, monotonicGuard } from "../../scripts/lib/publish.mjs";
import { tryLock, release } from "../../scripts/lib/lockfile.mjs";

const FIX = path.resolve("tests/fixtures/data");
const git = (a, cwd) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let tmp, remote, data;

const rj = (f) => JSON.parse(fs.readFileSync(path.join(data, f), "utf8"));
const wj = (f, o) => fs.writeFileSync(path.join(data, f), JSON.stringify(o));
const head = (b = "data") => { try { return git(["rev-parse", "refs/heads/" + b], remote); } catch { return null; } };
const remoteFile = (f, b = "data") => JSON.parse(git(["show", `refs/heads/${b}:${f}`], remote));
const bump = (ms = 60000) => { const s = rj("summary.json"); s.updated += ms; wj("summary.json", s); };
const pub = (o = {}) => publishData(Object.assign({ root: path.resolve("."), dataDir: data, remote, log: () => {} }, o));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-race-"));
  remote = path.join(tmp, "remote.git");
  git(["init", "-q", "--bare", remote], tmp);
  data = path.join(tmp, "data");
  fs.cpSync(FIX, data, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("النشر المعاملاتيّ", () => {
  it("أوّل نشر ثم نشرٌ أحدث — والسابق يصير آخر نسخة سليمة", async () => {
    const a = await pub();
    expect(a.code).toBe("published");
    bump();
    const b = await pub();
    expect(b.code).toBe("published");
    expect(head("data")).toBe(b.sha);
    expect(head("data-lkg")).toBe(a.sha);
  });

  it("لا جديد ⇒ لا التزام", async () => {
    await pub();
    const h = head();
    const r = await pub();
    expect(r.code).toBe("unchanged");
    expect(head()).toBe(h);
  });

  it("INV-12: حالةٌ أقدم (candleKey ينزل) تُرفض والمنشور لا يُلمس", async () => {
    await pub();
    const h = head();
    const o = rj("trades.json"); o.candleKey -= 900; wj("trades.json", o); bump();
    const r = await pub();
    expect(r.code).toBe("regression");
    expect(head()).toBe(h);
  });

  it("INV-12: updated ينزل يُرفض", async () => {
    await pub();
    bump(-3600000);
    expect((await pub()).code).toBe("regression");
  });

  it("INV-25: بصمةٌ مختلفة في نفس الشمعة بلا تغيّر نسخة تُرفض", async () => {
    await pub();
    const o = rj("trades.json"); o.rowsHash = "0".repeat(12); wj("trades.json", o); bump();
    expect((await pub()).code).toBe("regression");
  });

  it("INV-16: مخالفة مخطّط (NaN صار null) لا تُنشر", async () => {
    await pub();
    const h = head();
    const s = rj("summary.json"); s.rows[0].score = null; s.updated += 1000; wj("summary.json", s);
    const r = await pub();
    expect(r.code).toBe("invalid");
    expect(head()).toBe(h);
  });

  it("INV-40: صفُّ كريبتو في دفتر الأسهم لا يُنشر", async () => {
    const s = rj("summary.json"); s.rows[0].mkt = "crypto"; wj("summary.json", s);
    expect((await pub()).code).toBe("invalid");
    expect(head()).toBe(null);
  });

  /* كشفه التعذيب (200 مرشَّح): رمزٌ مكرّر في الملخّص كان يمرّ من كلّ البوّابات
     فيُعرض مرّتين ويُحسب في الاتساع والقطاعات مرّتين. */
  it("REG-DUP-SYMBOL: رمزٌ مكرّر في ملخّص الأسهم لا يُنشر", async () => {
    await pub();
    const h = head();
    const s = rj("summary.json"); s.rows.push({ ...s.rows[0] }); s.updated += 1000; wj("summary.json", s);
    expect((await pub()).code).toBe("invalid");
    expect(head()).toBe(h);
  });
  it("REG-DUP-SYMBOL: ولا في دفتر الكريبتو — يُحمَل المنشور بدلاً منه", async () => {
    await pub();
    const before = remoteFile("crypto/summary.json");
    const f = path.join(data, "crypto/summary.json");
    const c = JSON.parse(fs.readFileSync(f, "utf8")); c.rows.push({ ...c.rows[0] }); c.updated += 1000;
    fs.writeFileSync(f, JSON.stringify(c)); bump();
    expect((await pub()).code).toBe("published");
    expect(remoteFile("crypto/summary.json").rows.length).toBe(before.rows.length);
  });

  it("INV-11: جلبٌ منقوص العمق لا يحلّ محلّ الكامل", async () => {
    await pub();
    const s = rj("summary.json");
    for (const r of s.rows.slice(0, 30)) delete r.tfScore["1d"];
    s.updated += 1000; wj("summary.json", s);
    expect((await pub()).code).toBe("invalid");
  });
});

describe("السباقات", () => {
  it("INV-13: A قرأ الإيجار، نشر B، ثم دفع A ⇒ A يُلغى بلا إعادة والمنشور هو B", async () => {
    await pub();
    let bSha = null;
    bump();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "wt-b-"));
    fs.cpSync(data, other, { recursive: true });
    const s = JSON.parse(fs.readFileSync(path.join(other, "summary.json"), "utf8")); s.updated += 60000;
    fs.writeFileSync(path.join(other, "summary.json"), JSON.stringify(s));
    const a = await pub({ hooks: { beforePush: async () => {
      const b = await publishData({ root: path.resolve("."), dataDir: other, remote, log: () => {} });
      bSha = b.sha;
    } } });
    fs.rmSync(other, { recursive: true, force: true });
    expect(a.code).toBe("lease");
    expect(head()).toBe(bSha);
  });

  it("نشران متزامنان على نفس المجلّد يتسلسلان بالقفل ولا يتلف أحدهما الآخر", async () => {
    await pub();
    bump();
    const [x, y] = await Promise.all([pub(), pub()]);
    const codes = [x.code, y.code].sort();
    expect(codes).toEqual(["published", "unchanged"]);
    expect(remoteFile("summary.json").updated).toBe(rj("summary.json").updated);
  });

  it("قفل النشر مشغول بلا انتظار ⇒ «locked» لا تداخل", async () => {
    const lk = path.join(data, ".publish.lock");
    expect(tryLock(lk, "other")).toBe(true);
    try { expect((await pub({ lockCapMs: 0 })).code).toBe("locked"); }
    finally { release(lk); }
  });

  it("INV-17: لا يُقرأ نصفُ ملفّ — اللقطة تنتظر قفل الكاتب", async () => {
    await pub();
    const lk = path.join(data, ".run.lock");
    expect(tryLock(lk, "market")).toBe(true);
    const full = JSON.stringify(Object.assign(rj("summary.json"), { updated: rj("summary.json").updated + 120000 }));
    fs.writeFileSync(path.join(data, "summary.json"), full.slice(0, full.length >> 1));   // نصف كتابة
    const p = pub();
    await new Promise((r) => setTimeout(r, 1500));
    fs.writeFileSync(path.join(data, "summary.json"), full);                              // اكتملت
    release(lk);
    const r = await p;
    expect(r.code).toBe("published");
    expect(remoteFile("summary.json").updated).toBe(JSON.parse(full).updated);
  });
});

describe("الجزئي لا يستبدل الكامل — دفتر الكريبتو", () => {
  it("INV-10: دفترُ كريبتو ساقط يُحمَل من المنشور ولا يُحذف", async () => {
    await pub();
    const before = remoteFile("crypto/summary.json");
    const s = JSON.parse(fs.readFileSync(path.join(data, "crypto/summary.json"), "utf8"));
    s.rows[0].mkt = null;                                     // يسقط في بوّابته
    fs.writeFileSync(path.join(data, "crypto/summary.json"), JSON.stringify(s));
    bump();
    const r = await pub();
    expect(r.code).toBe("published");
    expect(remoteFile("crypto/summary.json").updated).toBe(before.updated);
  });

  it("INV-10: غيابُ مجلّد الكريبتو محلياً لا يحذف المنشور", async () => {
    await pub();
    const before = remoteFile("crypto/summary.json");
    fs.rmSync(path.join(data, "crypto"), { recursive: true, force: true });
    bump();
    expect((await pub()).code).toBe("published");
    expect(remoteFile("crypto/summary.json").updated).toBe(before.updated);
  });
});

describe("الرجوع إلى آخر نسخة سليمة", () => {
  it("rollbackData يعيد data إلى data-lkg بإيجار", async () => {
    const a = await pub();
    bump();
    const b = await pub();
    expect(head()).toBe(b.sha);
    const r = await rollbackData({ root: path.resolve("."), remote, reason: "اختبار" });
    expect(r.ok).toBe(true);
    expect(head()).toBe(a.sha);
  });
});

describe("حارس الرتابة — وحدات", () => {
  const st = (k, u, h = "a", v = "x/y") => ({ candleKey: k, updated: u, rowsHash: h, version: v });
  it("يمرّ حين يتقدّم أو يتساوى بنفس البصمة", () => {
    expect(monotonicGuard({ stocks: st(2, 2), crypto: {} }, { stocks: st(1, 1), crypto: {} })).toEqual([]);
    expect(monotonicGuard({ stocks: st(1, 2), crypto: {} }, { stocks: st(1, 1), crypto: {} })).toEqual([]);
  });
  it("يسمح بتغيّر البصمة داخل الشمعة حين تتغيّر النسخة", () => {
    expect(monotonicGuard({ stocks: st(1, 2, "b", "x/z"), crypto: {} }, { stocks: st(1, 1, "a", "x/y"), crypto: {} })).toEqual([]);
  });
  it("يرفض المرشّح الفاقد لدفترٍ منشور", () => {
    expect(monotonicGuard({ stocks: st(1, 1), crypto: {} }, { stocks: st(1, 1), crypto: st(5, 5) }).length).toBe(1);
  });
});
