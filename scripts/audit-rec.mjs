#!/usr/bin/env node
/* =====================================================================
   مدقّق التوصية — `npm run audit:rec -- <رمز> [شرط] [--shown=e,st,t1]`

   يصنّف توصيةً اشتكى منها مستخدم:
     A · علّة محرّك   الإنتاج يخالف المرجع المستقلّ على مدخلاتها المحفوظة، أو
                      إعادةُ حسابها بنفس المحرّك لا تعيد ما سُجّل.
     B · علّة بيانات  بصمةُ المدخلات المؤرشفة لا تطابق المختومة، أو شمعاتٌ فاسدة
                      (OHLC، ختمٌ غير تصاعدي، فريمٌ ناقص).
     C · علّة عرض     ما رآه المستخدم (`--shown`) يخالف اللقطة المحفوظة.
     D · حُسبت صحيحةً وخالفها السوق — تُعرض نتيجتُها من السجلّ كما هي.
   ولا يُحكم على جودة الاستراتيجية من صفقةٍ واحدة — يُقال صراحةً.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT, DATA_DIR } from "./lib/snapshot.mjs";
import { inputHash } from "./lib/audit-trail.mjs";
import * as R from "../tests/reference/engine.mjs";
import { AN_FIELDS, near } from "../tests/reference/compare.mjs";

const require = createRequire(import.meta.url);
const IND = require("../stocks/indicators.js");
const SC = require("../stocks/score.js");
const P = require("../stocks/plan.js");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const opt = (k) => { const a = process.argv.find((x) => x.startsWith(k + "=")); return a ? a.slice(k.length + 1) : null; };
const [SYM, WHICH] = args;
if (!SYM) { console.log("الاستعمال: node scripts/audit-rec.mjs <رمز> [شرط|استراتيجية] [--shown=دخول,وقف,هدف1]"); process.exit(2); }

const rj = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")); } catch { return null; } };
const pool = [];
for (const [f, kind] of [["signals.json", "scan"], ["history.json", "scan"], ["strat-signals.json", "strat"], ["strat-history.json", "strat"],
                         ["crypto/strat-signals.json", "strat"], ["crypto/strat-history.json", "strat"]]) {
  for (const r of (rj(f) || {}).records || []) if (r.sym === SYM && (!WHICH || r.scan === WHICH || r.strat === WHICH)) pool.push({ ...r, _file: f, _kind: kind });
}
if (!pool.length) { console.log(`لا سجلّ لـ${SYM}${WHICH ? " / " + WHICH : ""}`); process.exit(1); }
const rec = pool.sort((a, b) => b.at - a.at)[0];
const verdict = { sym: SYM, record: { file: rec._file, id: rec.scan || rec.strat, at: new Date(rec.at).toISOString(), dir: rec.dir || rec.snap?.dir || 1 },
                  class: null, findings: [] };
const F = (cls, what) => verdict.findings.push({ cls, what });

if (!rec.aud) {
  F("?", "سجلٌّ من قبل أثر التدقيق (لا `aud`) — لا مدخلاتٍ محفوظة لإعادة إنتاجه؛ يُقرأ ما سُجّل وحده");
} else {
  const day = new Date(rec.aud.ck * 1000).toISOString().slice(0, 10);
  const arch = rj(`audit/${day}/${SYM.replace(/[^\w.-]/g, "_")}-${rec.aud.ck}.json`);
  if (!arch) F("B", "ملفّ المدخلات المؤرشف غائب");
  else {
    /* B — سلامة المدخلات */
    if (inputHash(arch.inputs) !== rec.aud.ih) F("B", `بصمة المدخلات ${inputHash(arch.inputs)} ≠ المختومة ${rec.aud.ih}`);
    for (const [tf, c] of Object.entries(arch.inputs)) for (let i = 0; i < c.length; i++) {
      const [t, o, h, l, cl] = c[i];
      if (i && !(t > c[i - 1][0])) { F("B", `${tf}: ختمٌ غير تصاعدي عند ${i}`); break; }
      if (!(h >= Math.max(o, cl) && Math.min(o, cl) >= l && l > 0)) { F("B", `${tf}: شمعةٌ فاسدة عند ${i}`); break; }
    }
    /* A — المحرّك: الإنتاج مقابل المرجع، وإعادة الحساب مقابل المسجَّل */
    const byP = {}, byR = {};
    for (const [tf, c] of Object.entries(arch.inputs)) {
      const a = IND.analyze(P.unpackK(c)), b = R.analyzeRef(R.unpack(c));
      if (a) byP[tf] = a; if (b) byR[tf] = b;
      if (a && b) for (const f of AN_FIELDS) if (!near(a[f], b[f])) { F("A", `${tf}.${f}: الإنتاج ${a[f]} ≠ المرجع ${b[f]}`); break; }
    }
    const score = SC.overallScore(byP);
    if (Number.isFinite(rec.sc) && Number.isFinite(score) && Math.abs(Math.round(score * 100) / 100 - rec.sc) > 0.011)
      F("A", `النتيجة المعادة ${score.toFixed(2)} ≠ المسجَّلة ${rec.sc} على نفس المدخلات`);
    verdict.recomputed = { score: Number.isFinite(score) ? +score.toFixed(2) : null, engine: rec.aud.ev, commit: rec.aud.cm };
  }
}
/* C — العرض */
if (opt("--shown") && rec.snap) {
  const [e, st, t1] = opt("--shown").split(",").map(Number);
  const near2 = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 5e-4);
  if (Number.isFinite(e) && !near2(e, rec.snap.e)) F("C", `الدخول المعروض ${e} ≠ المحفوظ ${rec.snap.e}`);
  if (Number.isFinite(st) && !near2(st, rec.snap.st)) F("C", `الوقف المعروض ${st} ≠ المحفوظ ${rec.snap.st}`);
  if (Number.isFinite(t1) && rec.snap.t && !near2(t1, rec.snap.t[0])) F("C", `الهدف الأول المعروض ${t1} ≠ المحفوظ ${rec.snap.t[0]}`);
}
/* الحكم */
const order = ["A", "B", "C"];
verdict.class = order.find((c) => verdict.findings.some((f) => f.cls === c)) || (rec.aud ? "D" : "?");
verdict.outcome = rec.out || null;
verdict.note = verdict.class === "D"
  ? "حُسبت التوصية صحيحةً على مدخلاتها — ونتيجتُها حركةُ السوق. ولا يُحكم على جودة الاستراتيجية من صفقةٍ واحدة."
  : verdict.class === "?" ? "لا يمكن التصنيف بلا أثر تدقيق." : "خللٌ برمجيّ — يُفتح له اختبارُ انحدار.";
console.log(JSON.stringify(verdict, null, 2));
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", `audit-${SYM}.json`), JSON.stringify(verdict, null, 2));
