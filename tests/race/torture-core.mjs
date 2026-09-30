/* =====================================================================
   نواة التعذيب — وحدةُ Node عادية (لا vitest) يستدعيها `npm run torture`
   مباشرةً ويغلّفها `torture.test.mjs` بعددٍ صغير.

   لماذا خارج vitest: مئتا نشرٍ على مستودعٍ عارٍ بنداءات git متزامنة تُبقي عامل
   الاختبار مشغولاً فيسقط تشغيلُه بمهلة RPC («Timeout calling onTaskUpdate»)
   والاختبارات كلُّها ناجحة — فشلُ أداةٍ يُقرأ فشلَ نظام. هنا لا وسيط.

   يثبت على مستودعٍ عارٍ:
     · كلُّ مرشَّحٍ فاسد (مقطوع، بايتٌ مقلوب، NaN، حقلٌ ناقص، فريم 5د، دفترٌ ملوّث،
       مفتاحٌ قديم، جلبٌ فاشل/فارغ، رمزٌ مكرّر، جلبٌ جزئي، ملفٌّ مفقود، بصمةٌ
       مختلفة بنفس المفتاح، كريبتو فاسد) لا يُنشر ولا يُسقط البوّابة باستثناء.
     · الكريبتو الفاسد لا يحذف كريبتو المنشور.
     · في السباقات المتزامنة المنشورُ أحدثُ ما نجح دائماً — الأقدم لا يفوز.
   ===================================================================== */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import fc from "fast-check";
import { publishData } from "../../scripts/lib/publish.mjs";

const git = (a, cwd) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const rjf = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const wjf = (f, o) => fs.writeFileSync(f, JSON.stringify(o));
const bumpSum = (d) => { const g = path.join(d, "summary.json"); const m = rjf(g); m.updated += 9; wjf(g, m); };

export const CORRUPT = [
  ["ملخّص مقطوع", (d) => { const f = path.join(d, "summary.json"); const t = fs.readFileSync(f, "utf8"); fs.writeFileSync(f, t.slice(0, t.length >> 1)); }],
  ["بايتٌ مقلوب في اللقطة", (d) => { const f = path.join(d, "trades.json"); const b = fs.readFileSync(f); b[b.length >> 1] ^= 0x5a; fs.writeFileSync(f, b); }],
  ["NaN→null", (d) => { const f = path.join(d, "summary.json"); const s = rjf(f); s.rows[3].score = null; s.updated += 9; wjf(f, s); }],
  ["حقلٌ ناقص", (d) => { const f = path.join(d, "summary.json"); const s = rjf(f); delete s.rows[1].tfScore; s.updated += 9; wjf(f, s); }],
  ["فريم 5د في سهم", (d) => { const f = path.join(d, "sym", "NVDA.json"); const s = rjf(f); s.tf["5m"] = s.tf["15m"]; wjf(f, s); bumpSum(d); }],
  ["دفترٌ ملوّث", (d) => { const f = path.join(d, "summary.json"); const s = rjf(f); s.rows[0].mkt = "crypto"; s.updated += 9; wjf(f, s); }],
  ["مفتاحٌ قديم", (d) => { const f = path.join(d, "trades.json"); const s = rjf(f); s.candleKey -= 900; wjf(f, s); bumpSum(d); }],
  ["جلبٌ فاشل (10 صفوف)", (d) => { const f = path.join(d, "summary.json"); const s = rjf(f); s.rows = s.rows.slice(0, 10); s.updated += 9; wjf(f, s); }],
  ["استجابةٌ فارغة", (d) => { const f = path.join(d, "summary.json"); const s = rjf(f); s.rows = []; s.updated += 9; wjf(f, s); }],
  ["رمزٌ مكرّر", (d) => { const f = path.join(d, "summary.json"); const s = rjf(f); s.rows.push(s.rows[0]); s.updated += 9; wjf(f, s); }],
  ["فريماتٌ مفقودة (جلبٌ جزئي)", (d) => { const f = path.join(d, "summary.json"); const s = rjf(f); for (const r of s.rows.slice(0, 20)) r.tfScore = { "15m": (r.tfScore || {})["15m"] ?? 0 }; s.updated += 9; wjf(f, s); }],
  ["ملفٌّ مفقود", (d) => { fs.rmSync(path.join(d, "market.json")); bumpSum(d); }],
  ["بصمةٌ مختلفة بنفس المفتاح", (d) => { const f = path.join(d, "trades.json"); const s = rjf(f); s.rowsHash = "0".repeat(12); wjf(f, s); bumpSum(d); }]
];

/* فسادٌ في الكريبتو وحده: الأسهم سليمةٌ ومحدّثة فيُنشر المرشَّح، لكن كريبتو المنشور يبقى كما هو */
export const CORRUPT_CRYPTO = [
  ["كريبتو: صفٌّ غير كريبتو", (d) => { const f = path.join(d, "crypto/summary.json"); const s = rjf(f); s.rows[0].mkt = null; wjf(f, s); }],
  ["كريبتو: ملخّص مقطوع", (d) => { const f = path.join(d, "crypto/summary.json"); const t = fs.readFileSync(f, "utf8"); fs.writeFileSync(f, t.slice(0, 100)); }],
  ["كريبتو: رمزٌ مكرّر", (d) => { const f = path.join(d, "crypto/summary.json"); const s = rjf(f); s.rows.push(s.rows[0]); wjf(f, s); }],
  ["كريبتو: مجلّدٌ غائب", (d) => { fs.rmSync(path.join(d, "crypto"), { recursive: true, force: true }); }]
];

export async function runTorture({ fixtures, N = 200, rounds = null, log = () => {} }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-torture-"));
  const remote = path.join(tmp, "remote.git");
  const violations = [], seen = {};
  const V = (m) => { violations.push(m); log("✗ " + m); };
  try {
    git(["init", "-q", "--bare", remote], tmp);
    const clean = path.join(tmp, "clean");
    fs.cpSync(fixtures, clean, { recursive: true });
    const pub = (dataDir) => publishData({ root: process.cwd(), dataDir, remote, log: () => {}, lockCapMs: 120000 });
    const mk = () => { const d = fs.mkdtempSync(path.join(tmp, "d-")); fs.cpSync(clean, d, { recursive: true }); return d; };
    const head = () => git(["rev-parse", "refs/heads/data"], remote);
    const rf = (f) => JSON.parse(git(["show", "refs/heads/data:" + f], remote));
    const r0 = await pub(clean);
    if (r0.code !== "published") throw new Error("النشر الأوّل للمرجع لم ينجح: " + r0.why);

    /* ١) مرشَّحاتٌ فاسدة في الأسهم — لا واحدٌ يُنشر */
    const good = head(), goodUpd = rf("summary.json").updated;
    const picks = fc.sample(fc.array(fc.integer({ min: 0, max: CORRUPT.length - 1 }), { minLength: 1, maxLength: 3 }), { numRuns: N, seed: 42 });
    for (const combo of picks) {
      const d = mk();
      const what = combo.map((i) => { try { CORRUPT[i][1](d); return CORRUPT[i][0]; } catch { return "—"; } }).join(" + ");
      let r;
      try { r = await pub(d); } catch (e) { V("البوّابة سقطت باستثناء على «" + what + "»: " + e.message); continue; }
      seen[r.code] = (seen[r.code] || 0) + 1;
      if (r.ok && r.code === "published") V("نُشر مرشَّحٌ فاسد: " + what);
      if (head() !== good) V("تغيّر المنشور بعد «" + what + "»");
      fs.rmSync(d, { recursive: true, force: true });
    }
    if (rf("summary.json").updated !== goodUpd) V("تغيّر ملخّص المنشور");

    /* ٢) كريبتو فاسد مع أسهمٍ سليمةٍ أحدث — يُنشر، وكريبتو المنشور لا يُمسّ */
    const cBefore = rf("crypto/summary.json").updated, cRows = rf("crypto/summary.json").rows.length;
    let cDone = 0;
    for (const [name, fn] of CORRUPT_CRYPTO) {
      const d = mk();
      const g = path.join(d, "summary.json"); const s = rjf(g); s.updated = rf("summary.json").updated + 60000; wjf(g, s);
      fn(d);
      const r = await pub(d);
      if (r.code !== "published") V(`«${name}»: الأسهم السليمة لم تُنشر (${r.code}: ${r.why})`);
      if (rf("crypto/summary.json").updated !== cBefore || rf("crypto/summary.json").rows.length !== cRows)
        V(`«${name}»: تغيّر كريبتو المنشور أو حُذف`);
      cDone++;
      fs.rmSync(d, { recursive: true, force: true });
    }

    /* ٣) سباقاتٌ متزامنة — المنشورُ أحدثُ ما نجح، ولا يفوز أقدم */
    let newest = rf("summary.json").updated, raceRounds = 0, won = 0, lost = 0;
    const R = rounds ?? Math.max(3, Math.round(N / 20));
    for (let round = 0; round < R; round++) {
      const dirs = [];
      for (let i = 0; i < 4; i++) {
        const d = mk(); const f = path.join(d, "summary.json"); const s = rjf(f);
        s.updated = newest + (i + 1) * 1000 * (round + 1); wjf(f, s); dirs.push([d, s.updated]);
      }
      const order = dirs.slice().sort(() => Math.random() - 0.5);
      const res = await Promise.all(order.map(([d]) => pub(d)));
      const after = rf("summary.json").updated;
      const okUpd = order.filter((_, i) => res[i].code === "published").map(([, u]) => u);
      won += okUpd.length; lost += res.filter((r) => r.code === "lease" || r.code === "regression" || r.code === "locked").length;
      if (!okUpd.length) V(`جولة ${round}: لم ينجح أيُّ نشر`);
      if (after < newest) V(`جولة ${round}: المنشور نزل ${newest} → ${after}`);
      if (okUpd.length && after !== Math.max(...okUpd)) V(`جولة ${round}: المنشور ${after} ليس أحدثَ الناجحين ${Math.max(...okUpd)}`);
      newest = Math.max(newest, after); raceRounds++;
      for (const [d] of dirs) fs.rmSync(d, { recursive: true, force: true });
    }
    return { ok: !violations.length, violations, gate: seen, candidates: picks.length, cryptoCases: cDone,
             raceRounds, racePublished: won, raceRejected: lost };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
