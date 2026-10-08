#!/usr/bin/env node
/* =====================================================================
   تعليقات CI — أسماء اختبارات vitest الساقطة وأوّل رسالة لكلٍّ منها
   كتعليقات GitHub (`::error`)، تُقرأ من واجهة check-runs العامة بلا
   تسجيل دخول. سجلُّ الخطوة نفسه لا يُقرأ إلا بمصادقة، فكان سقوطُ البوّابة
   في CI يُرى «exit code 1» وحده والاختبارات كلّها ناجحة محلياً.
     node scripts/ci-annotate.mjs [reports/vitest-report.json] [vitest.log]
   ===================================================================== */
import fs from "node:fs";

const f = process.argv[2] || "reports/vitest-report.json";
let j = null;
try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.log(`::error title=vitest::لا تقرير (${f}): ${e.message}`); process.exit(0); }
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
const ESC = String.fromCharCode(27);
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
/* ما خارج الاختبارات: «Unhandled Errors» ومهلة العامل في مخرجات vitest نفسها (الوسيط الثاني) */
const logF = process.argv[3];
if (logF && fs.existsSync(logF)) {
  const L = fs.readFileSync(logF, "utf8").split(ESC).map((x, k) => k ? x.replace(/^\[[0-9;]*m/, "") : x).join("").split("\n");
  const i = L.findIndex((x) => /Unhandled|onTaskUpdate|Timeout calling|Worker exited|ERR_/i.test(x));
  if (i >= 0) { n++; console.log(`::error title=vitest (خارج الاختبارات)::${esc(L.slice(Math.max(0, i - 2), i + 14).join("\n").slice(0, 1500))}`); }
}
if (!n) console.log(`::error title=vitest::لا اختبار ساقط في التقرير (${j.numFailedTests} ساقط · ${j.numPassedTests} ناجح · success=${j.success}) — السقوط من خارج الاختبارات (خطأٌ غير ملتقَط أو مهلة عامل)`);
