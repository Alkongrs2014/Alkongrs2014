/* =====================================================================
   نواة الطبيب — فحوص الثوابت على مجلّد بياناتٍ ثابت (لقطة).

   كلُّ فحصٍ يعيد `{ id, inv, sev, ok, detail }` ويستشهد بثابتٍ من
   `docs/INVARIANTS.md`. والمجلّد الممرَّر **لقطةٌ** دائماً (تحت قفل الكاتب،
   أو التزامٌ منشور، أو مثبّتات) — لا `data/` الحيّ (INV-17).

   بلا شبكة وبلا أيّ نموذج لغوي: رياضياتٌ ومقارنات فقط.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { validateBook } from "./validate-schemas.mjs";
import * as C from "../../tests/reference/compare.mjs";
import * as R from "../../tests/reference/engine.mjs";

const require = createRequire(import.meta.url);
const DIR = require("../../stocks/direction.js");
const SESS = require("../../stocks/session.js");

const rd = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } };
const T = (id, inv, sev, ok, detail = "") => ({ id, inv, sev, ok: !!ok, detail });

/* ---------------------------------------------------------------------
   فحوصٌ بنيوية سريعة — تصلح بوّابةَ نشر (ثوانٍ)
   --------------------------------------------------------------------- */
export function structuralChecks(dir) {
  const out = [];
  const sum = rd(dir, "summary.json"), opp = rd(dir, "opportunities.json");
  const strat = rd(dir, "strategies.json"), md = rd(dir, "market-dir.json");
  const csum = rd(dir, "crypto/summary.json"), copp = rd(dir, "crypto/opportunities.json");

  /* INV-19 · INV-01..03 (المخطّطات تغلق مفاتيح الفريمات) */
  const sErr = validateBook(dir, "stocks");
  out.push(T("schema.stocks", "INV-19", "CRITICAL", !sErr.length,
    sErr.slice(0, 4).map((e) => e.file + ": " + e.errors[0]).join(" · ")));
  if (fs.existsSync(path.join(dir, "crypto"))) {
    const cErr = validateBook(path.join(dir, "crypto"), "crypto", { symLimit: 0, optional: ["ma200-open.json"] });
    out.push(T("schema.crypto", "INV-19", "CRITICAL", !cErr.length,
      cErr.slice(0, 4).map((e) => e.file + ": " + e.errors[0]).join(" · ")));
  }

  /* INV-01: لا فريم ممنوع في سياق فرص الأسهم (مفاتيحُ ما يدخل الحساب فعلاً) */
  if (sum) {
    const bad = [];
    for (const r of sum.rows) {
      const rec = rd(dir, `sym/${r.s}.json`); if (!rec) continue;
      for (const box of ["tf", "an"]) for (const k of Object.keys(rec[box] || {}))
        if (!["15m", "1h", "4h", "1d"].includes(k)) bad.push(`${r.s}.${box}.${k}`);
      for (const k of Object.keys(r.tfScore || {})) if (!["15m", "1h", "4h", "1d"].includes(k)) bad.push(`${r.s}.tfScore.${k}`);
    }
    out.push(T("frames.stocks", "INV-01", "CRITICAL", !bad.length, bad.slice(0, 6).join(", ")));
  }
  if (md) out.push(T("frames.trend", "INV-02", "CRITICAL",
    JSON.stringify([...md.tfs].sort()) === JSON.stringify(["1d", "1h", "4h"]), "tfs=" + JSON.stringify(md.tfs)));

  /* INV-04 · INV-05: الشمعات سليمة ومرتّبة ولا فريم مكرّر */
  if (sum) {
    const bad = [];
    for (const r of sum.rows) {
      const rec = rd(dir, `sym/${r.s}.json`); if (!rec) continue;
      for (const [tf, box] of Object.entries(rec.tf || {})) {
        const c = box.c || [];
        for (let i = 0; i < c.length; i++) {
          const [t, o, h, l, cl] = c[i];
          if (i && !(t > c[i - 1][0])) { bad.push(`${r.s}.${tf}@${i} ختمٌ غير تصاعدي`); break; }
          if (!(h >= Math.max(o, cl) - 1e-9 && Math.min(o, cl) >= l - 1e-9 && l > 0)) { bad.push(`${r.s}.${tf}@${i} OHLC`); break; }
        }
      }
    }
    out.push(T("candles.stocks", "INV-04/05", "CRITICAL", !bad.length, bad.slice(0, 6).join(", ")));
  }

  /* INV-40 · INV-41: الفصل بين الدفترين */
  if (sum) {
    const alien = sum.rows.filter((r) => r.mkt === "crypto" || /-USD$/.test(r.s)).map((r) => r.s);
    const oppAlien = opp ? Object.values(opp.scans || {}).flat().filter((r) => r.mkt === "crypto").map((r) => r.s) : [];
    out.push(T("books.stocks-clean", "INV-40", "CRITICAL", !alien.length && !oppAlien.length, [...alien, ...oppAlien].join(", ")));
  }
  if (csum) {
    const alien = csum.rows.filter((r) => r.mkt !== "crypto").map((r) => r.s);
    out.push(T("books.crypto-clean", "INV-40", "CRITICAL", !alien.length, alien.join(", ")));
  }
  if (opp) out.push(T("grid.stocks", "INV-41", "CRITICAL", opp.candleKey % 900 === 0, "candleKey=" + opp.candleKey));
  if (copp) out.push(T("grid.crypto", "INV-41", "CRITICAL", copp.candleKey % 300 === 0, "candleKey=" + copp.candleKey));

  /* INV-04: لا رمزٌ مكرّر في أيّ ملخّص (كشفه التعذيب) */
  for (const [book, s] of [["stocks", sum], ["crypto", csum]]) {
    if (!s) continue;
    const seen = new Set(), dup = new Set();
    for (const r of s.rows) { if (seen.has(r.s)) dup.add(r.s); seen.add(r.s); }
    out.push(T("unique." + book, "INV-04", "CRITICAL", !dup.size, [...dup].join(", ")));
  }

  /* INV-11: عمق الفريمات */
  if (sum) {
    const four = sum.rows.filter((r) => Object.keys(r.tfScore || {}).length === 4).length;
    out.push(T("depth.stocks", "INV-11", "CRITICAL", four >= sum.rows.length * 0.9, `${four}/${sum.rows.length}`));
  }

  /* INV-35 · INV-36: اتجاه الفرصة وخطّتها */
  for (const [book, o] of [["stocks", opp], ["crypto", copp]]) {
    if (!o) continue;
    const bad = [];
    const sideBy = {};
    for (const [scan, rows] of Object.entries(o.scans || {})) for (const r of rows) {
      const sd = r.sd, t = r.t || [];
      if (sd === 1 && !(t.every((x) => x > r.e) && r.e > r.st)) bad.push(`${r.s}/${scan} خطة صعود معكوسة`);
      if (sd === -1 && !(t.every((x) => x < r.e) && r.e < r.st)) bad.push(`${r.s}/${scan} خطة هبوط معكوسة`);
      const tf = o.bySym && o.bySym[r.s] && o.bySym[r.s].tf;
      if (book === "stocks" && tf) { const u = DIR.allTfDir(tf); if (u !== 0 && u !== sd) bad.push(`${r.s}/${scan} يعاكس إجماع الفريمات`); }
      if (book === "stocks") { (sideBy[r.s] = sideBy[r.s] || new Set()).add(sd); }
    }
    for (const [s, set] of Object.entries(sideBy)) if (set.size > 1) bad.push(`${s} بجهتين في نفس اللقطة`);
    out.push(T("direction." + book, "INV-35/36", "CRITICAL", !bad.length, bad.slice(0, 6).join(" · ")));
  }

  /* اتّساق الاستراتيجيات المنشورة: التفعيل = sc ≥ 55، والنتيجة في مداها */
  for (const [book, s] of [["stocks", strat], ["crypto", rd(dir, "crypto/strategies.json")]]) {
    if (!s) continue;
    const bad = (s.rows || []).filter((r) => r.act !== (r.sc >= 55) || !(r.sc >= 0 && r.sc <= 100)).map((r) => r.s + "|" + r.st);
    out.push(T("strategies.consistency." + book, "INV-31", "CRITICAL", !bad.length, bad.slice(0, 6).join(", ")));
  }

  /* bySym في اللقطة يطابق strategies.json حين يصفان الشمعة نفسها */
  for (const [book, o, s] of [["stocks", opp, strat], ["crypto", copp, rd(dir, "crypto/strategies.json")]]) {
    if (!o || !s || o.candleKey !== s.confBar) continue;
    const idx = new Map((s.rows || []).map((r) => [r.s + "|" + r.st, r]));
    const bad = [];
    for (const [sym, b] of Object.entries(o.bySym || {})) for (const x of b.rows || []) {
      const r = idx.get(sym + "|" + x.st);
      if (!r || r.dir !== x.dir || r.sc !== x.sc || !!r.act !== !!x.act) bad.push(sym + "|" + x.st);
    }
    out.push(T("snapshot.vs-strategies." + book, "INV-20", "CRITICAL", !bad.length, bad.slice(0, 6).join(", ")));
  }
  return out;
}

/* ---------------------------------------------------------------------
   المقارنة بالمرجع المستقلّ — `sample` يحدّ عدد الرموز في الفحص السريع
   --------------------------------------------------------------------- */
export function referenceChecks(dir, { sample = Infinity } = {}) {
  const out = [];
  const sum = rd(dir, "summary.json");
  if (sum) {
    let nA = 0, nP = 0; const exA = [], exP = [];
    for (const row of sum.rows.slice(0, sample)) {
      const rec = rd(dir, `sym/${row.s}.json`); if (!rec) continue;
      const clock = C.rowClock(rec, row, sum.updated);
      const a = C.compareAnalysis(rec, clock); nA += a.length; if (a.length && exA.length < 4) exA.push(row.s + ":" + a[0].tf + "." + a[0].field);
      const p = C.comparePublishedScore(rec, row, sum.updated); nP += p.length; if (p.length && exP.length < 4) exP.push(row.s + ":" + p[0].field + " " + p[0].published + "≠" + p[0].ref);
    }
    out.push(T("reference.analysis", "INV-30", "CRITICAL", !nA, nA ? `${nA} فرقاً — ${exA.join(" · ")}` : ""));
    out.push(T("reference.published-score", "INV-33", "CRITICAL", !nP, nP ? `${nP} فرقاً — ${exP.join(" · ")}` : ""));
  }
  for (const [book, sub, bar] of [["stocks", "", 900], ["crypto", "crypto/", 300]]) {
    const s = rd(dir, sub + "summary.json"); if (!s) continue;
    const edgeFile = book === "stocks" ? rd(dir, "strategy-edge.json") : null;
    const edge = {}; for (const r of (edgeFile && edgeFile.rows) || []) edge[r.id] = r;
    let cbarMax = 0; for (const r of s.rows) if (Number.isFinite(r.cbar)) cbarMax = Math.max(cbarMax, r.cbar);
    if (!cbarMax) continue;
    const cnow = (cbarMax + bar) * 1000 + 1;
    const st = rd(dir, sub + "strategies.json") || {};
    let n = 0, diffs = 0; const ex = [];
    for (const row of s.rows.slice(0, sample)) {
      const rec = rd(dir, `${sub}sym/${row.s}.json`); if (!rec) continue;
      const mkt = rec.mkt || row.mkt || null;
      const r = C.compareStrategies({ rec, row, now: st.updated || s.updated, cnow,
        sess: SESS.sessionOf(cnow, mkt), win: SESS.currentWindow(cnow, mkt),
        sessOf: (t) => SESS.sessionOf(t, mkt), holdBy: {}, edge });
      n += r.prod.length; diffs += r.diffs.length;
      if (r.diffs.length && ex.length < 4) ex.push(row.s + ":" + r.diffs[0].id + "." + r.diffs[0].field);
    }
    out.push(T("reference.strategies." + book, "INV-31/32", "CRITICAL", !diffs,
      diffs ? `${diffs} فرقاً في ${n} تقييماً — ${ex.join(" · ")}` : `${n} تقييماً متطابقاً`));
  }
  return out;
}

/* الطبيب السريع لبوّابة النشر — يعيد قائمة أخطاء (فارغةً إن مرّ). */
export async function quickDoctor(dir) {
  const res = [...structuralChecks(dir), ...referenceChecks(dir)];
  return res.filter((r) => !r.ok && r.sev === "CRITICAL").map((r) => `${r.inv} ${r.id}: ${r.detail}`);
}

export { R };
