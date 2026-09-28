#!/usr/bin/env node
/* الرجوع اليدويّ إلى آخر نسخة بيانات سليمة (data-lkg) — بإيجار. للعطب
   التقنيّ وحده، لا لتغيّر السوق. `node scripts/rollback-data.mjs "السبب"` */
import { rollbackData } from "./lib/publish.mjs";
import { ROOT } from "./lib/snapshot.mjs";
const r = await rollbackData({ root: ROOT, reason: process.argv.slice(2).join(" ") || "يدوي" });
console.log(r.ok ? `✔ رُجِع ${r.from?.slice(0, 10)} → ${r.to.slice(0, 10)}` : `✗ ${r.why}`);
process.exit(r.ok ? 0 : 1);
