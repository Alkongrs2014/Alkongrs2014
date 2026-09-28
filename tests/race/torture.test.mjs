/* =====================================================================
   اختبار التعذيب — `TORTURE=1` (يشغّله `npm run torture`).

   مرشَّحاتٌ فاسدة بالجملة (مقطوعة، بايتاتٌ مقلوبة، NaN، حقولٌ ناقصة،
   فريمٌ ممنوع، دفترٌ ملوّث، مفتاحٌ قديم، استجابةٌ مكرّرة) تُمرَّر على بوّابة
   النشر الحقيقية فوق مستودعٍ عارٍ: **لا واحدٌ منها يصل المنشور**، ولا
   واحدٌ يُسقط البوّابة باستثناء — والمنشور بعد كلّ ذلك هو آخر سليم.
   ثم سباقاتٌ متزامنة بالعشرات: نشرُ أقدم وأحدث معاً، لا ينتصر الأقدم أبداً.
   ===================================================================== */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import fc from "fast-check";
import { publishData } from "../../scripts/lib/publish.mjs";

const ON = process.env.TORTURE === "1";
const N = Number(process.env.TORTURE_N || 60);
const FIX = path.resolve("tests/fixtures/data");
const git = (a, cwd) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let tmp, remote, clean;

const mkData = () => { const d = fs.mkdtempSync(path.join(tmp, "d-")); fs.cpSync(clean, d, { recursive: true }); return d; };
const pub = (dataDir, o = {}) => publishData({ root: path.resolve("."), dataDir, remote, log: () => {}, lockCapMs: 120000, ...o });
const head = () => git(["rev-parse", "refs/heads/data"], remote);
const remoteSum = () => JSON.parse(git(["show", "refs/heads/data:summary.json"], remote));

/* المفسِدات — كلٌّ يعيد وصفاً لما أفسد */
const CORRUPT = [
  (d) => { const f = path.join(d, "summary.json"); const t = fs.readFileSync(f, "utf8"); fs.writeFileSync(f, t.slice(0, t.length >> 1)); return "ملخّص مقطوع"; },
  (d) => { const f = path.join(d, "opportunities.json"); const b = fs.readFileSync(f); b[b.length >> 1] ^= 0x5a; fs.writeFileSync(f, b); return "بايتٌ مقلوب في اللقطة"; },
  (d) => { const f = path.join(d, "summary.json"); const s = JSON.parse(fs.readFileSync(f)); s.rows[3].score = null; s.updated += 9; fs.writeFileSync(f, JSON.stringify(s)); return "NaN→null"; },
  (d) => { const f = path.join(d, "summary.json"); const s = JSON.parse(fs.readFileSync(f)); delete s.rows[1].tfScore; s.updated += 9; fs.writeFileSync(f, JSON.stringify(s)); return "حقلٌ ناقص"; },
  (d) => { const f = path.join(d, "sym", "NVDA.json"); const s = JSON.parse(fs.readFileSync(f)); s.tf["5m"] = s.tf["15m"]; fs.writeFileSync(f, JSON.stringify(s));
           const g = path.join(d, "summary.json"); const m = JSON.parse(fs.readFileSync(g)); m.updated += 9; fs.writeFileSync(g, JSON.stringify(m)); return "فريم 5د في سهم"; },
  (d) => { const f = path.join(d, "summary.json"); const s = JSON.parse(fs.readFileSync(f)); s.rows[0].mkt = "crypto"; s.updated += 9; fs.writeFileSync(f, JSON.stringify(s)); return "دفترٌ ملوّث"; },
  (d) => { const f = path.join(d, "opportunities.json"); const s = JSON.parse(fs.readFileSync(f)); s.candleKey -= 900; fs.writeFileSync(f, JSON.stringify(s));
           const g = path.join(d, "summary.json"); const m = JSON.parse(fs.readFileSync(g)); m.updated += 9; fs.writeFileSync(g, JSON.stringify(m)); return "مفتاحٌ قديم"; },
  (d) => { const f = path.join(d, "summary.json"); const s = JSON.parse(fs.readFileSync(f)); s.rows = s.rows.slice(0, 10); s.updated += 9; fs.writeFileSync(f, JSON.stringify(s)); return "جلبٌ فاشل (10 صفوف)"; },
  (d) => { const f = path.join(d, "summary.json"); const s = JSON.parse(fs.readFileSync(f)); s.rows = []; s.updated += 9; fs.writeFileSync(f, JSON.stringify(s)); return "استجابةٌ فارغة"; },
  (d) => { const f = path.join(d, "summary.json"); const s = JSON.parse(fs.readFileSync(f)); s.rows.push(s.rows[0]); s.updated += 9; fs.writeFileSync(f, JSON.stringify(s)); return "رمزٌ مكرّر";},
  (d) => { const f = path.join(d, "summary.json"); const s = JSON.parse(fs.readFileSync(f)); for (const r of s.rows.slice(0, 20)) r.tfScore = { "15m": (r.tfScore || {})["15m"] ?? 0 }; s.updated += 9; fs.writeFileSync(f, JSON.stringify(s)); return "فريماتٌ مفقودة (جلبٌ جزئي)"; },
  (d) => { fs.rmSync(path.join(d, "market.json")); const g = path.join(d, "summary.json"); const m = JSON.parse(fs.readFileSync(g)); m.updated += 9; fs.writeFileSync(g, JSON.stringify(m)); return "ملفٌّ مفقود"; }
];

describe.skipIf(!ON)("التعذيب", () => {
  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-torture-"));
    remote = path.join(tmp, "remote.git");
    git(["init", "-q", "--bare", remote], tmp);
    clean = path.join(tmp, "clean");
    fs.cpSync(FIX, clean, { recursive: true });
    expect((await pub(clean)).code).toBe("published");
  }, 120000);
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it(`${N} مرشَّحاً فاسداً عشوائياً — لا واحدٌ يصل المنشور ولا يُسقط البوّابة`, async () => {
    const good = head(), goodUpdated = remoteSum().updated;
    const picks = fc.sample(fc.array(fc.integer({ min: 0, max: CORRUPT.length - 1 }), { minLength: 1, maxLength: 3 }), { numRuns: N, seed: 42 });
    const seen = {};
    for (const combo of picks) {
      const d = mkData();
      /* مفسِدٌ لا ينطبق بعد سابقه (صفوفٌ أُفرغت قبله) يُتخطّى — الإفساد مدخلٌ لا مختبَر */
      const what = combo.map((i) => { try { return CORRUPT[i](d); } catch { return "—"; } }).join(" + ");
      let r;
      try { r = await pub(d); } catch (e) { throw new Error("البوّابة سقطت باستثناء على «" + what + "»: " + e.message); }
      seen[r.code] = (seen[r.code] || 0) + 1;
      expect(r.ok && r.code === "published", "نُشر مرشَّحٌ فاسد: " + what).toBe(false);
      expect(head()).toBe(good);
      fs.rmSync(d, { recursive: true, force: true });
    }
    expect(remoteSum().updated).toBe(goodUpdated);
    console.log("نتائج البوّابة:", seen);
  }, 1200000);

  it("سباقاتٌ متزامنة بالجملة: الأحدث يفوز دائماً ولا يكتب أقدمُ فوق أحدث", async () => {
    let newest = remoteSum().updated;
    for (let round = 0; round < Math.max(3, N / 20); round++) {
      const dirs = [];
      for (let i = 0; i < 4; i++) {
        const d = mkData();
        const f = path.join(d, "summary.json"); const s = JSON.parse(fs.readFileSync(f));
        s.updated = newest + (i + 1) * 1000 * (round + 1); fs.writeFileSync(f, JSON.stringify(s));
        dirs.push([d, s.updated]);
      }
      /* ترتيبُ الإطلاق عشوائيّ ومتزامن — كلُّ مجلّدٍ كاتبٌ مستقلّ */
      const res = await Promise.all(dirs.sort(() => Math.random() - 0.5).map(([d]) => pub(d)));
      const after = remoteSum().updated;
      expect(after).toBeGreaterThanOrEqual(newest);
      /* الفائز يجب ألّا يُداس بأقدم منه: المنشور ≥ كلِّ ما نُشر بنجاح */
      const won = res.filter((r) => r.code === "published").length;
      expect(won).toBeGreaterThan(0);
      newest = after;
      for (const [d] of dirs) fs.rmSync(d, { recursive: true, force: true });
    }
  }, 1200000);
});
