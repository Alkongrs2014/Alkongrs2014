#!/usr/bin/env node
/* =====================================================================
   مولّد «الادّعاءات» — ما كان الموقع سيعلنه في كل لقطة (تدقيق V3، قراءةٌ فقط).

   لا أرشيف للّقطات المنشورة (فرع data يتيمٌ بالتزامٍ واحد)، فيُعاد بناء كل لقطة
   بنفس دالّة الإنتاج `build()` — من نسخة الشيفرة التي كانت حيّةً وقتها — على
   مخزن SIP الحالي، عند الحدّ + 3 دقائق (لحظة مهمّة Confirm).

   هذا المولّد **مصدر الادّعاءات لا دليلٌ على صحّتها**: الحكم في v3-verify.mjs
   المكتوب من المواصفة بلا استيرادٍ من الإنتاج.

   node scripts/audit/v3-claims.mjs --code=DIR --from=YYYY-MM-DD --to=YYYY-MM-DD
        [--after=ISO] [--before=ISO] --out=FILE
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const CODE = path.resolve(arg("code", ROOT));
const FROM = arg("from"), TO = arg("to");
const AFTER = arg("after") ? Date.parse(arg("after")) : -Infinity;
const BEFORE = arg("before") ? Date.parse(arg("before")) : Infinity;
const OUT = arg("out");
const STORE = path.join(ROOT, "data/bars/alpaca_sip");
if (!FROM || !TO || !OUT) { console.error("--from --to --out مطلوبة"); process.exit(2); }

const require = createRequire(path.join(CODE, "package.json"));
const SES = require(path.join(CODE, "stocks/session.js"));
const { build } = await import(pathToFileURL(path.join(CODE, "scripts/build-trades.mjs")).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "v3claims-"));

const docs = [];
for (let t = Date.parse(FROM + "T12:00:00Z"); t <= Date.parse(TO + "T12:00:00Z"); t += 86400000) {
  for (const H of SES.scanSlotsOf(t)) {
    if (H < AFTER || H >= BEFORE) continue;
    const r = build({ now: H + 180000, out: tmp, barsDir: STORE, book: "stocks", fresh: true });
    if (!r.ok) { docs.push({ hour: Math.round(H / 1000), err: r.why }); continue; }
    if (r.doc.hour !== Math.round(H / 1000)) continue;     // حدٌّ لا تبنيه هذه النسخة
    const d = r.doc;
    docs.push({ hour: d.hour, candleKey: d.candleKey, version: d.version, stats: d.stats,
                open: d.open, bySym: d.bySym });
  }
  process.stdout.write(".");
}
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ code: CODE, from: FROM, to: TO, docs }));
console.log(`\n✓ ${docs.length} لقطة · ${docs.reduce((a, d) => a + (d.open ? d.open.length : 0), 0)} فرصة ← ${OUT}`);
