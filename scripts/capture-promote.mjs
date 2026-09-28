#!/usr/bin/env node
/* =====================================================================
   ترقيةُ إخفاقٍ ملتقَط إلى مثبِّت انحدارٍ دائم.
     node scripts/capture-promote.mjs reports/failures/<المجلّد> [اسمٌ قصير]
   يُنسخ المجلّد إلى tests/regression/fixtures/captured/<الاسم>/ ويُضاف إلى
   الفهرس. واختبارُ `captured.test.mjs` يمرّر كلَّ مثبِّتٍ على الطبيب — فالعلّة
   التي أُصلحت يجب أن تمرّ، والتي لم تُصلح تبقى حمراء حتى تُصلح.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/snapshot.mjs";

const [src, name] = process.argv.slice(2);
if (!src || !fs.existsSync(path.join(src, "failure.json"))) { console.log("الاستعمال: capture-promote <مجلّد إخفاق> [اسم]"); process.exit(2); }
const f = JSON.parse(fs.readFileSync(path.join(src, "failure.json"), "utf8"));
const id = (name || f.check.id).replace(/[^\w.-]/g, "_");
const dst = path.join(ROOT, "tests", "regression", "fixtures", "captured", id);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.cpSync(src, dst, { recursive: true });
const idx = path.join(path.dirname(dst), "index.json");
const all = fs.existsSync(idx) ? JSON.parse(fs.readFileSync(idx, "utf8")) : [];
all.push({ id, inv: f.check.inv, check: f.check.id, detail: f.check.detail, at: f.at, commit: f.commit });
fs.writeFileSync(idx, JSON.stringify(all, null, 1));
console.log(`✔ ${id} صار مثبِّت انحدار — ${path.relative(ROOT, dst)}`);
