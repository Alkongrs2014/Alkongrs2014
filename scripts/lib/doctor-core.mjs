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
const SESS = require("../../stocks/session.js");
const E3 = require("../../stocks/engine3.js");

const rd = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } };
const T = (id, inv, sev, ok, detail = "") => ({ id, inv, sev, ok: !!ok, detail });

/* ---------------------------------------------------------------------
   فحوصٌ بنيوية سريعة — تصلح بوّابةَ نشر (ثوانٍ)
   --------------------------------------------------------------------- */
export function structuralChecks(dir) {
  const out = [];
  /* الفرص من المحرّك V3 وحده (trades.json). لقطات المحرّك القديم
     (opportunities.json · strategies.json) أرشيفٌ لا يُفحص ولا يُنشر. */
  const sum = rd(dir, "summary.json"), tr0 = rd(dir, "trades.json"), md = rd(dir, "market-dir.json");
  const csum = rd(dir, "crypto/summary.json");

  /* INV-19 · INV-01..03 (المخطّطات تغلق مفاتيح الفريمات) */
  const sErr = validateBook(dir, "stocks");
  out.push(T("schema.stocks", "INV-19", "CRITICAL", !sErr.length,
    sErr.slice(0, 4).map((e) => e.file + ": " + e.errors[0]).join(" · ")));
  if (fs.existsSync(path.join(dir, "crypto"))) {
    const cErr = validateBook(path.join(dir, "crypto"), "crypto", { symLimit: 0 });
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
    const oppAlien = tr0 ? [...tr0.open, ...tr0.closed].filter((r) => /-USD$/.test(r.s)).map((r) => r.s) : [];
    out.push(T("books.stocks-clean", "INV-40", "CRITICAL", !alien.length && !oppAlien.length, [...alien, ...oppAlien].join(", ")));
  }
  if (csum) {
    const alien = csum.rows.filter((r) => r.mkt !== "crypto").map((r) => r.s);
    out.push(T("books.crypto-clean", "INV-40", "CRITICAL", !alien.length, alien.join(", ")));
  }
  if (tr0) out.push(T("grid.stocks", "INV-41", "CRITICAL", tr0.candleKey % 900 === 0, "candleKey=" + tr0.candleKey));

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

  /* INV-60..64 و68: لقطات V3 ودورة الحياة — الهندسة والدرجة والأساس والتفرّد والحمل */
  for (const [book, tr] of [["stocks", tr0], ["crypto", rd(dir, "crypto/trades.json")]]) {
    if (!tr) continue;
    const W = E3.E3.W, geo = [], score = [], base = [], seen = new Set(), dup = [];
    const act = tr.active || [];
    // المنتهية تُنشر مختصرةً بلا خطة (pubEnded) — فحصُ الهندسة والدرجة على الجديدة والقائمة
    for (const t of [...tr.open, ...act]) {
      const tg = (t.tg || []).map((x) => x.p);
      if (t.d === 1 && !(tg.every((x) => x > t.e) && t.e > t.st)) geo.push(`${t.id} شراء معكوس`);
      if (t.d === -1 && !(tg.every((x) => x < t.e) && t.e < t.st)) geo.push(`${t.id} بيع معكوس`);
      if (tg.length < 2) geo.push(`${t.id} أقلّ من هدفين`);
      let sum = 0;
      for (const k of Object.keys(W)) {
        const want = t.el && t.el[k] ? W[k] : 0;
        if (!t.pts || t.pts[k] !== want) score.push(`${t.id}.${k}`);
        sum += want;
      }
      if (Math.abs(Math.round(sum * 100) / 100 - t.score) > 1e-9 || t.score > 100) score.push(`${t.id} score=${t.score}≠${sum}`);
      if (t.base === "day" && !(t.evt && t.pts.day === 40)) base.push(`${t.id} أساس «أمس» بلا حدث`);
      if (t.base !== "day" && t.base !== "ma") base.push(`${t.id} أساس ${t.base}`);
    }
    // صفقةٌ واحدة لكل رمز بين الجديدة والقائمة — لا تتكرّر خلال دورة حياتها (§4ج)
    for (const t of [...tr.open, ...act]) { if (seen.has(t.s)) dup.push(t.s); seen.add(t.s); }
    out.push(T("trades.geometry." + book, "INV-60", "CRITICAL", !geo.length, geo.slice(0, 6).join(" · ")));
    out.push(T("trades.score." + book, "INV-61", "CRITICAL", !score.length, score.slice(0, 6).join(" · ")));
    out.push(T("trades.base." + book, "INV-62", "CRITICAL", !base.length, base.slice(0, 6).join(" · ")));
    out.push(T("trades.one-per-symbol." + book, "INV-63", "CRITICAL", !dup.length, dup.join(", ")));
    const order = tr.open.every((t, i) => !i || tr.open[i - 1].score >= t.score);
    out.push(T("trades.ranked." + book, "INV-64", "CRITICAL", order, "الترتيب ليس تنازلياً بالدرجة"));
    /* INV-68 (قرار 2026-10-03، بدل INV-65): الجديدة مولودةٌ في لقطتها، والقائمة وُلدت قبلها بحالةٍ
       مؤكَّدة أو نشطة، والمنتهية بسببٍ من قواعد §6 — لا حملٌ لجديدة ولا قائمةٌ بلا حالة */
    const life = [
      ...tr.open.filter((t) => t.h !== tr.hour || !String(t.id).endsWith("|" + tr.hour)).map((t) => `${t.id} جديدةٌ من لقطةٍ أخرى`),
      ...act.filter((t) => !(t.h < tr.hour) || !["confirmed", "active"].includes(t.status)).map((t) => `${t.id} قائمةٌ بحالة ${t.status}`),
      ...tr.closed.filter((t) => !t.end || !["stop", "be", "tgt", "exp", "gap"].includes(t.end.k)).map((t) => `${t.id} منتهيةٌ بلا سبب`)
    ];
    out.push(T("trades.lifecycle." + book, "INV-68", "CRITICAL", !life.length, life.slice(0, 6).join(" · ")));
    // INV-67: لا دخولٌ من شمعةٍ أقدم من شمعة اللقطة — لا فرصة بلا تداولٍ في آخر 15 دقيقة
    const oldEntry = tr.open.filter((t) => t.t !== tr.candleKey).map((t) => `${t.s}:${(tr.candleKey - t.t) / 60}د`);
    out.push(T("trades.fresh-entry." + book, "INV-67", "CRITICAL", !oldEntry.length, oldEntry.slice(0, 6).join(", ")));
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
  return out;
}

/* الطبيب السريع لبوّابة النشر — يعيد قائمة أخطاء (فارغةً إن مرّ). */
export async function quickDoctor(dir) {
  const res = [...structuralChecks(dir), ...referenceChecks(dir)];
  return res.filter((r) => !r.ok && r.sev === "CRITICAL").map((r) => `${r.inv} ${r.id}: ${r.detail}`);
}

export { R };
