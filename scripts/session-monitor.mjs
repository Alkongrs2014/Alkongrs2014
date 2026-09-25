#!/usr/bin/env node
/* =====================================================================
   مراقب الجلسة — يشهد على ما يراه المستخدم لا على ما نظنّه.

   كل دقيقة يقرأ لقطة الفرص **المنشورة** (raw.githubusercontent) والمحلية،
   ويسجّل مفتاح الشمعة والبصمة. والعلّة الوحيدة التي يبحث عنها: **بصمةٌ
   تتغيّر والمفتاح ثابت** — أي أن شيئاً تبدّل بلا شمعةٍ مغلقة. ويعدّ معها
   رفوضَ البوّابة في سجلّ التدقيق («البصمة تغيّرت داخل نفس الشمعة») لأنها
   تعني أن **الحساب** تحرّك ولو لم يُنشر.

   وعند كل مفتاحٍ جديد يحفظ اللقطة كاملة وإغلاقات الخمسين، فيُبنى منها
   تقرير ما بعد الإغلاق: متى ظهرت كل فرصة وبأيّ سعر وماذا حدث بعدها.

   node scripts/session-monitor.mjs [--minutes=30] [--until=2026-09-25T20:05:00Z]
   يخرج بعد المقطع (كي يُراجَع ما جرى) ويُستأنف بتشغيلٍ جديد — الحالة
   في الملفّات لا في الذاكرة.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const MINUTES = Number(arg("minutes", "30"));
const UNTIL = Date.parse(arg("until", "2026-09-25T20:10:00Z"));
const DAY = new Date().toISOString().slice(0, 10);
const DIR = path.join(DATA, ".monitor", DAY);
fs.mkdirSync(path.join(DIR, "snap"), { recursive: true });
const REMOTE = "https://raw.githubusercontent.com/Alkongrs2014/Alkongrs2014/data/opportunities.json";

const rd = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const log = (o) => fs.appendFileSync(path.join(DIR, "ticks.jsonl"), JSON.stringify(o) + "\n");
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16) + "Z";

async function remote() {
  try {
    const r = await fetch(`${REMOTE}?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { err: "HTTP " + r.status };
    const j = await r.json();
    return { k: j.candleKey, h: j.rowsHash, g: j.generatedAt, n: j.count };
  } catch (e) { return { err: e.message }; }
}

const state = rd(path.join(DIR, "state.json")) || { seen: {}, anomalies: [], rejects: 0, lastLogT: Date.now() };
const start = Date.now();
const stopAt = Math.min(UNTIL, start + MINUTES * 60e3);
console.log(`▶ مراقبة ${hhmm(start)} → ${hhmm(stopAt)}`);

while (Date.now() < stopAt) {
  const t = Date.now();
  const loc = rd(path.join(DATA, "opportunities.json"));
  const L = loc ? { k: loc.candleKey, h: loc.rowsHash, g: loc.generatedAt, n: loc.count } : null;
  const R = await remote();

  for (const [src, x] of [["local", L], ["remote", R]]) {
    if (!x || x.err || !Number.isFinite(x.k)) continue;
    const prev = state.seen[src];
    if (prev && prev.k === x.k && prev.h !== x.h) {
      const a = { t, src, k: x.k, from: prev.h, to: x.h };
      state.anomalies.push(a);
      console.log(`  ✗ ${src}: البصمة تغيّرت داخل شمعة ${hhmm(x.k * 1000)} (${prev.h} → ${x.h})`);
    }
    if (prev && x.k < prev.k) {
      state.anomalies.push({ t, src, back: true, k: x.k, prevK: prev.k });
      console.log(`  ✗ ${src}: المفتاح إلى الوراء ${hhmm(x.k * 1000)} < ${hhmm(prev.k * 1000)}`);
    }
    if (!prev || x.k !== prev.k) {
      console.log(`  • ${src}: شمعة ${hhmm(x.k * 1000)} · ${x.n} صفّاً · ${x.h} (${hhmm(t)})`);
      if (src === "local" && loc) {
        fs.writeFileSync(path.join(DIR, "snap", `opp-${x.k}.json`), JSON.stringify(loc));
        const sum = rd(path.join(DATA, "summary.json"));
        if (sum) fs.writeFileSync(path.join(DIR, "snap", `sum-${x.k}.json`),
          JSON.stringify({ t, rows: sum.rows.map(r => ({ s: r.s, p: r.p, pc: r.pc, cbar: r.cbar, chg: r.chg, score: r.score, band: r.band, tf: r.tfScore })) }));
      }
    }
    state.seen[src] = { k: x.k, h: x.h };
  }

  // رفوضُ البوّابة منذ آخر قراءة — الحساب تحرّك داخل الشمعة
  const aud = rd(path.join(DATA, "opportunities-log.json")) || [];
  for (const e of aud) {
    if (!(e.t > state.lastLogT)) continue;
    state.lastLogT = e.t;
    if (e.action === "hold" && /مرفوضة/.test(e.why || "")) {
      state.rejects++;
      state.rejSeen = state.rejSeen || {};
      if (!state.rejSeen[e.rowsHash]) { state.rejSeen[e.rowsHash] = 1; console.log(`  ⚠ رفضُ بوّابة: ${e.why}`); }
    }
  }

  log({ t, local: L, remote: R });
  fs.writeFileSync(path.join(DIR, "state.json"), JSON.stringify(state));
  const wait = 60e3 - (Date.now() - t);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}
console.log(`■ انتهى المقطع · شذوذ منشور/محلي: ${state.anomalies.length} · رفوض البوّابة: ${state.rejects}`);
