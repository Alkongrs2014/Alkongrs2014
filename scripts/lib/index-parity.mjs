/* =====================================================================
   مستوى المؤشر النقدي (SPX · XSP · NDX) من عقوده نفسها — تعادل الكول والبوت.

   Alpaca لا يعطي سعر المؤشر (403 مقيس)، لكنّ OPRA يعطي عرض وطلب عقوده الحقيقيين.
   والعقود الأوروبية النقدية تحقّق التعادل: C − P = e^(−rT)·(F − K)، فالمكافئ الفوري
   (المستعمَل في بلاك–شولز مع r) = K·e^(−rT) + C − P. نأخذ أقرب انتهاء، والسترايكات الثلاثة
   الأقرب إلى المال (أصغر |C−P|)، والوسيط — وتشتّتُها مقياسُ الجودة.

   دقّةٌ مقيسة (2026-10-01/02، أشرطة الدقيقة مقابل المؤشر الرسمي، 390 دقيقة): SPX وسيط
   0.47 نقطة أساس (‎99%‎ ≤ 2.2)، XSP ‏0.52، NDX ‏0.68 (‎99%‎ ≤ 3.6 ببوّابة التشتّت). والحيّ هنا
   من **عروضٍ متزامنة** لا من صفقات، فهو أدقّ من القياس.

   **مشتقٌّ معلَن لا مصدرٌ رسمي**: لا يُستعمل إلا حين تجتاز البوّابات كلُّها (عروضٌ حديثة
   متزامنة على الجهتين، ثلاثة أزواجٍ على الأقل، تشتّتٌ ضمن الحدّ، وسبريدٌ مقبول)، وإلا لا مستوى
   ولا توصية. وفي الجلسة الليلية لا تتجدّد العروض (مقيس) فلا مستوى ليلاً.
   ===================================================================== */
import { parseOcc } from "../providers/alpaca-options.mjs";

export const IDX = {
  SPX: { root: "SPXW", oi: "SPX", alpaca: true, maxDisp: 3 },
  XSP: { root: "XSP", oi: "XSP", alpaca: true, maxDisp: 4 },
  NDX: { root: "NDXP", oi: null, alpaca: false, maxDisp: 5 }
};
export const PAR = { minPairs: 3, quoteAgeMs: 5 * 60000, syncMs: 90000, maxSprPair: 0.15 };
const R = 0.04, YEAR = 365 * 86400000;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/* أزواج كول/بوت بنفس الانتهاء والسترايك من لقطات OPRA */
export function pairsOf(snaps) {
  const by = {};
  for (const [sym, sn] of Object.entries(snaps)) {
    const p = parseOcc(sym); if (!p) continue;
    const q = (sn && sn.latestQuote) || {};
    ((by[p.exp] ||= {})[p.K] ||= {})[p.type] = { bid: q.bp, ask: q.ap, t: q.t ? Date.parse(q.t) : 0,
      prev: sn && sn.prevDailyBar ? sn.prevDailyBar.c : null };
  }
  return by;
}
/* المستوى الآن من العروض. `closeAt(exp)` لحظة انتهاء العقد (للزمن المتبقّي) */
export function parityLevel(snaps, { now, closeAt, maxDisp = 3, P = PAR }) {
  const by = pairsOf(snaps);
  const why = [];
  for (const exp of Object.keys(by).sort()) {
    const T = Math.max(0, (closeAt(exp) - now) / YEAR);
    if (T <= 0) continue;
    const pairs = [];
    for (const [K, v] of Object.entries(by[exp])) {
      const c = v.call, p = v.put;
      if (!c || !p || !(c.bid > 0 && c.ask > 0 && p.bid > 0 && p.ask > 0)) continue;
      if (now - c.t > P.quoteAgeMs || now - p.t > P.quoteAgeMs || Math.abs(c.t - p.t) > P.syncMs) continue;
      const cm = (c.bid + c.ask) / 2, pm = (p.bid + p.ask) / 2;
      if ((c.ask - c.bid) / cm > P.maxSprPair || (p.ask - p.bid) / pm > P.maxSprPair) continue;
      pairs.push({ K: +K, d: Math.abs(cm - pm), S: +K * Math.exp(-R * T) + cm - pm, F: +K + (cm - pm) * Math.exp(R * T), t: Math.min(c.t, p.t) });
    }
    if (pairs.length < P.minPairs) { why.push(`${exp}: ${pairs.length} زوجاً حديثاً`); continue; }
    pairs.sort((a, b) => a.d - b.d);
    const top = pairs.slice(0, P.minPairs), Ss = top.map((x) => x.S);
    const S = med(Ss), disp = (Math.max(...Ss) - Math.min(...Ss)) / S * 1e4;
    if (disp > maxDisp) return { ok: false, why: `تشتّت التعادل ${disp.toFixed(1)} نقطة أساس > ${maxDisp}` };
    return { ok: true, S, F: med(top.map((x) => x.F)), exp, disp, n: pairs.length, Ks: top.map((x) => x.K), at: Math.min(...top.map((x) => x.t)) };
  }
  return { ok: false, why: "لا أزواج كول/بوت بعروضٍ حديثة متزامنة" + (why.length ? ` (${why.slice(0, 2).join(" · ")})` : "") };
}
/* إغلاق الجلسة السابقة من أشرطة دقيقتها الأخيرة (`bars`: رمز ⇒ [{t,c}]) — نفس التعادل على
   الصفقات (المقيس أعلاه). `K0` مستوى تقريبي لاختيار السترايكات، و`T` زمنُ العقد حينها */
export function parityFromBars(bars, { before, T = 0, maxDisp = 6 }) {
  const by = {};
  for (const [sym, a] of Object.entries(bars)) {
    const p = parseOcc(sym); if (!p) continue;
    const last = a.filter((b) => b.t <= before).sort((x, y) => x.t - y.t).pop();
    if (last && before - last.t <= 15 * 60000) ((by[p.K] ||= {})[p.type] = last);
  }
  const pairs = Object.entries(by).filter(([, v]) => v.call && v.put && Math.abs(v.call.t - v.put.t) <= 120000)
    .map(([K, v]) => ({ K: +K, d: Math.abs(v.call.c - v.put.c), S: +K * Math.exp(-R * T) + v.call.c - v.put.c }));
  if (pairs.length < 3) return { ok: false, why: `${pairs.length} أزواج في دقائق الإغلاق` };
  pairs.sort((a, b) => a.d - b.d);
  const Ss = pairs.slice(0, 3).map((x) => x.S), S = med(Ss), disp = (Math.max(...Ss) - Math.min(...Ss)) / S * 1e4;
  if (disp > maxDisp) return { ok: false, why: `تشتّت الإغلاق ${disp.toFixed(1)} نقطة أساس` };
  return { ok: true, S, disp };
}

export function selfCheck() {
  let n = 0; const ok = (c, m) => { if (!c) throw new Error(m); n++; };
  const now = Date.parse("2026-10-02T19:00:00Z"), t = "2026-10-02T18:59:30Z", closeAt = () => Date.parse("2026-10-02T20:00:00Z");
  const q = (bp, ap, tt = t) => ({ latestQuote: { bp, ap, t: tt } });
  const S0 = 7722.5;
  const mk = (K) => { const c = Math.max(0, S0 - K) + 6, p = Math.max(0, K - S0) + 6; return [[`SPXW261002C0${K}000`, q(c - 0.1, c + 0.1)], [`SPXW261002P0${K}000`, q(p - 0.1, p + 0.1)]]; };
  const snaps = Object.fromEntries([7710, 7715, 7720, 7725, 7730].flatMap(mk));
  const L = parityLevel(snaps, { now, closeAt });
  ok(L.ok && Math.abs(L.S - S0) < 0.2 && L.n === 5, "مستوى التعادل: " + JSON.stringify(L));
  // عروضٌ قديمة (الجلسة الليلية: الجمعة) ⇒ لا مستوى
  const old = Object.fromEntries(Object.entries(snaps).map(([k, v]) => [k, q(v.latestQuote.bp, v.latestQuote.ap, "2026-10-02T15:00:00Z")]));
  ok(!parityLevel(old, { now, closeAt }).ok, "عروضٌ قديمة أعطت مستوى");
  // أزواجٌ غير متزامنة ⇒ تُستبعد
  const desync = { ...snaps, "SPXW261002P07720000": q(5.9, 6.1, "2026-10-02T18:55:00Z") };
  ok(parityLevel(desync, { now, closeAt }).n === 4, "زوجٌ غير متزامن قُبل");
  // تشتّتٌ كبير (زوجٌ شاذّ بين الثلاثة الأقرب) ⇒ مرفوض
  const bad = { ...snaps, "SPXW261002C07720000": q(11.9, 12.1) };
  const B = parityLevel(bad, { now, closeAt, maxDisp: 3 });
  ok(!B.ok && /تشتّت/.test(B.why), "تشتّتٌ كبير قُبل: " + JSON.stringify(B));
  // الإغلاق من الأشرطة
  const bars = {}; for (const K of [7715, 7720, 7725]) { bars[`SPXW261002C0${K}000`] = [{ t: now - 60000, c: Math.max(0, S0 - K) + 6 }]; bars[`SPXW261002P0${K}000`] = [{ t: now - 60000, c: Math.max(0, K - S0) + 6 }]; }
  const C = parityFromBars(bars, { before: now });
  ok(C.ok && Math.abs(C.S - S0) < 0.01, "إغلاق التعادل: " + JSON.stringify(C));
  return n;
}
