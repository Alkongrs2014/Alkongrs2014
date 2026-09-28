#!/usr/bin/env node
/* =====================================================================
   مثبّتات الاختبار — لقطةٌ مجمَّدة من بيانات الإنتاج تُلتزم في المستودع.

   CI لا يملك `data/` (محلّيٌّ بقرار)، فبلا مثبّتاتٍ لا يستطيع اختبارُ
   الواجهة ولا اختبارُ النشر أن يعمل هناك. واللقطة **ثابتة**: تُعاد
   صناعتُها بأمرٍ صريح لا في كل تشغيل، وإلا صار «فشل اختبار» يعني «تغيّر
   السوق» لا «انكسرت الشيفرة».

   المستبعد: ما لا تقرؤه الواجهة ولا الفحوص (سجلّات، أرشيف، ذاكرة ترجمة،
   تسلسلٌ تاريخي ضخم)، وملفّات شمعات الكريبتو عدا ستّة من المعروض.

     node scripts/make-fixtures.mjs
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { ROOT, takeSnapshot, dropSnapshot } from "./lib/snapshot.mjs";

const OUT = path.join(ROOT, "tests", "fixtures", "data");
const DROP = new Set(["i18n.json", "cik.json", "strat-history.json", "strat-signals.json", "ivhist.json",
  "opportunities-log.json", ".run.skips.json"]);
const CRYPTO_SYMS = 6;

const snap = await takeSnapshot({ job: "fixtures" });
try {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(snap, OUT, { recursive: true, filter: (src) => !DROP.has(path.basename(src)) });
  const cdir = path.join(OUT, "crypto");
  if (fs.existsSync(cdir)) {
    for (const n of ["strat-history.json", "strat-signals.json", "opportunities-log.json", "strat", "logs"]) fs.rmSync(path.join(cdir, n), { recursive: true, force: true });
    const opp = JSON.parse(fs.readFileSync(path.join(cdir, "opportunities.json"), "utf8"));
    const keep = new Set(Object.keys(opp.bySym || {}).slice(0, CRYPTO_SYMS));
    const sym = path.join(cdir, "sym");
    for (const f of fs.readdirSync(sym)) if (!keep.has(path.basename(f, ".json"))) fs.rmSync(path.join(sym, f));
  }
  let bytes = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } };
  walk(OUT);
  fs.writeFileSync(path.join(OUT, "FIXTURE.json"), JSON.stringify({ madeAt: new Date().toISOString(), bytes }, null, 1));
  console.log(`✔ مثبّتات في tests/fixtures/data · ${(bytes / 1048576).toFixed(1)} م.ب`);
} finally { dropSnapshot(snap); }
