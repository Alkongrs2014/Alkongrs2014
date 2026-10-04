#!/usr/bin/env node
/* =====================================================================
   فرص المؤشرات وصناديقها — المحرّك V3 نفسه على SPY وQQQ (طلب المالك 2026-10-05).

   **ليس محرّكاً ثانياً ولا تعديلاً للأول**: نفس `build()` من build-trades.mjs بنفس
   الاستراتيجيات والأوزان ودورة الحياة (§4ج) ولقطات الأسهم (كل 15 دقيقة 05:15…19:45
   نيويورك)، على شموع مخزن SIP نفسه (الصندوقان فيه أصلاً بدائلَ للمؤشرات). الفرق
   وحده المدخل والملفّ: `idx-trades.json` منفصلٌ عن `trades.json` كي يبقى كون الأسهم
   الخمسين كما هو بلا حذفٍ ولا إضافة، ولا تتغيّر بصمة المحرّك ولا لقطة الأسهم.

   SPX وXSP وNDX لا تدخل هنا: Alpaca لا يعطي أسعار المؤشرات ولا شموعها (مقيس
   2026-10-05: `/v1beta1/indices` ⇒ 403، ولقطة الأسهم لـSPX ⇒ فارغة)، ولا يُستعمل
   سعر SPY بديلاً عن SPX ولا QQQ بديلاً عن NDX. تُعرض في الواجهة بحالتها.

   الجلسة الليلية (BOATS) **لا تدخل الشموع**: المخزن SIP وحده (04:00–20:00)، فلا
   تتشوّه قمة/قاع أمس ولا VWAP ولا المتوسطات بشموعٍ ليلية رقيقة السيولة.

   node scripts/build-idx.mjs [--out DIR] [--now ISO] [--check]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readSeries, storeDir } from "./lib/bars-store.mjs";
import { prep, stockSlotAt } from "./lib/engine3-run.mjs";
import { build, engineVersion } from "./build-trades.mjs";
import { renameRetry } from "./lib/rename-retry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg("out", path.join(ROOT, "data")));
export const IDX_SYMS = ["SPY", "QQQ"];
const KEEP_DAYS = 150;          // نفس نافذة loadBook في build-trades
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
function writeAtomic(file, doc) {
  const tmp = path.join(path.dirname(file), "." + path.basename(file) + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify(doc));
  renameRetry(tmp, file);
}
/* البصمة: المحرّك نفسه + هذا الملفّ — تغيّرُ أيٍّ منهما يعيد بناء اللقطة */
export function idxVersion() {
  return crypto.createHash("sha256").update(engineVersion())
    .update(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);
}
/* «نفس الحركة»: صفقتان جديدتان بنفس الجهة في نفس اللقطة على صندوقين يتبعان السوق
   نفسه ليستا فرصتين مستقلّتين — تُوسَم الأضعف `same` بالأقوى (الأعلى درجةً ثم الرمز)
   وتبقى ظاهرة. عرضٌ لا قرار: لا تُحذف ولا تُغيَّر خطتها. */
export function markSameMove(list) {
  const by = {};
  for (const t of list) (by[`${t.h}|${t.d}`] ||= []).push(t);
  for (const g of Object.values(by)) {
    if (g.length < 2) continue;
    g.sort((a, b) => (b.score - a.score) || (a.s < b.s ? -1 : 1));
    for (const t of g.slice(1)) t.same = g[0].s;
  }
  return list;
}

export function buildIdx({ now = Date.now(), out = OUT, barsDir = storeDir(out), fresh = false } = {}) {
  const H = stockSlotAt(now);
  if (!H) return { ok: false, why: "لا حدّ لقطة" };
  const ver = idxVersion();
  const file = path.join(out, "idx-trades.json"), sfile = path.join(out, "idx-trades-state.json");
  const prev = fresh ? null : readJ(file);
  if (prev && prev.version === ver && prev.hour === Math.round(H / 1000))
    return { ok: true, same: true, doc: prev, why: "نفس اللقطة — ثابتة حتى الحدّ التالي" };
  if (prev && prev.version === ver && prev.hour * 1000 > H) return { ok: false, why: `لقطةٌ أقدم ${Math.round(H / 1000)} < ${prev.hour}` };
  const S = {}, from = now - KEEP_DAYS * 86400000;
  for (const s of IDX_SYMS) {
    const a = readSeries(barsDir, s, "15m"), b = readSeries(barsDir, s, "1d");
    if (!a || !b) continue;
    S[s] = prep(a.bars.filter((x) => x.t >= from), b.bars.filter((x) => x.t >= from - 400 * 86400000));
  }
  if (!Object.keys(S).length) return { ok: false, why: "لا شموع SIP لـSPY/QQQ" };
  const st0 = fresh ? null : readJ(sfile);
  const r = build({ now, out, book: "stocks", S, state: st0 });
  if (!r.ok) return r;
  const doc = { ...r.doc, book: "idx", version: ver, syms: IDX_SYMS, src: "Alpaca SIP (ما قبل الافتتاح حتى ما بعد الإغلاق) — بلا شموع BOATS الليلية" };
  markSameMove(doc.open); markSameMove(doc.active);
  doc.rowsHash = crypto.createHash("sha256").update(JSON.stringify({ open: doc.open, active: doc.active, bySym: doc.bySym })).digest("hex").slice(0, 12);
  return { ok: true, doc, state: { ...r.state, book: "idx", version: ver } };
}

function selfCheck() {
  const L = markSameMove([{ s: "SPY", h: 1, d: 1, score: 80 }, { s: "QQQ", h: 1, d: 1, score: 93 }, { s: "X", h: 1, d: -1, score: 50 }, { s: "Y", h: 2, d: 1, score: 50 }]);
  if (L[0].same !== "QQQ" || L[1].same || L[2].same || L[3].same) throw new Error("نفس الحركة: " + JSON.stringify(L));
  if (IDX_SYMS.includes("SPX") || IDX_SYMS.includes("NDX")) throw new Error("مؤشرٌ نقدي بلا شموع في الكون");
  console.log("✓ build-idx --check");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) { selfCheck(); process.exit(0); }
  const now = arg("now") ? Date.parse(arg("now")) : Date.now();
  const r = buildIdx({ now });
  if (!r.ok) { console.error("✗ build-idx: " + r.why); process.exit(1); }
  if (r.same) { console.log(`= idx-trades.json: ${r.why}`); process.exit(0); }
  writeAtomic(path.join(OUT, "idx-trades-state.json"), r.state);
  writeAtomic(path.join(OUT, "idx-trades.json"), r.doc);
  console.log(`✓ idx-trades.json · لقطة ${new Date(r.doc.hour * 1000).toISOString()} · جديدة ${r.doc.open.length} · قائمة ${r.doc.active.length} · منتهية ${r.doc.closed.length} · ${JSON.stringify(r.doc.stats)}`);
}
