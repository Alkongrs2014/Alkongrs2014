/* =====================================================================
   التقاط الإخفاقات تلقائياً — لا يضيع فشلٌ جديد.

   كلُّ فشلٍ حرج يُحفظ في `reports/failures/<زمن>-<معرّف>/` بما يكفي لإعادة
   إنتاجه: الثابت المخروق والتفصيل والإصدار والالتزام، ونسخةٌ من المدخلات
   الصغيرة (الملخّص واللقطة والاستراتيجيات)، وملفّ الرمز المذكور إن وُجد.
   `npm run capture:promote -- <المجلّد>` يحوّله مثبِّتَ انحدارٍ دائماً.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./snapshot.mjs";

const DIR = path.join(ROOT, "reports", "failures");
const KEEP = 60;

const commit = () => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return null; } };

export function captureFailure({ source, check, dataDir = null, extra = null }) {
  try {
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${String(check.id).replace(/[^\w.-]/g, "_")}`.slice(0, 120);
    const out = path.join(DIR, id);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "failure.json"), JSON.stringify({
      source, at: new Date().toISOString(), commit: commit(), check, extra }, null, 2));
    if (dataDir && fs.existsSync(dataDir)) {
      for (const f of ["summary.json", "trades.json", "meta.json", "market-dir.json", "crypto/summary.json"]) {
        const p = path.join(dataDir, f);
        if (fs.existsSync(p)) { fs.mkdirSync(path.dirname(path.join(out, "data", f)), { recursive: true }); fs.copyFileSync(p, path.join(out, "data", f)); }
      }
      /* الرموز المذكورة في التفصيل — ملفّاتُها هي المدخل الحقيقيّ */
      const syms = new Set(String(check.detail || "").match(/[A-Z][A-Z0-9.\-]{0,12}(?=[:|/ .])/g) || []);
      for (const s of [...syms].slice(0, 6)) for (const sub of ["sym", "crypto/sym"]) {
        const p = path.join(dataDir, sub, s + ".json");
        if (fs.existsSync(p)) { fs.mkdirSync(path.join(out, "data", sub), { recursive: true }); fs.copyFileSync(p, path.join(out, "data", sub, s + ".json")); }
      }
    }
    /* سقفٌ للمجلّد: تشخيصٌ لا أرشيف */
    const all = fs.readdirSync(DIR).sort();
    for (const d of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(DIR, d), { recursive: true, force: true });
    return out;
  } catch { return null; }                                  // الالتقاط لا يُسقط الفاحص
}
