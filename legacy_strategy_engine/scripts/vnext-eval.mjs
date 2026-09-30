#!/usr/bin/env node
/* =====================================================================
   مقارنة المحرّك الحالي بـVNEXT على الأرشيف اليومي — بلا نظرٍ إلى المستقبل.

   المواصفة والعتبات في `docs/VNEXT_SPEC.md` وكُتبت قبل هذا الملف. هنا
   قياسٌ فقط: نفس `snapshots` و`simulatePlan` (قواعد المحاكاة الستّ
   والتكاليف) و`planPair` التي يقيس بها الأرشيف، فلا مسطرتان.

   المدخلات: `data/.archive/replay-cache/*.json` (يومي 5 سنوات للخمسين) و
   SPY يومي (طلبٌ واحد). الإشارة عند إغلاق الشمعة `i`، والمحاكاة من `i+1`.

   node scripts/vnext-eval.mjs [--out reports/vnext-daily.json]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import "./lib/env.mjs";
import { fetchChart } from "./lib/yahoo.mjs";
import { snapshots, simulatePlan, regimeMap, trimArtifacts } from "./backtest.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { SCANS, forcedDir } = require("../stocks/scans.js");
const { levelsFrom, planPair, planDirOf, validatePlan } = require("../stocks/plan.js");

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : d; };
const OUTF = path.resolve(arg("out", path.join(ROOT, "reports", "vnext-daily.json")));
const CACHE = path.join(ROOT, "data", ".archive", "replay-cache");
const WARMUP = 260, COOLDOWN = 5, SPAN = 65, OOS_FRAC = 0.3;

/* ── ثوابت المواصفة §2.4 و§2.6 و§3 — لا تُعدَّل بعد الاختبار ── */
export const GATE = { t1R: 1.0, primR: 1.5 };
export const GRADE_A_R = 2.0;
export const ACCEPT = { nOOS: 100, pfOOS: 1.1 };

export function gateOk(p) {
  if (!p || !Array.isArray(p.targets) || !p.targets.length) return false;
  if (!(p.targets[0].rr >= GATE.t1R)) return false;
  return Number.isFinite(p.rr) && p.rr >= GATE.primR;
}
export const gradeOf = (p) => (p && p.rr >= GRADE_A_R ? "A" : "B");

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "stocks", "symbols.json"), "utf8"));
const TEST = SCANS.filter(s => s.btTest);

function stats(list) {
  const act = list.filter(x => x.sim && x.sim.activated && Number.isFinite(x.sim.ret));
  const r = act.map(x => x.sim.ret);
  const pos = r.filter(x => x > 0).reduce((a, b) => a + b, 0);
  const neg = -r.filter(x => x < 0).reduce((a, b) => a + b, 0);
  const stops = act.filter(x => x.sim.st === "stop");
  const falseN = stops.filter(x => !(x.sim.mfe >= 0.5 * x.risk)).length;
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const r2 = (x) => Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
  return {
    signals: list.length, act: act.length,
    exp: r2(mean(r)), pf: neg > 0 ? r2(pos / neg) : (pos > 0 ? 99 : null),
    win: act.length ? r2(r.filter(x => x > 0).length / act.length * 100) : null,
    stop: act.length ? r2(stops.length / act.length * 100) : null,
    falsePct: act.length ? r2(falseN / act.length * 100) : null,
    t1: act.length ? r2(act.filter(x => x.sim.hit[0] !== null).length / act.length * 100) : null,
    mfe: r2(mean(act.map(x => x.sim.mfe))), mae: r2(mean(act.map(x => x.sim.mae))),
    maeMed: r2((() => { const a = act.map(x => x.sim.mae).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; })()),
    sumRet: r2(r.reduce((a, b) => a + b, 0))
  };
}

async function main() {
  const spy = (await fetchChart("SPY", { range: "5y", interval: "1d" })).candles;
  const regime = regimeMap(spy);
  const ts = spy.map(x => x.t);
  const cut = ts[0] + (ts[ts.length - 1] - ts[0]) * (1 - OOS_FRAC);
  const days = (from, to) => spy.filter(x => x.t >= from && x.t < to).length;
  const sessIS = days(ts[0] + 0, cut), sessOOS = days(cut, Infinity);

  const cur = [], nxt = [];
  let planFails = 0;
  for (const meta of cfg.symbols) {
    const f = path.join(CACHE, meta.s + ".json");
    if (!fs.existsSync(f)) { console.warn("بلا ذاكرة:", meta.s); continue; }
    const k = trimArtifacts(JSON.parse(fs.readFileSync(f, "utf8")).d1).k;
    if (k.length < WARMUP + SPAN) continue;
    const snaps = snapshots({ s: meta.s, sec: meta.sec }, k);
    const levelsAt = new Map();
    const inAt = (i) => {
      if (levelsAt.has(i)) return levelsAt.get(i);
      let v = null;
      try {
        const lv = levelsFrom({ k4h: null, k1d: k.slice(Math.max(0, i - 125), i + 1), px: k[i].c,
          a: snaps[i].a, w52h: snaps[i].row.w52h, w52l: snaps[i].row.w52l, now: k[i].t });
        if (lv) v = { px: lv.px, atr: lv.atr, resAll: lv.resAll, supAll: lv.supAll };
      } catch { v = null; }
      levelsAt.set(i, v);
      return v;
    };
    const planOf = (i, d) => {
      const e = inAt(i); if (!e) return null;
      const p = planPair(e, d).a;
      if (!p || validatePlan(p).length) { planFails++; return null; }
      return p;
    };
    const lastCur = {}, busyNext = {};
    for (let i = WARMUP; i < k.length - SPAN; i++) {
      const sn = snaps[i]; if (!sn) continue;
      const isOOS = k[i].t >= cut;
      const rg = regime ? regime.get(Math.floor(k[i].t / 86400000)) || null : null;
      for (const scan of TEST) {
        let hit = false;
        try { hit = !!scan.btTest(sn.row, sn.f, { secMed: {} }); } catch { hit = false; }
        if (!hit) continue;
        /* الحالي: تهدئة ٥ شمعات، والاتجاه من النتيجة الفنية مع فرض الشرط (planDirOf) */
        if (lastCur[scan.id] === undefined || i - lastCur[scan.id] >= COOLDOWN) {
          lastCur[scan.id] = i;
          const d = planDirOf(sn.row.score, forcedDir(scan.id));
          const p = planOf(i, d);
          const sim = p ? simulatePlan(k, i, p) : null;
          cur.push({ s: meta.s, id: scan.id, i, t: k[i].t, oos: isOOS, rg, d, sim,
                     risk: p ? p.stopPct : null });
        }
        /* VNEXT: اتجاه الإعداد، بوّابة الجودة، ولا تداخل لنفس المفتاح */
        const d2 = scan.dir === -1 ? -1 : 1;
        const key = scan.id + "|" + d2;
        if (busyNext[key] !== undefined && i <= busyNext[key]) continue;
        const p2 = planOf(i, d2);
        if (!gateOk(p2)) continue;
        const sim2 = simulatePlan(k, i, p2);
        if (!sim2) continue;
        busyNext[key] = i + (sim2.activated ? sim2.waitBars + sim2.heldBars : 5);
        nxt.push({ s: meta.s, id: scan.id, i, t: k[i].t, oos: isOOS, rg, d: d2, sim: sim2,
                   risk: p2.stopPct, rr: p2.rr, grade: gradeOf(p2) });
      }
    }
  }

  /* §3 — قبول كل إعداد */
  const perSetup = {};
  for (const scan of TEST) {
    const a = nxt.filter(x => x.id === scan.id);
    const IS = stats(a.filter(x => !x.oos)), OOS = stats(a.filter(x => x.oos));
    const ok = OOS.act >= ACCEPT.nOOS && OOS.exp > 0 && OOS.pf >= ACCEPT.pfOOS && IS.exp > 0;
    perSetup[scan.id] = { dir: scan.dir === -1 ? -1 : 1, IS, OOS, accepted: ok,
                          curIS: stats(cur.filter(x => x.id === scan.id && !x.oos)),
                          curOOS: stats(cur.filter(x => x.id === scan.id && x.oos)) };
  }
  const accepted = Object.keys(perSetup).filter(id => perSetup[id].accepted);

  /* §2.5 — بوّابة السوق: تُعتمد إن رفعت PF خارج العيّنة للمقبولة مجتمعةً */
  const pool = nxt.filter(x => accepted.includes(x.id));
  const regOk = (x) => !x.rg || (x.d === 1 ? x.rg === "up" : x.rg === "dn");
  const noReg = stats(pool.filter(x => x.oos)), withReg = stats(pool.filter(x => x.oos && regOk(x)));
  const regimeAdopted = accepted.length > 0 && withReg.act > 0 && withReg.pf > noReg.pf;
  const final = pool.filter(x => !regimeAdopted || regOk(x));

  /* §2.6 — الدرجة A/B */
  const gA = (o) => stats(final.filter(x => x.oos === o && x.grade === "A"));
  const gB = (o) => stats(final.filter(x => x.oos === o && x.grade === "B"));
  const grades = { IS: { A: gA(false), B: gB(false) }, OOS: { A: gA(true), B: gB(true) } };
  const gradesAdopted = grades.IS.A.exp > grades.IS.B.exp && grades.OOS.A.exp > grades.OOS.B.exp;

  /* §4أ — المقارنة خارج العيّنة */
  const C = stats(cur.filter(x => x.oos)), N = stats(final.filter(x => x.oos));
  C.perSession = C.sumRet !== null ? Math.round(C.sumRet / sessOOS * 1000) / 1000 : null;
  N.perSession = N.sumRet !== null ? Math.round(N.sumRet / sessOOS * 1000) / 1000 : null;
  C.signalsPerSession = Math.round(C.signals / sessOOS * 100) / 100;
  N.signalsPerSession = Math.round(N.signals / sessOOS * 100) / 100;
  const daysWith = (arr) => new Set(arr.filter(x => x.oos).map(x => Math.floor(x.t / 86400000))).size;
  N.sessionsWithSignal = Math.round(daysWith(final) / sessOOS * 1000) / 10;
  C.sessionsWithSignal = Math.round(daysWith(cur) / sessOOS * 1000) / 10;
  const crit = {
    expPositive: N.exp > 0,
    expBeatsBy05: N.exp >= C.exp + 0.5,
    pf115: N.pf >= 1.15,
    stopMinus10: N.stop <= C.stop - 10,
    falseLower: N.falsePct < C.falsePct,
    perSessionNotLower: N.perSession >= C.perSession
  };
  const out = {
    at: new Date().toISOString(), spec: "docs/VNEXT_SPEC.md",
    window: { from: new Date(ts[0]).toISOString().slice(0, 10), oosFrom: new Date(cut).toISOString().slice(0, 10),
              to: new Date(ts[ts.length - 1]).toISOString().slice(0, 10), sessIS, sessOOS },
    symbols: cfg.symbols.length, planFails,
    perSetup, accepted, regime: { adopted: regimeAdopted, noReg, withReg },
    grades: { adopted: gradesAdopted, ...grades },
    current: { IS: stats(cur.filter(x => !x.oos)), OOS: C },
    vnext: { IS: stats(final.filter(x => !x.oos)), OOS: N },
    criteria: crit, pass: Object.values(crit).every(Boolean)
  };
  fs.mkdirSync(path.dirname(OUTF), { recursive: true });
  fs.writeFileSync(OUTF, JSON.stringify(out, null, 1));

  console.log(`النافذة ${out.window.from} → ${out.window.to} · خارج العيّنة من ${out.window.oosFrom} (${sessOOS} جلسة)`);
  console.log("الإعداد      IS exp/pf/n        OOS exp/pf/n/stop/false      الحالي OOS exp/pf/stop   مقبول");
  for (const [id, v] of Object.entries(perSetup))
    console.log(id.padEnd(9), `${v.IS.exp}/${v.IS.pf}/${v.IS.act}`.padEnd(18),
      `${v.OOS.exp}/${v.OOS.pf}/${v.OOS.act}/${v.OOS.stop}/${v.OOS.falsePct}`.padEnd(28),
      `${v.curOOS.exp}/${v.curOOS.pf}/${v.curOOS.stop}`.padEnd(22), v.accepted ? "✓" : "✗");
  console.log("المقبولة:", accepted.join(", ") || "لا شيء");
  console.log("بوّابة السوق:", regimeAdopted ? "معتمدة" : "مُسقطة", `PF ${noReg.pf} → ${withReg.pf}`);
  console.log("الدرجة A/B:", gradesAdopted ? "معتمدة" : "مُسقطة", JSON.stringify(grades.OOS.A.exp), "vs", JSON.stringify(grades.OOS.B.exp));
  console.log("الحالي OOS:", JSON.stringify(C));
  console.log("VNEXT  OOS:", JSON.stringify(N));
  console.log("المعايير §4أ:", JSON.stringify(crit), out.pass ? "PASS" : "FAIL");
}

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (IS_MAIN) main().catch(e => { console.error(e); process.exit(1); });
