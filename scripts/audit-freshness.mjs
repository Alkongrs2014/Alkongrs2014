#!/usr/bin/env node
/* =====================================================================
   تدقيق طزاجة الفرص — على ناتج `replay-opps.mjs` (بلا شبكة).

   يجيب أربعة أسئلة بالأرقام لا بالظنّ:
   ١) هل تحجب الفرصُ القديمة فرصاً جديدة؟ (سقف · تكرار المفتاح · قفلُ
      دورة الحياة · التجديد) — كلٌّ بعدّاده.
   ٢) كم فرصةً «جديدة» بالتعريفين: وسمُ `fk` القديم (شمعتان من فريم
      الشرط، واليوميّ = يومان) مقابل `fr` (إطلاقٌ أو دخولٌ خلال آخر أربع
      شمعات ‎15د‎ مغلقة).
   ٣) أيُّ شرطٍ يستطيع أن ينقلب داخل الجلسة وأيُّها لا ينقلب إلا بين
      جلستين — من سلسلة الإطلاق الخام قبل أيّ ترشيح.
   ٤) أقوى متحرّكي اليوم: ظهروا؟ ومتى؟ وإن لم يظهروا فلماذا؟

   node scripts/audit-freshness.mjs <replay.json> [--day=YYYY-MM-DD] [--json=out.json]
   ===================================================================== */
import fs from "node:fs";

const FILE = process.argv[2];
if (!FILE) { console.error("الاستعمال: audit-freshness.mjs <replay.json>"); process.exit(2); }
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const R = JSON.parse(fs.readFileSync(FILE, "utf8"));
const TL = R.timeline;
const DAY = arg("day", TL[TL.length - 1].day);
const FW = 4 * 900;                        // نافذة الطزاجة: أربع شمعات ‎15د‎ مغلقة
const keyK = (T) => Math.round(T / 1000) - 900;   // مفتاح الشمعة عند خطوة الإعادة
const out = { day: DAY };

/* الطزاجة بالتعريف الجديد: الحقل المكتوب إن وُجد، وإلا يُشتقّ من `since`
   وحده (ناتج «ما قبل» لا يحمل `fr`) — فيقاس التعريف الجديد على المدخل القديم. */
const isFresh = (r, K) => r.fr != null ? r.fr === 1 : Number.isFinite(r.since) && K - r.since < FW;
const dirW = (d) => d === 1 ? "CALL" : d === -1 ? "PUT" : "—";

/* ── ١) الحجب ── */
{
  let maxRows = 0, stepsOld = 0, oldKeys = new Set(), renew = { tgt: 0, stop: 0 }, gone = 0;
  let dupSince = 0;
  for (const st of TL) {
    const per = {};
    for (const r of st.list) per[r.scan] = (per[r.scan] || 0) + 1;
    maxRows = Math.max(maxRows, ...Object.values(per), 0);
    const old = st.ended.filter(e => e[1] === "old");
    if (old.length) stepsOld++;
    for (const e of old) oldKeys.add(e[0]);
    for (const [k, why] of st.closed || []) { if (why in renew) renew[why]++; else if (why === "gone") gone++; }
    const seen = new Set();
    for (const r of st.list) { const k = r.s + "|" + r.scan + "|" + r.sd; if (seen.has(k)) dupSince++; seen.add(k); }
  }
  out.block = { maxRowsPerScan: maxRows, stepsWithOldLock: stepsOld, oldLockedKeys: [...oldKeys], renew, gone, dupKeys: dupSince };
  console.log(`\n▶ ١) الحجب — ${TL.length} خطوة`);
  console.log(`  سقف العدد: لا سقف للأسهم في الشيفرة · أكبر قائمة ${maxRows} صفّاً`);
  console.log(`  تكرار المفتاح داخل اللقطة: ${dupSince}`);
  console.log(`  قفل «قديمة» (شرطٌ يُطلق ودورةٌ انتهت بالقِدَم فتُحجب): ${oldKeys.size} مفتاحاً في ${stepsOld} خطوة ${[...oldKeys].slice(0, 8).join(" · ")}`);
  console.log(`  تجديدٌ بعد هدف/وقف: ${renew.tgt}/${renew.stop} · انتهاءٌ بزوال السبب: ${gone}`);
}

/* ── ٢) الطزاجة في جلسة اليوم ── */
{
  const steps = TL.filter(s => s.day === DAY);
  const rows = [];
  console.log(`\n▶ ٢) جلسة ${DAY} — ${steps.length} إغلاق ‎15د‎`);
  console.log("  الوقت(UTC) | المعروض CALL/PUT | «جديدة» بالوسم القديم CALL/PUT | جديدة ≤4 شمعات CALL/PUT");
  for (const st of steps) {
    const K = keyK(st.T);
    const c = { all: [0, 0], old: [0, 0], nw: [0, 0] };
    const u = { all: [new Set(), new Set()], old: [new Set(), new Set()], nw: [new Set(), new Set()] };
    for (const r of st.list) {
      const j = r.sd === 1 ? 0 : r.sd === -1 ? 1 : -1;
      if (j < 0) continue;
      u.all[j].add(r.s + "|" + r.scan);
      if (r.fk === "fresh") u.old[j].add(r.s + "|" + r.scan);
      if (isFresh(r, K)) u.nw[j].add(r.s + "|" + r.scan);
    }
    for (const k of ["all", "old", "nw"]) c[k] = u[k].map(x => x.size);
    rows.push({ T: st.T, ...c });
    console.log(`  ${new Date(st.T).toISOString().slice(11, 16)} | ${c.all.join("/")} | ${c.old.join("/")} | ${c.nw.join("/")}`);
  }
  out.session = rows;
  /* أحداث الطزاجة المتمايزة خلال اليوم: كلُّ مفتاحٍ صار «جديداً» مرّةً على الأقل */
  const ev = { CALL: new Map(), PUT: new Map() };
  for (const st of steps) {
    const K = keyK(st.T);
    for (const r of st.list) if (isFresh(r, K) && (r.sd === 1 || r.sd === -1)) {
      const m = ev[dirW(r.sd)], k = r.s + "|" + r.scan + "|" + (r.fa ?? r.since);
      if (!m.has(k)) m.set(k, { s: r.s, scan: r.scan, at: st.T, why: r.fw || "trig" });
    }
  }
  out.events = { CALL: [...ev.CALL.values()], PUT: [...ev.PUT.values()] };
  for (const d of ["CALL", "PUT"]) {
    const a = [...ev[d].values()];
    console.log(`  أحداث ${d} جديدة متمايزة اليوم: ${a.length}${a.length ? " — " + a.map(x => `${x.s}/${x.scan}@${new Date(x.at).toISOString().slice(11, 16)}${x.why !== "trig" ? "(" + x.why + ")" : ""}`).join(" · ") : ""}`);
  }
  const last = steps[steps.length - 1];
  if (last) {
    const K = keyK(last.T);
    console.log(`  آخر إغلاق ${new Date(last.T).toISOString().slice(11, 16)}Z — الأعمار:`);
    for (const r of last.list.filter(r => r.scan === "align" || r.scan === "alignDn"))
      console.log(`    ${dirW(r.sd)} ${r.s} ${r.scan} عمر ${((K - r.since) / 3600).toFixed(1)}س · وسم قديم ${r.fk} · جديد ${isFresh(r, K) ? "نعم" : "لا (مستمرة)"}`);
  }
}

/* ── ٣) حساسية الشروط لحركة الجلسة ── */
{
  // سلسلة الإطلاق الخام لكل (رمز × شرط × جهة) بترتيب الخطوات
  const on = new Map();                   // k → Set(T)
  for (const [sd, arr] of Object.entries(R.fired)) {
    const s = sd.split("|")[0];
    for (const [T, id, d] of arr) { const k = s + "|" + id + "|" + d; (on.get(k) || on.set(k, new Set()).get(k)).add(T); }
  }
  const first = new Set(), byDay = {};
  for (const st of TL) (byDay[st.day] ||= []).push(st.T);
  for (const ts of Object.values(byDay)) first.add(ts[0]);
  const syms = [...new Set(Object.keys(R.fired).map(k => k.split("|")[0]))];
  const stat = {};
  for (const [k, set] of on) {
    const [, id] = k.split("|");
    const s = (stat[id] ||= { intra: 0, gap: 0, onSteps: 0 });
    let prev = false;
    for (const st of TL) {
      const v = set.has(st.T);
      if (v) s.onSteps++;
      if (v && !prev) (first.has(st.T) ? s.gap++ : s.intra++);
      prev = v;
    }
  }
  out.scanSensitivity = stat;
  console.log(`\n▶ ٣) من أين يأتي الإطلاق — ${Object.keys(byDay).length} جلسات · ${syms.length} سهماً (قبل أيّ ترشيح)`);
  console.log("  الشرط | إطلاقٌ داخل الجلسة | إطلاقٌ عند الافتتاح (تغيّرٌ ليليّ) | خطواتٌ مُطلِقة");
  for (const [id, s] of Object.entries(stat).sort((a, b) => b[1].intra - a[1].intra))
    console.log(`  ${id.padEnd(9)} | ${String(s.intra).padStart(4)} | ${String(s.gap).padStart(4)} | ${s.onSteps}`);
}

/* ── ٤) أقوى متحرّكي اليوم ── */
{
  const steps = TL.filter(s => s.day === DAY);
  const t0 = steps.length ? steps[0].T - 900e3 : 0;
  const mv = [];
  for (const [s, bars] of Object.entries(R.bars)) {
    const today = bars.filter(b => b[0] >= t0);
    const d = (R.daily[s] || []).filter(b => b[0] < t0).slice(-15);
    if (!today.length || d.length < 5) continue;
    let tr = 0; for (let i = 1; i < d.length; i++) tr += Math.max(d[i][2] - d[i][3], Math.abs(d[i][2] - d[i - 1][4]), Math.abs(d[i][3] - d[i - 1][4]));
    const atr = tr / (d.length - 1), prevC = d[d.length - 1][4], last = today[today.length - 1][4];
    mv.push({ s, pct: (last / prevC - 1) * 100, x: (last - prevC) / atr });
  }
  mv.sort((a, b) => Math.abs(b.x) - Math.abs(a.x));
  const top = mv.filter(m => Math.abs(m.x) >= 0.75);
  out.movers = [];
  console.log(`\n▶ ٤) متحرّكو ${DAY} بقوّة (|الحركة من إغلاق أمس| ≥ ‎0.75×ATR‎ اليومي): ${top.length}`);
  for (const m of top) {
    const d = m.pct > 0 ? 1 : -1;
    let firstIn = null, anyIn = null;
    for (const st of steps) for (const r of st.list) if (r.s === m.s) {
      anyIn ||= { at: st.T, scan: r.scan, sd: r.sd };
      if (r.sd === d && !firstIn && isFresh(r, keyK(st.T))) firstIn = { at: st.T, scan: r.scan };
    }
    const fired = (R.fired[m.s + "|" + DAY] || []).map(x => x[1] + (x[2] === -1 ? "▼" : "▲"));
    const fu = [...new Set(fired)];
    const why = firstIn ? `ظهرت جديدةً ${new Date(firstIn.at).toISOString().slice(11, 16)}Z (${firstIn.scan})`
      : anyIn ? `في القائمة لكن لا جديدة في جهة الحركة (${anyIn.scan} ${dirW(anyIn.sd)})`
      : !fu.length ? "لم يُطلق أيَّ شرطٍ اليوم"
      : `أُطلق ${fu.join(" ")} ثم سقط بالاتجاه/التعارض/قفل دورة الحياة`;
    /* لماذا لم يُطلق «توافق الفريمات»؟ الفريمات الأربعة عند آخر إغلاق —
       واليوميّ من شمعةٍ **مغلقة** (أمس) فلا يرى حركة اليوم حتى يُغلق */
    const lastSt = steps[steps.length - 1];
    const tf = lastSt && lastSt.tfs ? lastSt.tfs[m.s] : null;
    const tfTxt = tf ? ` · 15د/س/4س/ي = ${tf.map(x => x == null ? "—" : Math.round(x)).join("/")}` : "";
    out.movers.push({ ...m, why, fired: fu, tf });
    console.log(`  ${m.s.padEnd(5)} ${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(2)}% (${m.x.toFixed(2)}×ATR) — ${why}${tfTxt}`);
  }
}

const J = arg("json", null);
if (J) fs.writeFileSync(J, JSON.stringify(out, null, 1));
