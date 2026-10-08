#!/usr/bin/env node
/* =====================================================================
   تعليقات CI — أسماء اختبارات vitest الساقطة وأوّل رسالة لكلٍّ منها
   كتعليقات GitHub (`::error`)، تُقرأ من واجهة check-runs العامة بلا
   تسجيل دخول. سجلُّ الخطوة نفسه لا يُقرأ إلا بمصادقة، فكان سقوطُ البوّابة
   في CI يُرى «exit code 1» وحده والاختبارات كلّها ناجحة محلياً.
     node scripts/ci-annotate.mjs [reports/vitest-report.json]
   ===================================================================== */
import fs from "node:fs";

const f = process.argv[2] || "reports/vitest-report.json";
let j = null;
try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.log(`::error title=vitest::لا تقرير (${f}): ${e.message}`); process.exit(0); }
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
let n = 0;
for (const file of j.testResults || []) {
  for (const t of file.assertionResults || []) {
    if (t.status !== "failed" || n >= 9) continue;
    n++;
    console.log(`::error title=vitest ${esc(file.name.split(/[\\/]tests[\\/]/).pop())}::${esc(t.fullName)} — ${esc((t.failureMessages || [""])[0].slice(0, 400))}`);
  }
  if (file.status === "failed" && !(file.assertionResults || []).some((t) => t.status === "failed") && n < 9) {
    n++;
    console.log(`::error title=vitest ${esc(file.name.split(/[\\/]tests[\\/]/).pop())}::ملفٌّ ساقط بلا اختبارٍ ساقط — ${esc(String(file.message || "").slice(0, 400))}`);
  }
}
if (!n) console.log(`::error title=vitest::لا اختبار ساقط في التقرير (${j.numFailedTests} ساقط · ${j.numPassedTests} ناجح · success=${j.success}) — السقوط من خارج الاختبارات (خطأٌ غير ملتقَط أو مهلة عامل)`);
