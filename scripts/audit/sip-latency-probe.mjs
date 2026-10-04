#!/usr/bin/env node
/* =====================================================================
   قياس تأخّر Alpaca SIP عند المصدر — قراءةٌ فقط، لا يكتب في data/ ولا يمسّ المجدول.

   لكل حدّ شمعة 15د (:00/:15/:30/:45 نيويورك) داخل نافذة القياس: يستطلع نفس النقطة التي
   يستعملها المسار (`/v2/stocks/bars?feed=sip&timeframe=15Min`) كل ثانيتين من الحدّ حتى +6 دقائق،
   ويسجّل لكل رمز:
     avail  أوّل ظهورٍ للشمعة المنتهية للتوّ (ثوانٍ بعد إغلاقها)
     final  آخر تغيّرٍ في OHLCV رُصد خلال النافذة (متى استقرّت فعلاً)
   والرموز مزيجٌ من عالي السيولة ومنخفضها من الكون نفسه: الأقلّ تداولاً هو الذي قد تتأخّر شمعتُه.

     node scripts/audit/sip-latency-probe.mjs --from 2026-10-05T08:00Z --to 2026-10-05T15:00Z --out reports/sip-latency.json
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await import(path.join(ROOT, "scripts/lib/env.mjs").replace(/\\/g, "/").replace(/^([A-Za-z]:)/, "file:///$1"));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Date.parse(arg("from")), TO = Date.parse(arg("to")), OUT = path.resolve(ROOT, arg("out", "reports/sip-latency.json"));
const SYMS = (arg("syms", "AAPL,NVDA,MSFT,AMZN,TSLA,SPY,GEV,ALAB,RDDT,CRDO,DELL,STX")).split(",");
const H = { "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY };
const Q = 900000, WIN = 6 * 60000, STEP = 2000;
if (!(FROM < TO)) { console.error("--from/--to"); process.exit(2); }
const res = { syms: SYMS, from: new Date(FROM).toISOString(), to: new Date(TO).toISOString(), bounds: [] };
const save = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bars(start) {
  const u = new URL("https://data.alpaca.markets/v2/stocks/bars");
  u.searchParams.set("symbols", SYMS.join(",")); u.searchParams.set("timeframe", "15Min");
  u.searchParams.set("feed", "sip"); u.searchParams.set("adjustment", "split");
  u.searchParams.set("start", new Date(start).toISOString()); u.searchParams.set("limit", "1000");
  const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 120));
  return (await r.json()).bars || {};
}

let B = Math.ceil(Math.max(FROM, Date.now()) / Q) * Q;
console.log(`قياس ${SYMS.length} رمزاً · أوّل حدّ ${new Date(B).toISOString()} · حتى ${new Date(TO).toISOString()}`);
while (B <= TO) {
  if (Date.now() < B - 5000) await sleep(B - 5000 - Date.now());
  const barStart = B - Q, rec = { close: new Date(B).toISOString(), sym: {}, errors: 0 };
  const seen = {};
  while (Date.now() < B + WIN) {
    const t = Date.now();
    try {
      const all = await bars(barStart);
      for (const s of SYMS) {
        const b = (all[s] || []).find((x) => Date.parse(x.t) === barStart);
        if (!b) continue;
        const sig = [b.o, b.h, b.l, b.c, b.v, b.n].join("|");
        const st = (seen[s] ||= { first: null, last: null, sig: null, changes: 0 });
        if (st.first === null) st.first = t - B;
        if (st.sig !== null && st.sig !== sig) { st.changes++; st.last = t - B; }
        st.sig = sig;
      }
    } catch (e) { rec.errors++; }
    await sleep(Math.max(0, STEP - (Date.now() - t)));
  }
  for (const s of SYMS) {
    const st = seen[s];
    rec.sym[s] = st ? { avail: +(st.first / 1000).toFixed(1), final: +((st.last ?? st.first) / 1000).toFixed(1), changes: st.changes } : null;
  }
  res.bounds.push(rec);
  save();
  const av = Object.values(rec.sym).filter(Boolean);
  console.log(rec.close, "متاح بعد (وسيط)", av.length ? av.map((x) => x.avail).sort((a, b) => a - b)[av.length >> 1] : "—",
    "ث · استقرّ بعد (أقصى)", av.length ? Math.max(...av.map((x) => x.final)) : "—", "ث · بلا شمعة", SYMS.length - av.length);
  B += Q;
}
console.log("✓", OUT);
