#!/usr/bin/env node
/* =====================================================================
   مُجمِّع الفحوص الذاتية — كلُّ `--check` وكلُّ `check-*.mjs` بلا شبكة.

   كانت ثلاثون فحصاً متفرّقة ولا شيء يشغّلها معاً: CI يشغّل ثلاثةً منها،
   والبقية تعتمد على أن يتذكّرها أحد. وهذا بالضبط ما جعل عللاً موثّقة
   تعود — فحصٌ موجود لا يُشغَّل ليس فحصاً.

   **القراءة من لقطةٍ ثابتة**: الفحوص التي تقرأ `data/` تُعطى نسخةً أُخذت
   تحت قفل الكاتب (`WEBTRADE_DATA`)، فلا يحكم فحصٌ على ملفٍّ في منتصف
   كتابته. و`--out` يشير إلى اللقطة كذلك: فحصٌ يكتب بالخطأ يكتب في نسخةٍ
   مؤقّتة لا في بيانات الإنتاج.

   الاستعمال:
     node scripts/run-checks.mjs            الكلّ
     node scripts/run-checks.mjs --fixtures تشغيلُ CI: بيانات الاختبار المثبّتة
     node scripts/run-checks.mjs --only=ui,session
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, takeSnapshot, dropSnapshot } from "./lib/snapshot.mjs";

const args = process.argv.slice(2);
const FIXTURES = args.includes("--fixtures");
const only = (args.find(a => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);

/* `data: true` — يقرأ بيانات الإنتاج فيحتاج اللقطة (ويُتخطّى في CI بلا
   بيانات إن لم تتوفّر مثبّتات). `live` — يحتاج الشبكة فلا مكان له هنا. */
/* فحوص المحرّك القديم (check-strategies · check-direction · check-opportunity-* ·
   check-books · check-crypto-stability · check-snapshot-purity · track-* ·
   build-opportunities · backtest-* · replay · learn · scan-ma200-open) أُخرجت مع
   المحرّك نفسه — نسختُها أرشيفٌ في legacy_strategy_engine/. فحصُ المحرّك V3
   الذاتي هنا، ومقارنتُه بمرجعه المستقلّ وحتميّتُه في vitest والطبيب. */
const CHECKS = [
  { id: "ui",             cmd: ["scripts/check-ui.mjs"] },
  { id: "session",        cmd: ["scripts/check-session.mjs"] },
  { id: "build-trades",   cmd: ["scripts/build-trades.mjs", "--check"] },
  { id: "fetch-contracts", cmd: ["scripts/fetch-contracts.mjs", "--check"] },
  ...["fetch-quotes", "fetch-market", "fetch-calendar", "fetch-news", "fetch-daily", "fetch-options", "fetch-filings",
      "fetch-events", "fetch-crypto", "build-universe", "analytics", "market-direction"]
    .map(n => ({ id: n, cmd: [`scripts/${n}.mjs`, "--check"], data: true, out: true })),
];

const main = async () => {
  let snap = null;
  /* المثبّتات تُنسخ إلى مجلّدٍ مؤقّت: بعض أوضاع `--check` تكتب في `--out`،
     والكتابة في المثبّتات الملتزمة تُفسد المرجع المجمَّد بصمت. */
  if (FIXTURES) snap = await takeSnapshot({ src: path.join(ROOT, "tests", "fixtures", "data"), job: "checks" });
  else if (fs.existsSync(path.join(ROOT, "data"))) snap = await takeSnapshot({ job: "checks" });

  const results = [];
  const t00 = Date.now();
  for (const c of CHECKS) {
    if (only.length && !only.includes(c.id)) continue;
    if (c.data && !snap) { results.push({ id: c.id, status: "SKIP", why: "لا بيانات" }); continue; }
    const argv = [...c.cmd];
    if (c.out) argv.push("--out", snap);
    if (c.argData) argv.push(snap);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, argv, {
      cwd: ROOT, encoding: "utf8", timeout: 15 * 60000, maxBuffer: 64 << 20,
      env: { ...process.env, WEBTRADE_DATA: snap || "", OUT_DIR: snap || "", NO_NETWORK: "1" }
    });
    const ms = Date.now() - t0;
    const tail = ((r.stdout || "") + (r.stderr || "")).trim().split(/\r?\n/).slice(-6).join("\n");
    const status = r.status === 0 ? "PASS" : "FAIL";
    results.push({ id: c.id, status, code: r.status, signal: r.signal, ms, tail: status === "PASS" ? undefined : tail });
    console.log(`${status === "PASS" ? "✔" : "✗"} ${c.id.padEnd(22)} ${String(ms).padStart(6)}ms`);
    if (status === "FAIL") console.log("    " + tail.replace(/\n/g, "\n    "));
  }
  if (snap) dropSnapshot(snap);

  const fail = results.filter(r => r.status === "FAIL");
  const report = { at: new Date().toISOString(), ms: Date.now() - t00, fixtures: FIXTURES,
    pass: results.filter(r => r.status === "PASS").length, fail: fail.length,
    skip: results.filter(r => r.status === "SKIP").length, results };
  fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "reports", "checks-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${fail.length ? "FAIL" : "PASS"} — ${report.pass} نجح · ${report.fail} فشل · ${report.skip} تُخطّي`);
  process.exit(fail.length ? 1 : 0);
};
main();
