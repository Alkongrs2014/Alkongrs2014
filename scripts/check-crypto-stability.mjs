#!/usr/bin/env node
/* =====================================================================
   ثبات دفتر الكريبتو داخل الشمعة — **مسارُ الخادم كاملاً**، بلا شبكة.

   الشرط الذي طلبه المالك صياغةً قابلةً للتنفيذ:
     «إذا لم يتغيّر candleKey فلا تتغيّر النتيجة» — النقاط وعدد
     الاستراتيجيات والترتيب والاتجاه والأهداف.

   فيُبنى الدفتر مرّتين من **نفس ملفّات الشمعات** في لحظتين داخل شمعة
   ‎5د‎ واحدة، والثانية وقد تحرّكت كلُّ شمعةٍ جارية (على الفريمات الخمسة)
   وتحرّك السعر اللحظي ‎±8%‎ — وهو كلُّ ما يتغيّر فعلاً بين دورتين داخل
   الشمعة. ثم يمرّ كلٌّ منهما بالتحليل (`analyzeRec`/`buildRow` من
   `fetch-crypto` نفسه) ثم المحرّك ثم اللقطة، والشرط: البصمة واحدة.

   **والضابط المعاكس شرطُ قبولٍ كذلك**: إغلاقُ شمعةٍ جديدة بإغلاقٍ مختلف
   يجب أن يغيّر شيئاً — فحصٌ يمرّ مهما تغيّرت المدخلات ليس فحصاً، ونظامٌ
   لا يتحرّك أبداً معطَّلٌ لا ثابت.

   يُشغَّل:  node scripts/check-crypto-stability.mjs
   ===================================================================== */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzeRec, buildRow, regimeOf } from "./fetch-crypto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDIR = path.join(ROOT, "data", "crypto");
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n} — ${e.message}`); fail++; } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const rdj = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const BAR5 = 3e5;

if (!fs.existsSync(path.join(CDIR, "universe.json"))) { console.log("  (لا دفتر كريبتو محلياً — تُخطّى)"); process.exit(0); }

const U = rdj(path.join(CDIR, "universe.json")).rows;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cstab-"));
/* نسخةٌ واحدة من القرص: المجدول يكتب `data/crypto` كل خمس دقائق */
fs.cpSync(CDIR, path.join(TMP, "base"), { recursive: true,
  filter: (p) => !/[\\/](logs|strat|\.monitor)([\\/]|$)/.test(p) && !/\.run\.lock$/.test(p) });
const base = path.join(TMP, "base");
const meta = rdj(path.join(base, "meta.json"));
const F = meta.marketUpdated;                                     // لحظةُ الجلب
const K0 = Math.floor(F / BAR5) * BAR5;                           // بدايةُ الشمعة الجارية عندها

const syms = {};
for (const u of U) { try { syms[u.s] = rdj(path.join(base, "sym", u.s + ".json")); } catch { /* بلا ملف */ } }

/* يبني الدفتر في مجلّدٍ عند اللحظة `now` بعد تحويل الشمعات بـ`mut`. */
function build(dir, now, mut, pxMul) {
  fs.cpSync(base, dir, { recursive: true });
  const rows = [], recs = {};
  for (const u of U) {
    const src = syms[u.s];
    if (!src) continue;
    const rec = JSON.parse(JSON.stringify(src));
    for (const [tf, o] of Object.entries(rec.tf || {})) o.c = mut(tf, o.c);
    analyzeRec(rec, now, src.band);
    fs.writeFileSync(path.join(dir, "sym", u.s + ".json"), JSON.stringify(rec));
    recs[u.s] = rec;
    rows.push(buildRow(rec, u, { price: (src.an ? 1 : 1) * pxMul * (rec.tf["5m"]?.c?.at(-1)?.[4] || 1), chg: 3, quoteVolume: 1e6 }, now));
  }
  const m = rdj(path.join(dir, "market.json"));
  m.regime = regimeOf(recs["BTC-USD"], rows);
  fs.writeFileSync(path.join(dir, "market.json"), JSON.stringify(m));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ updated: now, count: rows.length, rows }));
  fs.rmSync(path.join(dir, "opportunities.json"), { force: true });   // بناءٌ كامل لا «لا تغيّر»
  const env = { ...process.env, BOOK: "crypto", OPP_BAR_SEC: "300", OPP_OUT: dir };
  for (const a of [["scripts/track-strategies.mjs", "--out", dir], ["scripts/build-opportunities.mjs"]]) {
    const r = spawnSync(process.execPath, a, { cwd: ROOT, env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${a[0]}: ${(r.stderr || r.stdout).slice(-300)}`);
  }
  const o = rdj(path.join(dir, "opportunities.json"));
  const st = rdj(path.join(dir, "strategies.json"));
  return { o, st, rows };
}

const same = (tf, c) => c;
/* الجارية تتحرّك: كلُّ شمعةٍ لم تُغلق عند `now` تُشوَّه قمّةً وقاعاً وإغلاقاً */
const barMs = { "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
const jiggle = (now, f) => (tf, c) => c.map(b => {
  const t0 = b[0] * 1000;
  const live = tf === "1d" ? Math.floor(t0 / 864e5) >= Math.floor(now / 864e5) : t0 + barMs[tf] > now;
  return live ? [b[0], b[1], b[2] * f, b[3] / f, b[4] * f, b[5] * 3] : b;
});

try {
  const T1 = K0 + 20e3, T2 = K0 + 280e3;          // داخل نفس شمعة ‎5د‎
  const A = build(path.join(TMP, "A"), T1, same, 1);
  const B = build(path.join(TMP, "B"), T2, jiggle(T2, 1.08), 1.08);

  t("المفتاح واحد في اللحظتين", () => ok(A.o.candleKey === B.o.candleKey, `${A.o.candleKey} ≠ ${B.o.candleKey}`));
  t("النقاط والفريمات لا تتحرّك داخل الشمعة", () => {
    const d = A.rows.filter((r, i) => r.score !== B.rows[i].score || JSON.stringify(r.tfScore) !== JSON.stringify(B.rows[i].tfScore));
    ok(!d.length, `${d.length} عملة تغيّرت نتيجتها: ${d.slice(0, 4).map(r => r.s).join(", ")}`);
  });
  t("عدد الاستراتيجيات وجهاتها لا تتحرّك داخل الشمعة", () => {
    const k = (s) => JSON.stringify(s.rows.map(r => [r.s, r.st, r.dir, r.sc, r.act]));
    ok(k(A.st) === k(B.st), "strategies.json اختلف");
  });
  t("اللقطة واحدة بالحرف — عضويةً وترتيباً ودرجةً واتجاهاً وأهدافاً", () => {
    ok(A.o.rowsHash === B.o.rowsHash, `${A.o.rowsHash} ≠ ${B.o.rowsHash}`);
    ok(JSON.stringify(A.o.scans) === JSON.stringify(B.o.scans), "الصفوف اختلفت");
    ok(JSON.stringify(A.o.regime) === JSON.stringify(B.o.regime), "توجّه البيتكوين اختلف");
  });
  t("والتشويه حقيقيّ: السعر اللحظي والشمعة الجارية تحرّكا فعلاً", () => {
    const moved = A.rows.filter((r, i) => r.p !== B.rows[i].p).length;
    ok(moved > A.rows.length * 0.9, `${moved} سعراً تحرّك فقط`);
  });

  /* الضابط المعاكس: شمعةٌ جديدة أُغلقت بإغلاقٍ مختلف ⇒ شيءٌ يتغيّر */
  const T3 = K0 + BAR5 + 20e3;
  const close = (tf, c) => {
    if (tf !== "5m") return c;
    const last = c[c.length - 1], nb = [(K0 + BAR5) / 1000, last[4], last[4] * 1.3, last[4] * 0.97, last[4] * 1.25, last[5] * 20];
    return [...c.filter(b => b[0] * 1000 < K0), [K0 / 1000, last[1], Math.max(last[2], last[4] * 1.3), last[3], last[4] * 1.25, last[5] * 20], nb];
  };
  const C = build(path.join(TMP, "C"), T3, close, 1.25);
  t("والشمعة الجديدة تُقدّم المفتاح وتغيّر النتيجة — النظام حيّ لا جامد", () => {
    ok(C.o.candleKey === A.o.candleKey + 300, `المفتاح ${C.o.candleKey}`);
    ok(C.o.rowsHash !== A.o.rowsHash, "إغلاقُ شمعةٍ بقفزة ‎25%‎ لم يغيّر شيئاً");
  });
  console.log(`\n  شمعة ${new Date(A.o.candleKey * 1000).toISOString().slice(11, 16)}Z · ${A.rows.length} عملة · ${A.o.count} صفّاً · بصمة ${A.o.rowsHash}`);
} finally { fs.rmSync(TMP, { recursive: true, force: true }); }

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
