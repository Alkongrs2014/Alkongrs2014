#!/usr/bin/env node
/* =====================================================================
   فحص الدفترين — الأسهم والكريبتو منفصلان **بالبيانات لا بالنيّة**. بلا شبكة.

   السياق: الكريبتو كان داخل ملخّص الأسهم، فكانت شمعةُ عملةٍ تُقدّم
   `candleKey = max(cbar)` للكون كلّه، والرتبة المئوية تُحسب على المجمَّع —
   فتتحرّك درجةُ سهمٍ لم تُغلق شمعته. فأُخرج الكريبتو كلّه (2026-09-25)،
   ثم عاد **دفتراً ثانياً**: كونُه `stocks/crypto.json`، ومجلّده
   `data/crypto/`، وقفلُه وسجلُّه ولقطتُه له وحده.

   وهذا الملفّ يحرس الانفصال من ثلاث جهات:
     ١) الكونان: لا كريبتو في الأسهم، ولا سهم في الكريبتو، ولا رمز مشترك.
     ٢) البيانات المكتوبة: لا `-USD` ولا `mkt:"crypto"` في ملفّات الأسهم،
        ولا صفّ غير كريبتو في ملفّات الكريبتو.
     ٣) **الاستقلال السببيّ**: محرّكُ الأسهم ولقطتُها يُبنيان مرّتين من
        نفس النسخة — مرّةً ودفترُ الكريبتو كما هو، ومرّةً وقد أُغلقت فيه
        شمعةٌ جديدة وتحرّكت أسعاره — ويجب أن يخرجا متطابقَين بالحرف.
        ودفترُ الكريبتو يُبنى في نسخةٍ ثم تُقارن ملفّات الأسهم حولها
        قبل وبعد: صفر ملفٍّ يتغيّر خارج `crypto/`.

   ويُثبت أنه يُسقط نفسه: صفٌّ `-USD` محقونٌ في ملخّص الأسهم يجب أن يُرصد.
   ===================================================================== */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const CDIR = path.join(DATA, "crypto");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name} — ${e.message}`); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const rdj = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const isCoin = (s) => /-USD$/.test(s);

/* ---------- ١) الكونان ---------- */
const US = rdj(path.join(ROOT, "stocks/symbols.json"));
const CR = rdj(path.join(ROOT, "stocks/crypto.json"));

t("كون الأسهم بلا كريبتو", () => {
  const all = [...US.symbols, ...(US.wide || []), ...(US.crypto || [])];
  const bad = all.filter(x => x.mkt === "crypto" || isCoin(x.s));
  ok(!bad.length, `في symbols.json: ${bad.map(x => x.s).join(", ")}`);
});
t("كون الكريبتو كريبتو كلُّه وثابت", () => {
  ok(CR.fixed === true, "crypto.json بلا fixed");
  ok(CR.symbols.length >= 10, `${CR.symbols.length} زوجاً فقط`);
  const bad = CR.symbols.filter(x => x.mkt !== "crypto" || !isCoin(x.s));
  ok(!bad.length, `غير كريبتو: ${bad.map(x => x.s).join(", ")}`);
  ok(!(CR.wide || []).length && !(CR.crypto || []).length && !(CR.indices || []).length,
     "طبقاتٌ إضافية في كون الكريبتو");
  ok(new Set(CR.symbols.map(x => x.s)).size === CR.symbols.length, "رمزٌ مكرّر");
});
t("لا رمز مشترك بين الكونين", () => {
  const u = new Set(US.symbols.map(x => x.s));
  const both = CR.symbols.filter(x => u.has(x.s));
  ok(!both.length, both.map(x => x.s).join(", "));
});

/* ---------- ٢) البيانات المكتوبة ---------- */
/* يعيد المخالفات بدل أن يرمي — كي يُختبر بحقنٍ متعمَّد (الفحص الأخير). */
function violations(dir, want) {
  const out = [];
  const bad = want === "us"
    ? (s, mkt) => mkt === "crypto" || isCoin(s)
    : (s, mkt) => (mkt != null && mkt !== "crypto") || !isCoin(s);
  const read = (f) => { try { return rdj(path.join(dir, f)); } catch { return null; } };
  for (const r of read("summary.json")?.rows || []) if (bad(r.s, r.mkt)) out.push(`summary:${r.s}`);
  const opp = read("opportunities.json");
  for (const [id, rows] of Object.entries(opp?.scans || {}))
    for (const r of rows) if (bad(r.s)) out.push(`scans.${id}:${r.s}`);
  for (const s of Object.keys(opp?.bySym || {})) if (bad(s)) out.push(`bySym:${s}`);
  for (const r of read("strategies.json")?.rows || []) if (bad(r.s)) out.push(`strategies:${r.s}`);
  if (fs.existsSync(path.join(dir, "sym")))
    for (const f of fs.readdirSync(path.join(dir, "sym"))) {
      const s = f.replace(/\.json$/, "");
      if (want === "us" ? isCoin(s) : !isCoin(s)) out.push(`sym/${f}`);
    }
  return out;
}

t("ملفّات الأسهم بلا رمز كريبتو", () => {
  const v = violations(DATA, "us");
  ok(!v.length, v.slice(0, 8).join(" · "));
});
t("ملفّات الكريبتو بلا رمز سهم", () => {
  if (!fs.existsSync(path.join(CDIR, "summary.json"))) { console.log("    (لا دفتر كريبتو محلياً بعد)"); return; }
  const v = violations(CDIR, "crypto");
  ok(!v.length, v.slice(0, 8).join(" · "));
});
t("المفتاحان مستقلّان: لقطة الكريبتو بمفتاحها وملفّها", () => {
  const c = path.join(CDIR, "opportunities.json");
  if (!fs.existsSync(c)) return;
  const us = rdj(path.join(DATA, "opportunities.json")), cr = rdj(c);
  ok(Number.isFinite(cr.candleKey) && cr.candleKey % 900 === 0, "مفتاح الكريبتو ليس على شبكة الربع ساعة");
  // مصدرُ مفتاح الأسهم صفوفُ الأسهم وحدها — لا أحدثُ من أحدث cbar سهم
  const maxUs = Math.max(...rdj(path.join(DATA, "summary.json")).rows.map(r => r.cbar || 0));
  ok(us.candleKey <= maxUs, `مفتاح الأسهم ${us.candleKey} أحدث من صفوف الأسهم ${maxUs}`);
});

/* ---------- ٣) الاستقلال السببيّ ---------- */
const node = (args, env = {}) => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${args[0]} رمز ${r.status}: ${(r.stderr || r.stdout).slice(-300)}`);
  return r.stdout;
};
const copyTree = (src, dst, skip = () => false) =>
  fs.cpSync(src, dst, { recursive: true, filter: (p) => !skip(p) });
const hashTree = (dir, skipDir) => {
  const h = {};
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (p === skipDir) continue;
      if (fs.statSync(p).isDirectory()) walk(p);
      else h[path.relative(dir, p)] = crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return h;
};
// بلا ختم الكتابة: اللقطتان تُبنيان في لحظتين فيختلف `generatedAt` بحقّ
const canonOpp = (f) => { const j = rdj(f); delete j.generatedAt; return JSON.stringify(j); };
/* و`pAt` ختمُ ساعة الحائط لحظةَ الكتابة — قِيس أنه الحقل **الوحيد** الذي
   يختلف بين تشغيلين متتاليين على مدخلٍ واحد، فإبقاؤه يُقرأ أثراً للكريبتو. */
const canonStrat = (f) => { const j = rdj(f);
  return JSON.stringify({ confBar: j.confBar, rows: j.rows.map(({ pAt, ...r }) => r) }); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "books-"));
const haveCrypto = fs.existsSync(path.join(CDIR, "summary.json"));
// نسخةُ الأسهم: كلُّ ما يقرؤه المحرّك واللقطة، بلا الأرشيف ولا الكريبتو
const skipUs = (p) => /[\\/](\.archive|\.monitor|logs|crypto|replay|audit)([\\/]|$)/.test(path.relative(ROOT, p))
  || /\.run\.lock$/.test(p);

try {
  const A = path.join(TMP, "A"), B = path.join(TMP, "B");
  /* نسخةٌ واحدة من القرص ثم B منها — لا نسختان من القرص: المجدول يكتب
     `data/` كل دقيقتين، ونسختان في لحظتين تُقارنان مدخلَين مختلفين
     فيُقرأ الفرقُ أثراً للكريبتو وهو دورةُ أسعار. */
  copyTree(DATA, A, skipUs);
  if (haveCrypto) copyTree(CDIR, path.join(A, "crypto"), (p) => /[\\/]logs([\\/]|$)/.test(p));
  copyTree(A, B);

  /* الطرف B: شمعةُ كريبتو جديدة أُغلقت وأسعاره تحرّكت ‎+7%‎ — أقصى ما
     يمكن أن يحدث في دفتر الكريبتو بين دورتَي أسهم. */
  if (haveCrypto) {
    const f = path.join(B, "crypto/summary.json");
    const s = rdj(f);
    for (const r of s.rows) { r.cbar = (r.cbar || 0) + 900; r.p = r.p * 1.07; r.pc = r.pc * 1.07; }
    fs.writeFileSync(f, JSON.stringify(s));
    const o = path.join(B, "crypto/opportunities.json");
    const j = rdj(o); j.candleKey += 900; fs.writeFileSync(o, JSON.stringify(j));
  }

  t("محرّك الأسهم لا يتأثّر بأيّ شمعة أو سعر كريبتو", () => {
    for (const D of [A, B]) node(["scripts/track-strategies.mjs", "--out", D]);
    ok(canonStrat(path.join(A, "strategies.json")) === canonStrat(path.join(B, "strategies.json")),
       "strategies.json للأسهم اختلف بين الطرفين");
  });
  t("لقطة فرص الأسهم لا تتأثّر — عضويةً وترتيباً ودرجةً ومفتاحاً", () => {
    for (const D of [A, B]) {
      fs.rmSync(path.join(D, "opportunities.json"), { force: true });   // بناءٌ كامل لا «لا تغيّر»
      node(["scripts/build-opportunities.mjs"], { OPP_OUT: D });
    }
    const a = rdj(path.join(A, "opportunities.json")), b = rdj(path.join(B, "opportunities.json"));
    ok(a.candleKey === b.candleKey, `candleKey ${a.candleKey} ≠ ${b.candleKey}`);
    ok(a.rowsHash === b.rowsHash, `rowsHash ${a.rowsHash} ≠ ${b.rowsHash}`);
    ok(canonOpp(path.join(A, "opportunities.json")) === canonOpp(path.join(B, "opportunities.json")),
       "opportunities.json للأسهم اختلف");
  });

  t("دفتر الكريبتو لا يكتب خارج مجلّده", () => {
    if (!haveCrypto) return;
    const before = hashTree(A, path.join(A, "crypto"));
    node(["scripts/track-strategies.mjs", "--out", path.join(A, "crypto")]);
    node(["scripts/build-opportunities.mjs"], { OPP_OUT: path.join(A, "crypto") });
    const after = hashTree(A, path.join(A, "crypto"));
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter(k => before[k] !== after[k]);
    ok(!changed.length, `تغيّر خارج crypto/: ${changed.slice(0, 6).join(", ")}`);
  });

  t("الفحص يُسقط نفسه: صفّ -USD محقونٌ في ملخّص الأسهم يُرصد", () => {
    const f = path.join(B, "summary.json");
    const s = rdj(f);
    s.rows.push({ s: "BTC-USD", mkt: "crypto", p: 1 });
    fs.writeFileSync(f, JSON.stringify(s));
    ok(violations(B, "us").includes("summary:BTC-USD"), "الحقن لم يُرصد");
  });
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
