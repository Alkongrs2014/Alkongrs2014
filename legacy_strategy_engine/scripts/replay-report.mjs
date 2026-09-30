#!/usr/bin/env node
/* =====================================================================
   قراءة إعادة التشغيل — ما التُقط، وما فات، ولماذا.

   يقرأ `data/.monitor/replay-opps.json` (من `replay-opps.mjs`) ويقيس
   **بعد** المحاكاة من شمعاتٍ لاحقة: هذا تقييمٌ لما قرّره النظام بما كان
   يعرفه، لا مدخلٌ في القرار.

   • كل فرصةٍ ظهرت في جلسات التقييم: متى، وبأيّ سعر، وأقصى حركةٍ معها
     وضدّها حتى نهاية الجلسة التالية، وأيّ أهدافها بُلغ.
   • كل حركةٍ يومية ≥ 2%: هل كان لها إعدادٌ قبل منتصفها (مبكّر)، أم ظهر
     بعده (متأخّر)، أم أطلق شرطٌ ولم يُعرض (فائتٌ بالترشيح)، أم لا إعداد
     (فجوة / بلا إشارة).
   • جودة الترتيب: عائدُ الأعلى ترتيباً مقابل البقية في الجلسة التالية.
   • القديمة في الصدارة: أعمارُ ما احتلّ المراكز الثلاثة الأولى.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IN = process.argv[2] || path.join(ROOT, "data", ".monitor", "replay-opps.json");
const R = JSON.parse(fs.readFileSync(IN, "utf8"));
const evalDays = R.days.slice(R.warm);
const bars = R.bars;
const pct = (x) => (x >= 0 ? "+" : "") + x.toFixed(2) + "%";
const nyDate = (ms) => new Date(ms - 4 * 3600e3).toISOString().slice(0, 10);   // EDT
const hm = (ms) => { const d = new Date(ms + 3 * 3600e3); return d.toISOString().slice(11, 16); };   // الرياض

/* ── ١) الفرص الفريدة ── */
const opps = {};
for (const st of R.timeline) {
  if (!evalDays.includes(st.day)) continue;
  const best = {};
  for (const r of st.list) if (!best[r.s] || r.q > best[r.s].q) best[r.s] = r;
  const order = Object.values(best).sort((a, b) => b.q - a.q);
  for (const r of st.list) {
    if (!(r.sd === 1 || r.sd === -1)) continue;
    const k = `${r.s}|${r.scan}|${r.sd}|${r.since}`;
    const pos = order.findIndex(x => x.s === r.s && x.scan === r.scan);
    if (!opps[k]) opps[k] = { s: r.s, scan: r.scan, sd: r.sd, since: r.since * 1000, first: st.T, px: r.pc, px0: r.px0,
                              e: r.e, stp: r.st, t: r.t || [], bestPos: pos, steps: 0, day: st.day };
    const o = opps[k]; o.steps++; o.bestPos = Math.min(o.bestPos, pos); o.last = st.T;
  }
}
function outcome(o) {
  const b = (bars[o.s] || []).filter(x => x[0] >= o.first);
  const endDay = evalDays[Math.min(evalDays.indexOf(o.day) + 1, evalDays.length - 1)];
  const w = b.filter(x => nyDate(x[0]) <= endDay);
  if (!w.length) return null;
  let mfe = 0, mae = 0, hit = 0, stopped = false;
  for (const x of w) {
    const fav = o.sd === 1 ? x[2] : x[3], adv = o.sd === 1 ? x[3] : x[2];
    mfe = Math.max(mfe, (fav / o.px - 1) * 100 * o.sd);
    mae = Math.min(mae, (adv / o.px - 1) * 100 * o.sd);
    if (!stopped && Number.isFinite(o.stp) && (adv - o.stp) * o.sd <= 0) stopped = true;
    if (!stopped) while (hit < o.t.length && (fav - o.t[hit]) * o.sd >= 0) hit++;
  }
  const endPx = w[w.length - 1][4];
  return { mfe, mae, hit, stopped, end: (endPx / o.px - 1) * 100 * o.sd };
}
const list = Object.values(opps).map(o => ({ ...o, out: outcome(o) })).filter(o => o.out);
const fresh = list.filter(o => evalDays.includes(nyDate(o.since)));   // ظهرت فعلاً في جلسات التقييم
console.log(`\n▶ ${evalDays.length} جلسات (${evalDays[0]} → ${evalDays[evalDays.length - 1]}) · فرص ظهرت فيها: ${fresh.length} (${fresh.filter(o => o.sd === 1).length} صعود · ${fresh.filter(o => o.sd === -1).length} هبوط)`);
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const med = (a) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[v.length >> 1] : 0; };
for (const [lbl, set] of [["الكل", fresh], ["دخلت الثلاثة الأولى", fresh.filter(o => o.bestPos <= 2)], ["لم تدخلها", fresh.filter(o => o.bestPos > 2)]]) {
  if (!set.length) continue;
  console.log(`  ${lbl}: ${set.length} · وسيط أقصى حركة معها ${pct(med(set.map(o => o.out.mfe)))} · ضدّها ${pct(med(set.map(o => o.out.mae)))} · النهاية ${pct(med(set.map(o => o.out.end)))} · T1 ${set.filter(o => o.out.hit >= 1).length} · T2 ${set.filter(o => o.out.hit >= 2).length} · وقف ${set.filter(o => o.out.stopped).length}`);
}

/* ── ٢) الحركات الكبيرة ── */
const cls = { early: [], late: [], filtered: [], gap: [], none: [] };
for (let di = 0; di < evalDays.length; di++) {
  const day = evalDays[di];
  for (const s of Object.keys(bars)) {
    const all = bars[s];
    const dayB = all.filter(x => nyDate(x[0]) === day);
    const prevB = all.filter(x => nyDate(x[0]) < day);
    if (!dayB.length || !prevB.length) continue;
    const pc0 = prevB[prevB.length - 1][4], open = dayB[0][1], close = dayB[dayB.length - 1][4];
    const mv = (close / pc0 - 1) * 100;
    if (Math.abs(mv) < 2) continue;
    const d = Math.sign(mv), gap = (open / pc0 - 1) * 100;
    const half = dayB.find(x => (x[4] / pc0 - 1) * 100 * d >= Math.abs(mv) / 2);
    const halfT = half ? half[0] + 900e3 : dayB[dayB.length - 1][0];
    const mine = list.filter(o => o.s === s && o.sd === d && o.first <= dayB[dayB.length - 1][0] + 900e3 && (o.last || o.first) >= dayB[0][0]);
    const earlyO = mine.find(o => o.first <= halfT);
    const rec = { day, s, mv, gap, halfT };
    if (earlyO) { cls.early.push({ ...rec, at: earlyO.first, scan: earlyO.scan, pos: earlyO.bestPos }); continue; }
    if (mine.length) { cls.late.push({ ...rec, at: mine[0].first, scan: mine[0].scan }); continue; }
    const fr = (R.fired[`${s}|${day}`] || []).filter(f => f[2] === d && f[0] <= halfT);
    if (fr.length) { cls.filtered.push({ ...rec, scans: [...new Set(fr.map(f => f[1]))] }); continue; }
    if (Math.abs(gap) >= 0.6 * Math.abs(mv)) cls.gap.push(rec); else cls.none.push(rec);
  }
}
const nBig = Object.values(cls).reduce((a, b) => a + b.length, 0);
console.log(`\n▶ حركات يومية ≥ 2%: ${nBig}`);
console.log(`  مبكّرة (إعدادٌ قبل منتصف الحركة): ${cls.early.length}`);
console.log(`  متأخّرة (ظهرت بعد منتصفها): ${cls.late.length}`);
console.log(`  شرطٌ أطلق ولم يُعرض (فحصٌ مطلوب): ${cls.filtered.length}`);
console.log(`  فجوة افتتاح (≥60% من الحركة): ${cls.gap.length}`);
console.log(`  بلا إعداد: ${cls.none.length}`);
for (const x of cls.filtered.slice(0, 12)) console.log(`    · ${x.day} ${x.s} ${pct(x.mv)} — أطلق ${x.scans.join(",")}`);
for (const x of cls.late.slice(0, 8)) console.log(`    · متأخّرة ${x.day} ${x.s} ${pct(x.mv)} — ${x.scan} عند ${hm(x.at)} (منتصف ${hm(x.halfT)})`);

/* ── ٣) القديمة في الصدارة ── */
let oldTop = 0, topSteps = 0, maxAge = 0;
for (const st of R.timeline) {
  if (!evalDays.includes(st.day)) continue;
  const best = {};
  for (const r of st.list) if (!best[r.s] || r.q > best[r.s].q) best[r.s] = r;
  const top = Object.values(best).sort((a, b) => b.q - a.q).slice(0, 3);
  for (const r of top) { topSteps++; const age = (st.T / 1000 - r.since) / 86400; maxAge = Math.max(maxAge, age); if (age > 3) oldTop++; }
}
console.log(`\n▶ أعمار المراكز الثلاثة الأولى: ${oldTop} من ${topSteps} (${(oldTop / Math.max(1, topSteps) * 100).toFixed(1)}%) أقدم من 3 أيام · الأقصى ${maxAge.toFixed(1)} يوم`);
fs.writeFileSync(path.join(path.dirname(IN), "replay-report.json"), JSON.stringify({ evalDays, opps: fresh, cls }, null, 0));
