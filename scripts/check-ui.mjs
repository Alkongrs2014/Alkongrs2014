#!/usr/bin/env node
/* =====================================================================
   فحص الواجهة — بلا شبكة وبلا متصفح.

   لماذا: خطأٌ نحوي واحد في `index.html` يُسقط **كل** الشيفرة، فتُعرض
   صفحةٌ ساكنة بلا أي رسالة في الشاشة. وقع ذلك فعلاً بعلامة اقتباس
   مفتوحة بمفردة ومغلقة بمزدوجة، وبتسلسل `\n` صار سطراً حقيقياً داخل
   تعبيرٍ نمطي. كلاهما يُكتشف في ثانية هنا، وفي دقائق بالمتصفح.

   ويفحص أيضاً ما لا يُخطئ فيه المحلّل النحوي: معرّفٌ يُنادى من الشيفرة
   ولا وجود له في الهيكل يعيد `null` بصمت، فتتوقّف بطاقةٌ عن الرسم بلا
   استثناء ظاهر.

     node scripts/check-ui.mjs
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "stocks");
const HTML = path.join(DIR, "index.html");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { const extra = fn(); console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); pass++; }
  catch (e) { console.log(`  ✗ ${name} — ${e.message}`); fail++; }
};

console.log("▶ فحص الواجهة (بلا شبكة)\n");
const html = fs.readFileSync(HTML, "utf8");

/* ---------- ١ الشيفرة المضمّنة تُحلَّل ---------- */
const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
t("الشيفرة المضمّنة في index.html تُحلَّل", () => {
  inline.forEach((code, i) => {
    try { new Function(code); }
    catch (e) {
      // نحدّد السطر بالضمّ التصاعدي: رسالة المحرّك لا تحمل موضعاً مفيداً
      const L = code.split("\n");
      let at = 0;
      for (let n = 1; n <= L.length; n++) {
        try { new Function(L.slice(0, n).join("\n") + "\n}"); }
        catch (e2) { if (/Invalid or unexpected|Unexpected|Invalid regular/.test(e2.message)) { at = n; break; } }
      }
      throw new Error(`كتلة ${i + 1}: ${e.message}` + (at ? ` (نحو السطر ${at}: ${L[at - 1].trim().slice(0, 70)})` : ""));
    }
  });
  return `${inline.length} كتلة`;
});

/* ---------- ٢ الملفات الخارجية موجودة وتُحلَّل ---------- */
const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1])
  .filter(u => !/^https?:/.test(u));
t("ملفات الشيفرة المرفقة موجودة وتُحلَّل", () => {
  for (const rel of srcs) {
    const p = path.join(DIR, rel);
    if (!fs.existsSync(p)) throw new Error(`مفقود: ${rel}`);
    try { new Function(fs.readFileSync(p, "utf8")); }
    catch (e) { throw new Error(`${rel}: ${e.message}`); }
  }
  return srcs.join(" · ");
});

/* ---------- ٣ لا معرّف مكرّر ---------- */
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
t("لا معرّف مكرّر في الهيكل", () => {
  const seen = new Set(), dup = new Set();
  for (const i of ids) { if (seen.has(i)) dup.add(i); seen.add(i); }
  if (dup.size) throw new Error([...dup].join("، "));
  return `${ids.length} معرّفاً`;
});

/* ---------- ٤ كل معرّف تناديه الشيفرة موجود ---------- */
/* المعرّفات المبنيّة وقت التشغيل (داخل innerHTML) تُستثنى: البحث على
   نصٍّ حرفي `$("#x")` وحده، وهو ما يُكتب للعناصر الثابتة. */
const all = inline.join("\n") + "\n" + srcs.map(r => fs.readFileSync(path.join(DIR, r), "utf8")).join("\n");
const idSet = new Set(ids);
t("كل معرّف تناديه الشيفرة موجود في الهيكل", () => {
  const used = new Set();
  for (const m of all.matchAll(/\$\$?\("#([A-Za-z][\w-]*)"/g)) used.add(m[1]);
  const missing = [...used].filter(x => !idSet.has(x));
  if (missing.length) throw new Error("غير موجود: " + missing.join("، "));
  return `${used.size} معرّفاً منادى`;
});

/* ---------- ٥ التبويبات والشاشات متطابقة ---------- */
t("كل تبويب له شاشة وكل شاشة لها تبويب", () => {
  const tabs = new Set([...html.matchAll(/data-go="([^"]+)"/g)].map(m => m[1]));
  const views = new Set([...html.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]));
  views.delete("detail");                    // شاشة السهم تُفتح بالنقر لا بتبويب
  const noView = [...tabs].filter(x => !views.has(x));
  const noTab = [...views].filter(x => !tabs.has(x));
  if (noView.length) throw new Error("تبويب بلا شاشة: " + noView.join("، "));
  if (noTab.length) throw new Error("شاشة بلا تبويب: " + noTab.join("، "));
  return `${tabs.size} تبويباً`;
});

/* ---------- ٦ النواة المشتركة لا تتكرّر ---------- */
/* `plan.js` و`scans.js` و`evaluate.js` يقرأها المتصفح والخادم معاً،
   فنسخةٌ ثانية منها داخل index.html تتباعد بأول تعديل. */
t("النواة المشتركة ليست منسوخة داخل index.html", () => {
  const src = inline.join("\n"), dup = [];
  for (const fn of ["function planFrom", "function scoreFrom", "const SCANS",
                    "function overallScore", "function labelOf", "function bandOf"])
    if (src.includes(fn)) dup.push(fn);
  // بصمةُ الشيفرة لا اسمُها: نسخةُ النتيجة القديمة كانت مضمَّنةً **بلا
  // اسم** داخل `analyze`، فمرّت من هذا الفحص وهو يبحث عن الاسم وحده.
  if (/max \+= w; sc \+=/.test(src) || /add\(px > E200/.test(src))
    dup.push("منطق بوابات النتيجة");
  if (src.includes("اتجاه صاعد قوي")) dup.push("أوسمة النطاقات");
  if (/TF_WEIGHT\s*=/.test(src)) dup.push("TF_WEIGHT");
  if (dup.length) throw new Error("معرَّفة مرتين: " + dup.join("، "));
  return "score.js · plan.js · scans.js · evaluate.js";
});

/* ---------- ٧ لا مسار خارجي غير الخطوط ---------- */
t("لا اعتماد خارجي غير خطوط جوجل", () => {
  const ext = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => m[1])
    // روابط `preconnect` بلا مسار، فالشرطة الأخيرة لا تلزم
    .filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/.test(u));
  if (ext.length) throw new Error(ext.join(" · "));
  return "الخطوط وحدها";
});

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
