/* سوقٌ اصطناعي بتقويم نيويورك الحقيقي لاختبارات المحرّك V3 — شموع 15د الرسمية
   ويوميّها، بأنظمة ميلٍ متبدّلة كي تقع أحداث قمة/قاع أمس وانقلابات المتوسطات. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SES = require("../../stocks/session.js");

export function rngOf(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function synth(seed, days = 240, start = "2025-01-02T12:00:00Z") {
  const r = rngOf(seed), b15 = [], b1d = [];
  let px = 100, drift = 0;
  for (let t = Date.parse(start); b1d.length < days; t += 86400000) {
    const w = SES.sessionWindows(t);
    if (!w.regular) continue;
    if (r() < 0.12) drift = (r() - 0.5) * 0.004;
    let o = null, h = -Infinity, l = Infinity, c = null;
    for (let s = w.regular.start; s < w.regular.end; s += 900000) {
      const bo = px * (1 + (r() - 0.5) * 0.002), bc = bo * (1 + (r() - 0.5) * 0.008 + drift);
      const bh = Math.max(bo, bc) * (1 + r() * 0.002), bl = Math.min(bo, bc) * (1 - r() * 0.002);
      b15.push({ t: s, o: bo, h: bh, l: bl, c: bc, v: 1000 + Math.floor(r() * 5000) });
      o ??= bo; h = Math.max(h, bh); l = Math.min(l, bl); c = bc; px = bc;
    }
    b1d.push({ t: w.regular.start, o, h, l, c, v: 1 });
  }
  return { b15, b1d };
}
/* يكتب السلاسل بصيغة مخزن SIP (`bars-store.mjs`) كي يقرأها build() كما يقرأ الإنتاج */
export function writeStore(fs, path, dir, sym, { b15, b1d }, uptoMs = Infinity) {
  const d = path.join(dir, sym);
  fs.mkdirSync(d, { recursive: true });
  const pack = (b) => [Math.round(b.t / 1000), b.o, b.h, b.l, b.c, b.v];
  for (const [tf, arr] of [["15m", b15], ["1d", b1d]])
    fs.writeFileSync(path.join(d, tf + ".json"), JSON.stringify({ src: "alpaca_sip", tf, adj: "split",
      fetchedAt: 0, histFrom: 0, c: arr.filter((b) => b.t < uptoMs).map(pack) }));
}
