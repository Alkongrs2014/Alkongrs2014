/* =====================================================================
   التحقّق من مخطّطات البيانات المنشورة — نقطة دخولٍ واحدة يستعملها الطبيب
   وبوّابة النشر والاختبارات.

   يعيد قائمة أخطاءٍ مسمّاة بالملفّ والمسار، لا «فشل» عاماً: خطأٌ بلا موضع
   يُدرِّب على تجاهله.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { BOOK_SCHEMAS } from "../../schemas/index.mjs";

const ajv = new Ajv({ allErrors: true, strict: false });
const cache = new Map();
const compile = (s) => { if (!cache.has(s)) cache.set(s, ajv.compile(s)); return cache.get(s); };

/* JSON آمن: فشلُ القراءة خطأٌ مسمّى لا استثناء يُسقط الفحص كلَّه */
export function readJSONSafe(f) {
  try { return { ok: true, v: JSON.parse(fs.readFileSync(f, "utf8")) }; }
  catch (e) { return { ok: false, err: e.message }; }
}

export function validateDoc(schema, doc) {
  const v = compile(schema);
  if (v(doc)) return [];
  return v.errors.slice(0, 20).map((e) => `${e.instancePath || "/"} ${e.message}` +
    (e.params && e.params.allowedValues ? " " + JSON.stringify(e.params.allowedValues) : "") +
    (e.params && e.params.propertyName ? " (" + e.params.propertyName + ")" : ""));
}

/* يتحقّق من دفترٍ كامل في مجلّد. `symLimit` للسرعة في الفحص السريع. */
export function validateBook(dir, book, { symLimit = Infinity, optional = [] } = {}) {
  const out = [];
  const S = BOOK_SCHEMAS[book];
  for (const [rel, schema] of Object.entries(S)) {
    if (rel === "sym/*") continue;
    const f = path.join(dir, rel);
    if (!fs.existsSync(f)) {
      if (!optional.includes(rel)) out.push({ file: rel, errors: ["الملفّ غائب"] });
      continue;
    }
    const r = readJSONSafe(f);
    if (!r.ok) { out.push({ file: rel, errors: ["JSON تالف: " + r.err] }); continue; }
    const e = validateDoc(schema, r.v);
    if (e.length) out.push({ file: rel, errors: e });
  }
  const symDir = path.join(dir, "sym");
  if (fs.existsSync(symDir)) {
    /* الكون الحيّ وحده: ملفّاتٌ يتيمة لرموزٍ خرجت من الكون لا يقرؤها أحد
       (موثّق) — تُقاس بالملخّص لا بالمجلّد. */
    const sum = readJSONSafe(path.join(dir, "summary.json"));
    const live = sum.ok && Array.isArray(sum.v.rows) ? sum.v.rows.map((r) => r.s) : [];
    let n = 0;
    for (const s of live) {
      if (n++ >= symLimit) break;
      const f = path.join(symDir, s + ".json");
      if (!fs.existsSync(f)) { out.push({ file: "sym/" + s + ".json", errors: ["ملفّ رمزٍ حيّ غائب"] }); continue; }
      const r = readJSONSafe(f);
      if (!r.ok) { out.push({ file: "sym/" + s + ".json", errors: ["JSON تالف: " + r.err] }); continue; }
      const e = validateDoc(S["sym/*"], r.v);
      if (e.length) out.push({ file: "sym/" + s + ".json", errors: e });
    }
  }
  return out;
}
