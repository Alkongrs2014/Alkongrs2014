/* =====================================================================
   أثرُ التدقيق للتوصية — ما يكفي لإعادة إنتاجها لاحقاً.

   حين يشتكي مستخدمٌ من توصية، السؤال: أهي علّةُ محرّك (A)، أم علّةُ
   بيانات (B)، أم علّةُ عرض (C)، أم حُسبت صحيحةً وخالفها السوق (D)؟ ولا
   جوابَ بلا مدخلاتها كما كانت **لحظة إصدارها**. فعند إنشاء السجلّ:
     · يُختَم بـ`aud`: المفتاح، ونسخة المحرّك، والالتزام، وبصمةُ المدخلات.
     · وتُحفظ الشمعاتُ المغلقة نفسها في `data/audit/<يوم>/<رمز>-<مفتاح>.json`
       (مرّةً لكل رمزٍ ومفتاح، ومستبعدةٌ من النشر).
   `node scripts/audit-rec.mjs <رمز> <شرط>` يعيد الحساب ويصنّف.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { ROOT } from "./snapshot.mjs";

const require = createRequire(import.meta.url);
const IND = require("../../stocks/indicators.js");
const sha12 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);

/* نسخةُ المحرّك = بصمةُ كلّ ما يحسب التوصية (المنطق وخطّ المعالجة) */
const ENGINE_FILES = [["stocks", "scans.js"], ["stocks", "confluence.js"], ["stocks", "direction.js"], ["stocks", "consensus.js"],
  ["stocks", "strategies.js"], ["stocks", "score.js"], ["stocks", "opportunities.js"], ["stocks", "plan.js"], ["stocks", "indicators.js"],
  ["stocks", "evaluate.js"], ["scripts", "track-signals.mjs"], ["scripts", "track-strategies.mjs"], ["scripts", "fetch-market.mjs"]];
let ENGINE = null, COMMIT = undefined;
export function engineVersion() {
  if (!ENGINE) ENGINE = sha12(ENGINE_FILES.map(([d, f]) => {
    try { return f + ":" + sha12(fs.readFileSync(path.join(ROOT, d, f), "utf8").replace(/\r\n/g, "\n")); } catch { return f + ":-"; }
  }).join("|"));
  return ENGINE;
}
export function commitId() {
  if (COMMIT === undefined) { try { COMMIT = execFileSync("git", ["rev-parse", "--short=10", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { COMMIT = null; } }
  return COMMIT;
}

/* الشمعات المغلقة عند ساعة المفتاح — نفس تعريف المحرّك */
export function closedInputs(symRec, ck, barSec = 900) {
  const clock = (ck + barSec) * 1000 + 1, out = {};
  for (const [tf, box] of Object.entries((symRec && symRec.tf) || {})) {
    const c = box && box.c; if (!c || !c.length) continue;
    out[tf] = IND.closedBars(c, tf, clock).slice(-IND.AN_WIN);
  }
  return out;
}
export const inputHash = (inputs) => sha12(JSON.stringify(Object.keys(inputs).sort().map((k) => [k, inputs[k]])));

/* يُنادى عند إنشاء سجلّ. يعيد الختم ويحفظ المدخلات (مرّةً لكل رمزٍ ومفتاح). */
export function auditStamp({ sym, symRec, row, ck, barSec = 900, outDir }) {
  if (!Number.isFinite(ck) || !symRec) return null;
  const inputs = closedInputs(symRec, ck, barSec);
  const ih = inputHash(inputs);
  try {
    const day = new Date(ck * 1000).toISOString().slice(0, 10);
    const dir = path.join(outDir, "audit", day);
    const f = path.join(dir, `${sym.replace(/[^\w.-]/g, "_")}-${ck}.json`);
    if (!fs.existsSync(f)) {
      fs.mkdirSync(dir, { recursive: true });
      const keep = ["s", "p", "pc", "cbar", "score", "band", "tfScore", "atr", "w52h", "w52l", "mkt", "sec"];
      fs.writeFileSync(f, JSON.stringify({ sym, ck, barSec, ih, ev: engineVersion(), cm: commitId(),
        row: Object.fromEntries(keep.filter((k) => row && row[k] !== undefined).map((k) => [k, row[k]])), inputs }));
    }
  } catch { /* الأرشيف لا يُسقط التتبّع */ }
  return { ck, ev: engineVersion(), cm: commitId(), ih };
}
