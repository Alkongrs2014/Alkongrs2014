#!/usr/bin/env node
/* =====================================================================
   تقرير الجلسة — ما عرضه الموقع فعلاً، وماذا حدث بعده.

   يقرأ لقطات المراقب (`data/.monitor/<يوم>/snap/opp-*.json`) — أي ما
   نُشر للمستخدم عند كل إغلاق شمعة — وشمعات ‎15د‎ الرسمية لليوم من ملفّات
   الرموز، ويقيس لكل فرصة: متى ظهرت أوّل مرّة اليوم وبأيّ سعر وفي أيّ
   مرتبة، وأقصى حركةٍ معها وضدّها حتى الإغلاق، وأيّ أهدافها بُلغ.
   والقياس بعد الإغلاق من شمعاتٍ لاحقة — تقييمٌ لا قرار.

   node scripts/session-report.mjs [YYYY-MM-DD]
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { sessionOf, etParts } = require("../stocks/session.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY = process.argv[2] || new Date().toISOString().slice(0, 10);
const DIR = path.join(ROOT, "data", ".monitor", DAY);
const rd = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const nyDate = (ms) => etParts(ms).date;
const ksa = (ms) => new Date(ms + 3 * 3600e3).toISOString().slice(11, 16);
const pct = (x) => (x >= 0 ? "+" : "") + x.toFixed(2) + "%";

const snaps = fs.readdirSync(path.join(DIR, "snap")).filter(f => f.startsWith("opp-")).sort()
  .map(f => rd(path.join(DIR, "snap", f))).filter(d => nyDate(d.candleKey * 1000) === DAY && sessionOf(d.candleKey * 1000 + 1) === "REGULAR"
    || nyDate(d.candleKey * 1000) === DAY);
const cfg = rd(path.join(ROOT, "stocks", "symbols.json"));
const bars = {}, prevClose = {};
for (const m of cfg.symbols) {
  try {
    const rec = rd(path.join(ROOT, "data", "sym", m.s + ".json"));
    const c = rec.tf["15m"].c.map(a => ({ t: a[0] * 1000, o: a[1], h: a[2], l: a[3], c: a[4] }));
    bars[m.s] = c.filter(b => nyDate(b.t) === DAY);
    const prev = c.filter(b => nyDate(b.t) < DAY);
    prevClose[m.s] = prev.length ? prev[prev.length - 1].c : null;
  } catch { /* بلا ملف */ }
}

/* ── الفرص كما عُرضت ── */
const opps = {};
for (const d of snaps) {
  const best = {};
  for (const [id, rs] of Object.entries(d.scans)) for (const r of rs) if (!best[r.s] || r.q > best[r.s].q) best[r.s] = { ...r, scan: id };
  const order = Object.values(best).sort((a, b) => b.q - a.q);
  for (const [id, rs] of Object.entries(d.scans)) rs.forEach((r) => {
    if (!(r.sd === 1 || r.sd === -1)) return;
    const k = `${r.s}|${id}|${r.sd}|${r.since}`;
    const pos = order.findIndex(x => x.s === r.s);
    const tSeen = (d.candleKey + 900) * 1000;
    if (!opps[k]) opps[k] = { s: r.s, scan: id, sd: r.sd, since: r.since * 1000, seen: tSeen, px: r.pc, e: r.e, stp: r.st, t: r.t || [],
                              pos, bestPos: pos, n: r.n, q: r.q, newToday: nyDate(r.since * 1000) === DAY };
    const o = opps[k]; o.bestPos = Math.min(o.bestPos, pos); o.last = tSeen;
  });
}
const out = [];
for (const o of Object.values(opps)) {
  const w = (bars[o.s] || []).filter(b => b.t >= o.seen);
  if (!w.length) { out.push({ ...o, mfe: 0, mae: 0, hit: 0, stopped: false, end: 0 }); continue; }
  let mfe = 0, mae = 0, hit = 0, stopped = false;
  for (const b of w) {
    const fav = o.sd === 1 ? b.h : b.l, adv = o.sd === 1 ? b.l : b.h;
    mfe = Math.max(mfe, (fav / o.px - 1) * 100 * o.sd);
    mae = Math.min(mae, (adv / o.px - 1) * 100 * o.sd);
    if (!stopped && Number.isFinite(o.stp) && (adv - o.stp) * o.sd <= 0) stopped = true;
    if (!stopped) while (hit < o.t.length && (fav - o.t[hit]) * o.sd >= 0) hit++;
  }
  out.push({ ...o, mfe, mae, hit, stopped, end: (w[w.length - 1].c / o.px - 1) * 100 * o.sd });
}

/* ── حركة اليوم لكل سهم ── */
const moves = [];
for (const m of cfg.symbols) {
  const b = bars[m.s], pc = prevClose[m.s];
  if (!b || !b.length || !pc) continue;
  const close = b[b.length - 1].c, open = b[0].o;
  const mv = (close / pc - 1) * 100, gap = (open / pc - 1) * 100;
  const d = Math.sign(mv);
  const half = b.find(x => (x.c / pc - 1) * 100 * d >= Math.abs(mv) / 2);
  const mine = out.filter(o => o.s === m.s && o.sd === d);
  const first = mine.sort((a, b2) => a.seen - b2.seen)[0] || null;
  moves.push({ s: m.s, mv, gap, halfT: half ? half.t + 900e3 : null, shown: first ? { at: first.seen, scan: first.scan, pos: first.bestPos, px: first.px } : null,
               hi: (Math.max(...b.map(x => x.h)) / pc - 1) * 100, lo: (Math.min(...b.map(x => x.l)) / pc - 1) * 100 });
}

const res = { day: DAY, snaps: snaps.length, keys: snaps.map(d => d.candleKey), opps: out, moves };
fs.writeFileSync(path.join(DIR, "session-report.json"), JSON.stringify(res));

console.log(`\n▶ ${DAY} · لقطات منشورة: ${snaps.length} · فرص معروضة: ${out.length} (${out.filter(o => o.sd === 1).length}▲ · ${out.filter(o => o.sd === -1).length}▼) · جديدة اليوم: ${out.filter(o => o.newToday).length}`);
for (const o of out.sort((a, b) => a.bestPos - b.bestPos || a.seen - b.seen).slice(0, 25))
  console.log(`  #${o.bestPos + 1} ${o.s} ${o.sd === 1 ? "▲" : "▼"} ${o.scan} · ظهرت ${ksa(o.seen)} عند ${o.px} · معها ${pct(o.mfe)} · ضدّها ${pct(o.mae)} · الإغلاق ${pct(o.end)} · T${o.hit}${o.stopped ? " · وقف" : ""}${o.newToday ? "" : " · قديمة"}`);
console.log(`\n▶ حركات ≥2%:`);
for (const x of moves.filter(x => Math.abs(x.mv) >= 2).sort((a, b) => Math.abs(b.mv) - Math.abs(a.mv)))
  console.log(`  ${x.s} ${pct(x.mv)} (فجوة ${pct(x.gap)}) · منتصفها ${x.halfT ? ksa(x.halfT) : "—"} · ${x.shown ? `عُرضت ${ksa(x.shown.at)} (${x.shown.scan} #${x.shown.pos + 1})` : "لم تُعرض"}`);
