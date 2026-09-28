/* REG-SCRIPT-SYNTAX: كلُّ سكربتٍ في scripts/ وlocal/ وtests/ يُحلَّل (node --check).
   إدراجٌ آليّ حوّل «\n» داخل نصٍّ إلى سطرٍ حقيقي فكسر fortress.mjs وأُلتزم —
   وCI لا يشغّل الحصن فلم يُكشف. هذا الفحص رخيصٌ ويغطّي كلَّ ملفّ. */
import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (["node_modules", "fixtures", ".stryker-tmp"].includes(e.name) ? [] : walk(path.join(d, e.name)))
  : /\.(mjs|js)$/.test(e.name) ? [path.join(d, e.name)] : []);

it("كلُّ ملفّ JS/MJS يُحلَّل بلا خطأ نحوي", () => {
  const bad = [];
  for (const f of [...walk("scripts"), ...walk("local"), ...walk("tests"), ...walk("stocks"), "vitest.config.mjs", "playwright.config.mjs", "stryker.conf.mjs"]) {
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    if (r.status !== 0) bad.push(f + ": " + (r.stderr || "").split("\n").find((l) => /Error/.test(l)));
  }
  expect(bad).toEqual([]);
}, 120000);
