#!/usr/bin/env node
/* تحويل صفحة HTML عربية إلى PDF بمتصفّح المشروع (Chromium يشكّل العربية صحيحاً).
   node scripts/audit/render-pdf.mjs IN.html OUT.pdf */
import "../lib/pw-browsers.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const [inp, out] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(pathToFileURL(path.resolve(inp)).href, { waitUntil: "networkidle" });
await p.evaluate(() => document.fonts.ready);
await p.pdf({ path: out, format: "A4", printBackground: true, displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#8a9bb0"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  margin: { top: "14mm", bottom: "16mm", left: "13mm", right: "13mm" } });
await b.close();
console.log("✓ " + out);
