/* الحتمية للمحرّك V3 (INV-20 · INV-24) — يُشغَّل ابناً من doctor.mjs.
   بناءان مستقلّان «من الصفر» بنفس الساعة ومن نفس مخزن SIP ⇒ نفس البصمة. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build-trades.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = process.argv[2];
const out = { checks: [] };
const add = (id, inv, ok, detail, sev) => out.checks.push({ id, inv, ok: !!ok, detail, ...(sev ? { sev } : {}) });
const bars = path.join(ROOT, "data", "bars", "alpaca_sip");
let tr = null;
try { tr = JSON.parse(fs.readFileSync(path.join(dir, "trades.json"), "utf8")); } catch { /* لا لقطة */ }
if (!fs.existsSync(bars) || !tr) {
  add("determinism.v3", "INV-20", true, "لا مخزن SIP أو لا trades.json — يُتخطّى", "INFO");
} else {
  const now = (tr.candleKey + 900) * 1000 + 60000;
  const a = build({ now, out: dir, barsDir: bars, fresh: true });
  const b = build({ now, out: dir, barsDir: bars, fresh: true });
  add("determinism.v3", "INV-20", a.ok && b.ok && a.doc.rowsHash === b.doc.rowsHash,
      a.ok ? `${a.doc.open.length} مفتوحة · ${a.doc.rowsHash}` : a.why);
  add("determinism.v3-key", "INV-24", a.ok && a.doc.candleKey === tr.candleKey,
      a.ok ? `${a.doc.candleKey} مقابل ${tr.candleKey}` : "");
}
console.log(JSON.stringify(out));
