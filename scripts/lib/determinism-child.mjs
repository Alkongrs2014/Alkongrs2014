/* =====================================================================
   فحص الحتمية — يُشغَّل عمليةً مستقلّة لكل دفتر (الوحدتان تقرآن `BOOK`
   و`OPP_BAR_SEC` عند الاستيراد، فدفتران في عمليةٍ واحدة يخلطان الإعداد).

   على لقطةٍ ثابتة، بلا كتابة ولا شبكة:
     INV-20  تشغيلان مستقلّان للمحرّك (`runOnce`) بنفس الساعة ⇒ صفوفٌ متطابقة حرفياً
     INV-22  عكسُ ترتيب الرموز ⇒ صفوفُ كلّ رمزٍ هي هي
     INV-24  بناءُ اللقطة مرّتين ⇒ نفس `rowsHash`
     INV-20  اللقطة المعادة من نفس المدخلات تطابق المنشورة عند نفس المفتاح
   المخرَج JSON على stdout.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const book = process.env.BOOK === "crypto" ? "crypto" : "stocks";
const base = book === "crypto" ? path.join(dir, "crypto") : dir;
const rd = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(base, f), "utf8")); } catch { return d; } };
const TS = await import("../track-strategies.mjs");
const BO = await import("../build-opportunities.mjs");

const out = { book, checks: [] };
const add = (id, inv, ok, detail = "") => out.checks.push({ id, inv, ok: !!ok, detail });
const strip = (rows) => JSON.stringify(rows.map((r) => { const { pAt, ...x } = r; return x; })
  .sort((a, b) => (a.s + a.st).localeCompare(b.s + b.st)));

const sum = rd("summary.json"), strat = rd("strategies.json");
if (!sum || !strat) { add("determinism.inputs", "INV-20", false, "لا summary/strategies"); console.log(JSON.stringify(out)); process.exit(0); }
const now = strat.updated || sum.updated;
const io = (mut) => (rel, d = null) => { const v = rd(rel, d); return mut && rel === "summary.json" && v ? mut(structuredClone(v)) : v; };

const a = TS.runOnce({ out: base, now, io: io() });
const b = TS.runOnce({ out: base, now, io: io() });
add("determinism.engine", "INV-20", strip(a.rows) === strip(b.rows), `${a.rows.length} صفّاً`);

const rev = TS.runOnce({ out: base, now, io: io((s) => { s.rows.reverse(); return s; }) });
add("metamorphic.symbol-order", "INV-22", strip(a.rows) === strip(rev.rows), "عكسُ ترتيب الرموز");

/* اللقطة من صفوف المحرّك المعادة نفسها — لا من الملفّ المنشور */
const stratDoc = { ...strat, rows: a.rows, confBar: a.confBar || strat.confBar,
  hold: a.holdNext && Object.keys(a.holdNext).length ? a.holdNext : strat.hold };
const snapIO = { rd: (f) => f === "strategies.json" ? stratDoc : rd(f), sym: (s) => rd(`sym/${s}.json`) };
const s1 = BO.buildSnapshot(now, snapIO), s2 = BO.buildSnapshot(now, snapIO);
add("determinism.snapshot", "INV-24", s1.ok && s2.ok && s1.rowsHash === s2.rowsHash,
  s1.ok ? s1.rowsHash + (s2.ok ? " / " + s2.rowsHash : "") : s1.why);

const pub = rd("opportunities.json");
if (s1.ok && pub) {
  const sameKey = s1.candleKey === pub.candleKey;
  const sameVer = s1.strategyVersion === pub.strategyVersion && s1.pipelineVersion === pub.pipelineVersion;
  if (sameKey && sameVer)
    add("recompute.vs-published", "INV-20", s1.rowsHash === pub.rowsHash, `محسوبة ${s1.rowsHash} · منشورة ${pub.rowsHash}`);
  else
    out.checks.push({ id: "recompute.vs-published", inv: "INV-20", ok: true, sev: "INFO",
      detail: sameKey ? `النسخة تغيّرت (${pub.pipelineVersion || "بلا خطّ"} → ${s1.pipelineVersion}) — إعادة بناءٍ مقصودة واحدة`
                      : `المنشورة على شمعة ${pub.candleKey} والمعادة على ${s1.candleKey} — الكاتب لم يلحق بعد` });
}
console.log(JSON.stringify(out));
