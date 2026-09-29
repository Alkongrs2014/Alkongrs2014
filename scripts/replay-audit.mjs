#!/usr/bin/env node
/* =====================================================================
   إعادة التشغيل التاريخية — تدقيقُ الثوابت على كلّ ما حُفظ عبر الزمن.

   لا يختبر آخر لقطةٍ وحدها. يمرّ بالترتيب الزمني على:
     ١) خطّ الزمن المنشور (`crypto/.monitor/live.jsonl` — كلُّ نشرٍ رصده
        المراقب): المفتاح لا ينزل، ونفس المفتاح ⇒ نفس البصمة، لكلا الدفترين.
     ٢) كلّ لقطةٍ مؤرشفة (كريبتو `.monitor/snaps` · أسهم `.monitor/<يوم>/snap`):
        الشبكة، والدفتر النظيف، وجهةُ الخطة، ولا رمزٌ بجهتين.
     ٣) السفر في الزمن على الشمعات: يُقصّ كلُّ ملفّ رمزٍ عند نقاط قطعٍ ماضية
        ويُقارَن الإنتاج بالمرجع المستقلّ عند كلٍّ منها (المؤشّرات والنتيجة).
     ٤) تسلسل الاتجاه المؤكَّد (`strat/*.json`): انقلاباتٌ تعود خلال أقلّ من
        ثلاث شمعات — تُعدّ وتُعلن (INFO: التاريخ يشمل ما قبل DIR_HOLD).
   الملفّات المؤرشفة تُكتب مرّةً ولا تُلمس، فتُقرأ من مكانها بلا قفل؛ وملفّات
   الرموز من لقطةٍ تحت القفل. المخرَج reports/replay-report.json.

     node scripts/replay-audit.mjs [--cuts=20] [--dir=PATH]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT, LIVE_DATA, takeSnapshot, dropSnapshot } from "./lib/snapshot.mjs";
import * as C from "../tests/reference/compare.mjs";
import * as R from "../tests/reference/engine.mjs";
import { closedRef } from "../tests/reference/math.mjs";

const require = createRequire(import.meta.url);
const IND = require("../stocks/indicators.js");
const SC = require("../stocks/score.js");
const DIR = require("../stocks/direction.js");
const P = require("../stocks/plan.js");

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(k + "=")); return a ? a.slice(k.length + 1) : d; };
const CUTS = Number(opt("--cuts", "20"));
const ARCH = path.resolve(opt("--archive", LIVE_DATA));
const rj = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const report = { at: new Date().toISOString(), sections: {}, violations: [] };
const bad = (sec, sev, what) => report.violations.push({ sec, sev, what });

/* ١) خطّ الزمن المنشور */
{
  const f = path.join(ARCH, "crypto/.monitor/live.jsonl");
  const lines = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const seen = { c: new Map(), s: new Map() }, last = { c: 0, s: 0 };
  let n = 0;
  for (const x of lines.sort((a, b) => a.t - b.t)) {
    for (const b of ["c", "s"]) {
      const v = x[b]; if (!v || !Number.isFinite(v.k)) continue;
      n++;
      if (v.k < last[b]) bad("timeline", "CRITICAL", `${b === "c" ? "crypto" : "stocks"}: المفتاح نزل ${last[b]} → ${v.k} عند ${new Date(x.t).toISOString()}`);
      last[b] = Math.max(last[b], v.k);
      const h = seen[b].get(v.k);
      if (h && h !== v.h) bad("timeline", "WARNING", `${b === "c" ? "crypto" : "stocks"}: مفتاحٌ واحد ${v.k} ببصمتين ${h}/${v.h} (مسموحٌ فقط بتغيّر النسخة)`);
      seen[b].set(v.k, v.h);
    }
  }
  report.sections.timeline = { records: lines.length, observations: n, cryptoKeys: seen.c.size, stockKeys: seen.s.size,
    from: lines.length ? new Date(Math.min(...lines.map((x) => x.t))).toISOString() : null,
    to: lines.length ? new Date(Math.max(...lines.map((x) => x.t))).toISOString() : null };
}

/* ٢) اللقطات المؤرشفة */
function snapInvariants(doc, book, label) {
  const grid = book === "stocks" ? 900 : 300;
  const k = doc.candleKey ?? doc.k;
  if (Number.isFinite(k) && k % grid !== 0) bad("snaps", "CRITICAL", `${label}: المفتاح خارج شبكة ${grid}ث`);
  const side = {};
  for (const [scan, rows] of Object.entries(doc.scans || {})) for (const r of rows || []) {
    if (book === "stocks" && (r.mkt === "crypto" || /-USD$/.test(r.s))) bad("snaps", "CRITICAL", `${label}: عملة ${r.s} في دفتر الأسهم`);
    if (book === "crypto" && r.mkt && r.mkt !== "crypto") bad("snaps", "CRITICAL", `${label}: ${r.s} ليس كريبتو`);
    const t = r.t || [];
    if (r.sd === 1 && !(t.every((x) => x > r.e) && r.e > r.st)) bad("snaps", "CRITICAL", `${label}: ${r.s}/${scan} خطة صعود معكوسة`);
    if (r.sd === -1 && !(t.every((x) => x < r.e) && r.e < r.st)) bad("snaps", "CRITICAL", `${label}: ${r.s}/${scan} خطة هبوط معكوسة`);
    if (book === "stocks" && scan !== "best") (side[r.s] = side[r.s] || new Set()).add(r.sd);
  }
  for (const [s, v] of Object.entries(side)) if (v.size > 1) bad("snaps", "CRITICAL", `${label}: ${s} بجهتين في لقطةٍ واحدة`);
}
{
  let nc = 0, ns = 0;
  const cdir = path.join(ARCH, "crypto/.monitor/snaps");
  if (fs.existsSync(cdir)) for (const f of fs.readdirSync(cdir).sort()) { const d = rj(path.join(cdir, f)); if (d) { snapInvariants(d, "crypto", "crypto@" + f); nc++; } }
  const mon = path.join(ARCH, ".monitor");
  if (fs.existsSync(mon)) for (const day of fs.readdirSync(mon).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d))) {
    const sd = path.join(mon, day, "snap");
    if (fs.existsSync(sd)) for (const f of fs.readdirSync(sd).sort()) { const d = rj(path.join(sd, f)); if (d) { snapInvariants(d, "stocks", "stocks@" + day + "/" + f); ns++; } }
  }
  report.sections.snaps = { crypto: nc, stocks: ns };
}

/* ٣) السفر في الزمن — الإنتاج مقابل المرجع عند نقاط قطعٍ ماضية */
{
  const src = opt("--dir", null) ? path.resolve(opt("--dir")) : await takeSnapshot({ job: "replay" });
  let cuts = 0, evals = 0, diffs = 0; const ex = [];
  try {
    const sum = rj(path.join(src, "summary.json"));
    for (const row of (sum && sum.rows) || []) {
      const rec = rj(path.join(src, "sym", row.s + ".json")); if (!rec || !rec.tf || !rec.tf["15m"]) continue;
      const k15 = rec.tf["15m"].c;
      /* نقاط القطع: نهايات آخر CUTS شمعة ‎15د‎ — كلُّ واحدةٍ لحظةٌ وقعت فعلاً */
      for (let i = 1; i <= CUTS && i < k15.length - 60; i++) {
        const clock = (k15[k15.length - 1 - i][0] + 900) * 1000 + 1;
        cuts++;
        const byP = {}, byR = {};
        for (const tf of ["15m", "1h", "4h", "1d"]) {
          const raw = rec.tf[tf] && rec.tf[tf].c; if (!raw) continue;
          const kp = IND.closedBars(raw, tf, clock).slice(-IND.AN_WIN), kr = closedRef(raw, tf, clock).slice(-R.REF.AN_WIN);
          const a = IND.analyze(P.unpackK(kp)), b = R.analyzeRef(R.unpack(kr));
          evals++;
          if (!a || !b) { if (!!a !== !!b) { diffs++; ex.length < 6 && ex.push(`${row.s}.${tf}@${clock}: analyze`); } continue; }
          byP[tf] = a; byR[tf] = b;
          for (const f of C.AN_FIELDS) if (!C.fieldNear(f, a[f], b[f])) { diffs++; if (ex.length < 6) ex.push(`${row.s}.${tf}@${new Date(clock).toISOString()}: ${f} ${a[f]}≠${b[f]}`); break; }
        }
        const oP = SC.overallScore(byP), oR = R.overallRef(byR);
        if (!C.near(oP, oR)) { diffs++; if (ex.length < 6) ex.push(`${row.s}@${clock}: overall ${oP}≠${oR}`); }
        const tfs = Object.fromEntries(Object.entries(byP).map(([t, a]) => [t, +a.score.toFixed(1)]));
        const tfr = Object.fromEntries(Object.entries(byR).map(([t, a]) => [t, +a.score.toFixed(1)]));
        if (DIR.allTfDir(tfs) !== R.tfUnanimousRef(tfr)) { diffs++; if (ex.length < 6) ex.push(`${row.s}@${clock}: allTfDir`); }
      }
    }
  } finally { if (!opt("--dir", null)) dropSnapshot(src); }
  report.sections.timeTravel = { cutsPerSymbol: CUTS, cuts, analyses: evals, diffs, examples: ex };
  if (diffs) bad("timeTravel", "CRITICAL", `${diffs} فرقاً بين الإنتاج والمرجع عبر الزمن — ${ex.join(" · ")}`);
}

/* ٤) تسلسل الاتجاه المؤكَّد — انقلاباتٌ تعود سريعاً (INFO) */
{
  const sd = path.join(ARCH, "strat");
  let flips = 0, quick = 0, series = 0;
  if (fs.existsSync(sd)) for (const f of fs.readdirSync(sd)) {
    const tl = (rj(path.join(sd, f)) || {}).tl || [];
    const by = {};
    for (const [t, st, d] of tl) (by[st] = by[st] || []).push([t, d]);
    for (const arr of Object.values(by)) {
      series++;
      for (let i = 2; i < arr.length; i++) {
        if (arr[i - 1][1] !== arr[i - 2][1] && arr[i - 1][1] && arr[i - 2][1]) {
          flips++;
          if (arr[i][1] === arr[i - 2][1] && arr[i][0] - arr[i - 1][0] < 45 * 60) quick++;
        }
      }
    }
  }
  report.sections.directionSeries = { series, flips, quickReversals: quick,
    note: "INFO — التسلسل يشمل ما قبل DIR_HOLD؛ الحتمية داخل الشمعة تُفحص في الطبيب" };
}

const crit = report.violations.filter((v) => v.sev === "CRITICAL");
report.status = crit.length ? "FAIL" : "PASS";
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", "replay-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.sections, null, 1));
for (const v of report.violations.slice(0, 20)) console.log(`${v.sev === "CRITICAL" ? "✗" : "⚠"} [${v.sec}] ${v.what}`);
console.log(`\n${report.status} — ${report.violations.length} ملاحظة · ${crit.length} حرج`);
process.exit(crit.length ? 1 : 0);
