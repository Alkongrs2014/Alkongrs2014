// تشخيص (أ)+(ب): تشريح صفقات V2 المحفوظة — بلا أيّ قرارٍ جديد
import { readSeries } from "../scripts/lib/bars-store.mjs";
import { prep } from "../scripts/lib/engine2-input.mjs";
import { createRequire } from "node:module";
const E = createRequire(import.meta.url)("../stocks/engine2.js");
const SES = createRequire(import.meta.url)("../stocks/session.js");
const DIR = "D:/Ai/ClaudeCode/trade/webtrade/data/bars/alpaca_sip";
const cache = {};
const S = s => cache[s] ||= prep(readSeries(DIR, s, "15m").bars, readSeries(DIR, s, "1d").bars);
const med = a => { if (!a.length) return null; const s=[...a].sort((x,y)=>x-y), m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; };
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
const f = x => x==null?"—":x.toFixed(2), p = x => x==null?"—":(x*100).toFixed(0)+"%";
for (const per of ["is","oos"]) {
  const T = (await import(`../docs/engine2/${per}.json`, { with: { type: "json" } })).default.trades.filter(t => t.show && t.R != null);
  const rows = [];
  for (const t of T) {
    const X = S(t.s), Tms = +t.key.split("|")[1];
    const i = X.r15.findIndex(b => b.end === Tms);
    const sig = { d: t.d, e: t.e, st: t.st, tg: t.tg, atrD: t.atrD };
    let tr = null, bars = 0, mfe = 0, mae = 0, j;
    for (j = i + 1; j < X.r15.length; j++) {
      const b = X.r15[j]; tr = tr ? E.stepTrade(tr, b) : E.openTrade(sig, b); bars++;
      mfe = Math.max(mfe, (t.d > 0 ? b.h - tr.F : tr.F - b.l)); mae = Math.max(mae, (t.d > 0 ? tr.F - b.l : b.h - tr.F));
      if (tr.end) break;
    }
    const risk = (t.e - t.st) * t.d;
    // بعد الوقف: هل بلغ السعر T1 خلال ما تبقّى من 5 جلسات؟
    let after = null;
    if (tr.end.k === "stop") { after = false; let days = new Set([X.r15[j].d]);
      for (let k = j + 1; k < X.r15.length && days.size <= 5; k++) { const b = X.r15[k]; days.add(b.d); if ((t.d>0?b.h:b.l) * t.d >= t.tg[0] * t.d) { after = true; break; } } }
    const bc = X.r15[i]; const mins = (SES.etParts(bc.t).h*60 + SES.etParts(bc.t).mi);
    rows.push({ ...t, bars, mfeR: mfe / risk, maeR: mae / risk, riskA15: null, after, lastBar: bc.last, tod: mins, fillGap: (tr.F - t.e) * t.d / risk });
  }
  console.log(`\n══ ${per} · ${rows.length} صفقة معروضة ══`);
  // (أ) كيف انتهت
  const kinds = ["stop","be","tgt","exp"];
  for (const k of kinds) { const g = rows.filter(r => r.end === k); console.log(`  انتهت ${k.padEnd(4)} ${String(g.length).padStart(3)} (${p(g.length/rows.length)}) · R متوسط ${f(mean(g.map(r=>r.R)))} · قبل التكلفة ${f(mean(g.map(r=>r.gross)))} · وسيط الشموع ${med(g.map(r=>r.bars))}`); }
  const hit1 = rows.filter(r => r.hit >= 1);
  console.log(`  بلغت T1: ${hit1.length} — منها انتهت عند نقطة الدخول ${hit1.filter(r=>r.end==="be").length}، وبلغت آخر هدف ${hit1.filter(r=>r.end==="tgt").length}`);
  const st = rows.filter(r => r.end === "stop");
  console.log(`  الموقوفة: وسيط ${med(st.map(r=>r.bars))} شمعة 15د حتى الوقف · ضُربت خلال شمعتين ${p(st.filter(r=>r.bars<=2).length/st.length)} · وسيط أقصى حركة لصالحها ${f(med(st.map(r=>r.mfeR)))}R · بلغت T1 بعد ضرب الوقف (خلال 5 جلسات) ${p(st.filter(r=>r.after).length/st.length)}`);
  console.log(`  الهندسة: المخاطرة وسيطاً ${f(med(rows.map(r=>(r.e-r.st)*r.d/r.atrD)))}×ATRd · T1 وسيطاً ${f(med(rows.map(r=>r.rr1)))}R · كلفة وسيطاً ${f(med(rows.map(r=>r.gross-r.R)))}R · فجوة التنفيذ عن الدخول المعلن وسيطاً ${f(med(rows.map(r=>r.fillGap)))}R`);
  const lb = rows.filter(r => r.lastBar);
  console.log(`  تأكيدٌ على آخر شمعة في الجلسة (تنفيذٌ غداً): ${lb.length} · R متوسط ${f(mean(lb.map(r=>r.R)))}`);
  const open = rows.filter(r => r.tod <= 10*60); // شمعة 09:30 أو 09:45 (ختم البداية)
  console.log(`  تأكيدٌ في أول نصف ساعة: ${open.length} · R ${f(mean(open.map(r=>r.R)))} · بقية اليوم ${rows.length-open.length} · R ${f(mean(rows.filter(r=>r.tod>600).map(r=>r.R)))}`);
  // (ب) أنواع أحداث قمة/قاع أمس الأربعة
  const typ = r => r.d>0 ? (r.trig.includes("PDH")?"شراء: كسر قمة أمس":(r.trig.includes("PDL")?"شراء: استعادة قاع أمس":null))
                         : (r.trig.includes("PDL")?"بيع: كسر قاع أمس":(r.trig.includes("PDH")?"بيع: فقدان قمة أمس":null));
  const G = {};
  for (const r of rows) { const k = typ(r) || (r.d>0?"شراء: مستوى أسبوعي فقط":"بيع: مستوى أسبوعي فقط"); (G[k] ||= []).push(r); }
  for (const [k, g] of Object.entries(G)) {
    const b = g.filter(r=>r.base&&r.base.n);
    console.log(`  ${k.padEnd(24)} n=${String(g.length).padStart(3)} · T1 ${p(g.filter(r=>r.hit>=1).length/g.length)} · وقف ${p(g.filter(r=>r.end==="stop").length/g.length)} · R ${f(mean(g.map(r=>r.R)))} · قبل التكلفة ${f(mean(g.map(r=>r.gross)))} · الفرق عن الأساس ${f(mean(b.map(r=>r.R-r.base.mean)))}`);
  }
}
