#!/usr/bin/env node
/* =====================================================================
   مقارنة محرّكين على إعادة تشغيلٍ واحدة — الأرقام التي يسأل عنها المتداول.

   لكلّ محرّك (ملفّ من `replay-crypto --out`):
     · الاختفاء والعودة: فرصةٌ (عملة|إعداد|جهة) غابت عن القائمة ثم عادت
       خلال ساعة — «ارتعاش» لا حدث.
     · أسباب الانتهاء: هدفٌ أخير · وقف · زال السبب · قِدَم.
     · الأهداف: T1/T2/T3 على كلّ ما عُرض (منتهٍ ومفتوحٍ في آخر شمعة).
     · الترتيب: عائدُ أعلى ‎5‎ في «الأقوى الآن» بعد ساعة و‎4‎ ساعات في جهة
       الفرصة، مقابل بقيّة القائمة ومقابل متوسّط الكون (شراء).
     · عملةٌ بعينها شمعةً شمعة (`--sym`).
   ووفاءُ الإعادة: تطابق «الأقوى الآن» في المحرّك القديم مع اللقطات المنشورة
   فعلاً (`--live`) — إعادةٌ لا تشبه الحيّ لا تقيس شيئاً.

   يُشغَّل:  node scripts/replay-compare.mjs A.json B.json [--sym=PUMP-USD] [--live]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = path.join(ROOT, "data", "crypto");
const files = process.argv.slice(2).filter(a => !a.startsWith("--"));
const SYM = (process.argv.find(a => a.startsWith("--sym=")) || "").slice(6) || null;
const LIVE = process.argv.includes("--live");
const avg = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const pct = (x) => x == null ? "—" : (x > 0 ? "+" : "") + x.toFixed(2) + "%";
const hhmm = (s) => new Date(s * 1000).toISOString().slice(11, 16);

const U = JSON.parse(fs.readFileSync(path.join(C, "universe.json"), "utf8")).rows.map(r => r.s);
const closes = {};
for (const s of U) {
  try { const r = JSON.parse(fs.readFileSync(path.join(C, "sym", s + ".json"), "utf8"));
        closes[s] = new Map(r.tf["5m"].c.map(b => [b[0], b[4]])); } catch { /* بلا ملف */ }
}
// إغلاقُ شمعة ‎5د‎ التي تبدأ عند `t` (ثوانٍ)
const px = (s, t) => closes[s] ? closes[s].get(t) : undefined;
const fwd = (s, k, h, d) => { const a = px(s, k), b = px(s, k + h * 3600); return a && b ? (b / a - 1) * 100 * d : null; };

function analyse(R) {
  const C_ = R.candles.filter(c => !c.skip);
  // الحضور لكلّ مفتاح فرصة
  const pres = new Map();
  C_.forEach((c, i) => { for (const [id, rows] of Object.entries(c.scans)) for (const r of rows) {
    const key = `${r.s}|${id}|${r.sd}`; if (!pres.has(key)) pres.set(key, []); pres.get(key).push(i); } });
  let flick = 0, gaps = 0;
  for (const idx of pres.values()) for (let j = 1; j < idx.length; j++) {
    const g = idx[j] - idx[j - 1] - 1;
    if (g > 0) { gaps++; if (g <= 12) flick++; }            // غاب ثم عاد خلال ساعة
  }
  const ended = C_.flatMap(c => c.ended.filter(e => e.shown));
  const reasons = {};
  for (const e of ended) { const k = (e.end && e.end.k) || "gone"; reasons[k] = (reasons[k] || 0) + 1; }
  const last = C_[C_.length - 1];
  const openRows = Object.values(last.scans).flat();
  const all = [...ended.map(e => ({ hit: e.hit, n: e.t })), ...openRows.map(r => ({ hit: r.hit, n: (r.t || []).length }))];
  const T = [1, 2, 3].map(n => [all.filter(x => x.hit >= n).length, all.filter(x => x.n >= n).length]);
  // الترتيب — كل شمعةٍ ثالثة (ربع ساعة) لتقليل ترابط العيّنات
  const R1 = { top: [], rest: [], uni: [] }, R4 = { top: [], rest: [], uni: [] };
  C_.forEach((c, i) => {
    if (i % 3) return;
    const k0 = c.k + 300;
    c.best.forEach((r, j) => {
      const a = fwd(r.s, k0, 1, r.sd), b = fwd(r.s, k0, 4, r.sd);
      (j < 5 ? R1.top : R1.rest).push(a); (j < 5 ? R4.top : R4.rest).push(b);
    });
    R1.uni.push(avg(U.map(s => fwd(s, k0, 1, 1)))); R4.uni.push(avg(U.map(s => fwd(s, k0, 4, 1))));
  });
  const nDn = new Set(C_.flatMap(c => Object.values(c.scans).flat().filter(r => r.sd === -1).map(r => r.s))).size;
  return { candles: C_.length, keys: pres.size, gaps, flick, ended: ended.length, reasons, T,
           r1: Object.fromEntries(Object.entries(R1).map(([k, v]) => [k, avg(v)])),
           r4: Object.fromEntries(Object.entries(R4).map(([k, v]) => [k, avg(v)])),
           n4: R4.top.filter(Number.isFinite).length, dnCoins: nDn,
           dnShown: new Set(ended.filter(e => e.d === -1).map(e => e.key)).size + openRows.filter(r => r.sd === -1).length };
}

const res = files.map(f => ({ f: path.basename(f), R: JSON.parse(fs.readFileSync(f, "utf8")) }));
for (const { f, R } of res) {
  const A = analyse(R);
  console.log(`\n▶ ${f} (${R.engine}) · ${A.candles} شمعة · ${A.keys} فرصة مميّزة`);
  console.log(`  اختفاء ثم عودة: ${A.gaps} غياب · منها ${A.flick} عاد خلال ساعة`);
  console.log(`  انتهت ${A.ended}: ${Object.entries(A.reasons).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`  الأهداف: ${A.T.map(([h, n], i) => `T${i + 1} ${h}/${n}`).join(" · ")}`);
  console.log(`  الترتيب ساعة: أعلى5 ${pct(A.r1.top)} · البقية ${pct(A.r1.rest)} · الكون ${pct(A.r1.uni)}`);
  console.log(`  الترتيب ‎4س: أعلى5 ${pct(A.r4.top)} · البقية ${pct(A.r4.rest)} · الكون ${pct(A.r4.uni)} (ن=${A.n4})`);
  console.log(`  عملاتٌ ظهرت هبوطاً: ${A.dnCoins}`);
}

if (SYM) for (const { f, R } of res) {
  console.log(`\n▶ ${SYM} في ${f}`);
  let prev = null;
  for (const c of R.candles.filter(c => !c.skip)) {
    const where = Object.entries(c.scans).filter(([, v]) => v.some(r => r.s === SYM))
      .map(([id, v]) => { const r = v.find(x => x.s === SYM); return `${id}#${v.indexOf(r) + 1} q${r.q.toFixed(2)} T${r.hit}`; }).join(" ");
    const bi = c.best.findIndex(r => r.s === SYM);
    const line = (bi >= 0 ? `best#${bi + 1} ` : "") + (where || "—");
    if (line.replace(/q[\d.]+|#\d+/g, "") !== (prev || "").replace(/q[\d.]+|#\d+/g, "")) console.log(`  ${hhmm(c.k)} ${line}`);
    prev = line;
  }
}

if (LIVE) {
  const d = path.join(C, ".monitor", "snaps");
  const live = new Map(fs.readdirSync(d).map(f => { const s = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); return [s.k, s]; }));
  for (const { f, R } of res) {
    let n = 0, top5 = 0, jac = [];
    for (const c of R.candles) {
      const L = live.get(c.k); if (!L || c.skip) continue;
      n++;
      const a = new Set(c.best.slice(0, 5).map(r => r.s)), b = new Set(L.best.slice(0, 5).map(r => r.s));
      if ([...a].join() === [...b].join()) top5++;
      const A = new Set(c.best.map(r => r.s)), B = new Set(L.best.map(r => r.s));
      jac.push([...A].filter(x => B.has(x)).length / Math.max(1, new Set([...A, ...B]).size));
    }
    console.log(`\n▶ وفاء ${f} للمنشور: ${n} شمعة · أعلى5 متطابقة ${top5} · تداخل «الأقوى الآن» ${(avg(jac) * 100).toFixed(0)}%`);
  }
}
