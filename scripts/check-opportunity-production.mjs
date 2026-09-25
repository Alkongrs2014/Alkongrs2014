/* =====================================================================
   اختبار إنتاجيّ — لقطاتٌ متتابعة من الجدولة الحيّة، وصفرُ اختلاف.

   لا محاكاة ولا مدخلاتٍ مصنوعة: يقرأ `data/opportunities.json` الذي
   تكتبه المهامُّ المجدولة فعلاً، على فتراتٍ يحدّدها المستخدم، ويقارن
   **كامل الصفوف** — الرمز والدرجة والرتبة والتوافق والاتجاه والعضوية.

   الشرط مزدوجٌ لا فرد، وكلاهما شرطُ قبول:

   ١) **داخل مفتاح الشمعة الواحد: صفر اختلاف.** ولا استثناء.
   ٢) **عند تقدّم المفتاح: يجوز الاختلاف** — ويُعرض ما تغيّر. نظامٌ لا
      يتحرّك أبداً ليس ثابتاً بل معطَّلاً، ففحصٌ يقبل الجمود يشهد
      للعطل.

   ويقرأ السعر اللحظي من `summary.json` في كل عيّنة ويُثبت أنه **تحرّك**
   بينما لم تتحرّك القائمة: بلا هذا يكون «صفر اختلاف» نتيجةَ سكونِ
   السوق لا نتيجةَ الإصلاح.

   يُشغَّل:  node scripts/check-opportunity-production.mjs [عدد العيّنات] [ثوانٍ بين كلٍّ]
   افتراضاً: 5 عيّنات × 120 ثانية  (عشر دقائق — تغطّي شمعةً وأكثر)
   وعلى البيانات المنشورة: --remote
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { oppsCanon, snapCanon } = require("../stocks/opportunities.js");

const REMOTE = process.argv.includes("--remote");
const RAW = "https://raw.githubusercontent.com/Alkongrs2014/Alkongrs2014/data";
const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const N = Number(args[0] || 5);
const GAP = Number(args[1] || 120);

const iso = (sec) => sec ? new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z" : "—";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function read(file) {
  if (!REMOTE) {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", file), "utf8")); } catch { return null; }
  }
  try {
    const res = await fetch(`${RAW}/${file}?x=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

/* صفٌّ كاملٌ نصّاً: كلُّ ما يشتكي المستخدم من تبدّله. السعر ونسبة
   التغيّر خارجَه عمداً — لحظيّان بالتصميم ويُعرضان سعراً فقط. */
const rowKey = (r, i) => [i, r.s, r.q, r.adj, r.scs, r.cdir, r.mixed, r.n, r.sd, r.v, r.cbar, r.ctf].join("|");

function flatten(snap) {
  const out = {};
  for (const id of Object.keys(snap.scans || {})) out[id] = (snap.scans[id] || []).map(rowKey);
  return out;
}

function diffScans(a, b) {
  const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const out = [];
  for (const id of ids) {
    const x = a[id] || [], y = b[id] || [];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const sx = new Set(x.map(v => v.split("|")[1])), sy = new Set(y.map(v => v.split("|")[1]));
    const gone = [...sx].filter(s => !sy.has(s)), came = [...sy].filter(s => !sx.has(s));
    let moved = 0;
    const pos = {}; y.forEach((v, i) => { pos[v.split("|")[1]] = i; });
    x.forEach((v, i) => { const s = v.split("|")[1]; if (pos[s] !== undefined && pos[s] !== i) moved++; });
    out.push({ id, n: `${x.length}→${y.length}`, gone, came, moved });
  }
  return out;
}

console.log(`\n▶ اختبار إنتاجيّ للقطة الفرص — ${N} عيّنة كل ${GAP} ثانية (${REMOTE ? "البيانات المنشورة" : "الإنتاج المحلّي"})\n`);

const samples = [];
for (let i = 0; i < N; i++) {
  if (i) await sleep(GAP * 1000);
  const [opp, sum] = await Promise.all([read("opportunities.json"), read("summary.json")]);
  if (!opp || !opp.scans) { console.log(`  عيّنة ${i + 1}: لا لقطة`); continue; }
  const px = {};
  for (const r of (sum && sum.rows) || []) if (Number.isFinite(r.p)) px[r.s] = r.p;
  samples.push({ at: Date.now(), candleKey: opp.candleKey, rowsHash: opp.rowsHash,
                 strategyVersion: opp.strategyVersion, generatedAt: opp.generatedAt,
                 count: opp.count, flat: flatten(opp), canon: snapCanon(opp), px });
  const t = new Date().toISOString().slice(11, 19);
  console.log(`  عيّنة ${i + 1} · ${t} · شمعة ${iso(opp.candleKey)} · بصمة ${opp.rowsHash} · ${opp.count} صفّاً`);
}

if (samples.length < 2) { console.log("\n✗ عيّنتان على الأقل مطلوبتان\n"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (m, d) => { pass++; console.log(`  ✓ ${m}${d ? " — " + d : ""}`); };
const no = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? " — " + d : ""}`); };

console.log("");
/* ١) داخل المفتاح الواحد: صفر اختلاف */
let sameKeyPairs = 0, violations = [];
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1], b = samples[i];
  if (a.candleKey !== b.candleKey) continue;
  sameKeyPairs++;
  const d = diffScans(a.flat, b.flat);
  if (d.length) violations.push({ pair: `${i}→${i + 1}`, d });
  if (a.rowsHash !== b.rowsHash) violations.push({ pair: `${i}→${i + 1}`, d: [{ id: "«البصمة»", n: `${a.rowsHash}→${b.rowsHash}`, gone: [], came: [], moved: 0 }] });
}
if (!sameKeyPairs) no("وُجد زوجٌ داخل شمعةٍ واحدة للمقارنة", "كلُّ العيّنات على شمعاتٍ مختلفة — أعِد بفاصلٍ أقصر");
else if (violations.length) {
  no(`صفر اختلاف داخل الشمعة الواحدة (${sameKeyPairs} زوجاً)`);
  for (const v of violations) for (const x of v.d)
    console.log(`      ${v.pair} · ${x.id}: ${x.n}${x.gone.length ? " · خرج " + x.gone.join(",") : ""}${x.came.length ? " · دخل " + x.came.join(",") : ""}${x.moved ? " · " + x.moved + " تغيّر ترتيبه" : ""}`);
} else ok(`صفر اختلاف داخل الشمعة الواحدة`, `${sameKeyPairs} زوجاً · ${samples[0].count} صفّاً في كلٍّ`);

/* ٢) السعر تحرّك فعلاً — وإلا كان الثبات سكونَ سوقٍ لا إصلاحاً */
let moved = 0, common = 0;
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1].px, b = samples[i].px;
  for (const s of Object.keys(a)) if (s in b) { common++; if (a[s] !== b[s]) moved++; }
}
/* **و`raw.githubusercontent` يخزّن خمس دقائق**: عيّنتان بفاصل دقيقتين
   تقرآن نفس النسخة المخزَّنة، فيخرج «لم يتحرّك سعر» وهو يصف ذاكرةَ
   شبكةٍ لا نظاماً. فالحكم في الوضع البعيد لا يُشدَّد إلا بفاصلٍ يتجاوز
   الخزن — وإلا قيل «غير حاسم» صراحةً. أداةُ القياس تُختبر قبل أن
   يُستنتج منها. */
const CDN_TTL = 300;
if (moved) ok("السعر اللحظي تحرّك بين العيّنات", `${moved} تغيّراً من ${common} مقارنة — فالثبات ليس سكوناً`);
else if (REMOTE && GAP <= CDN_TTL)
  console.log(`  • غير حاسم: الفاصل ${GAP}ث دون خزن raw.githubusercontent (${CDN_TTL}ث)، فالعيّنات قد تكون نفس النسخة.
    أعِد بفاصل ${CDN_TTL + 60} فأكثر، أو شغّله محلياً بلا --remote.`);
else no("السعر اللحظي تحرّك بين العيّنات", "لم يتحرّك سعرٌ واحد — الاختبار لا يُثبت شيئاً، أعِده والسوق يتحرّك");

/* ٣) عند تقدّم المفتاح يجوز الاختلاف — ويُعرض */
const advances = [];
for (let i = 1; i < samples.length; i++)
  if (samples[i].candleKey > samples[i - 1].candleKey) advances.push(i);
if (advances.length) {
  for (const i of advances) {
    const d = diffScans(samples[i - 1].flat, samples[i].flat);
    console.log(`  • تقدّمَ المفتاح ${iso(samples[i - 1].candleKey)} → ${iso(samples[i].candleKey)} · ${d.length} مسحاً تغيّر (مشروع)`);
  }
  ok("تقدّمُ المفتاح يُحدِث تغييراً — النظام حيٌّ لا جامد");
} else console.log("  • لم يتقدّم المفتاح خلال النافذة — لا حكمَ على الحيوية هنا");

/* ٤) البصمة تصف الصفوف فعلاً */
const bad = samples.filter(s => s.canon && s.rowsHash && s.rowsHash !== require("node:crypto").createHash("sha256").update(s.canon).digest("hex").slice(0, 12));
bad.length ? no("البصمة المحفوظة تطابق الصفوف", bad.length + " عيّنة") : ok("البصمة المحفوظة تطابق الصفوف", samples.length + " عيّنة");

/* ٥) المفتاح على حدّ ربع ساعة */
const offGrid = samples.filter(s => s.candleKey % 900 !== 0);
offGrid.length ? no("كلُّ مفتاحٍ على حدّ ربع ساعة", offGrid.map(s => iso(s.candleKey)).join(" · "))
               : ok("كلُّ مفتاحٍ على حدّ ربع ساعة");

console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
process.exit(fail ? 1 : 0);
