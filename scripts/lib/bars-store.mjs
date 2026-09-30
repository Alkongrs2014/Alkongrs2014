/* =====================================================================
   مخزنُ شموع الأسهم — Alpaca SIP، ومنه تُبنى الفريمات كلُّها.

   كانت الشموع تُجلب من ياهو فريماً فريماً ورمزاً رمزاً (16 مساراً، ‎163‎
   ثانية لكل دورة تأكيد)، وكلُّ فريمٍ بصلاحيته، وكلُّ تشغيلٍ يعيد جلب
   ستين يوماً أو سنتين كاملتين. وصنفُ علّة «فقدان الفريم» كلُّه كان يعيش
   في الفجوة بين «ما يُجلب الآن» و«ما يُنقل من السابق».

   هنا: مخزنٌ واحد للشموع الخام، يُحدَّث **تزايدياً بطلب دفعةٍ واحد
   للكون** (حتى ‎200‎ رمز للطلب)، وكلُّ فريمٍ يُبنى منه في كل تشغيل.
   فلا فريمٌ يُنقل ولا فريمٌ يسقط، والكلفة لا تنمو بعدد الفريمات.

   وهو نفسه **مجموعةُ البيانات التاريخية** لمرحلة التحقّق التاريخي:
   مصدرُه `alpaca_sip` في اسم مجلّده، ولا يُخلط بملفّات ياهو القديمة.

   ---------------------------------------------------------------------
   **لا شيء هنا يعرف عدد الرموز.** الكون يُمرَّر، والدفعات بـ`caps.batchSize`،
   ورمزٌ جديد يُملأ تاريخُه كاملاً في أوّل تشغيلٍ يراه. توسيعُ الكون من
   خمسين إلى آلاف مسألةُ قائمةٍ أطول لا شيفرةٍ أخرى.

   الشكل على القرص: `data/bars/alpaca_sip/{SYM}/{tf}.json`
     { src, tf, adj, fetchedAt, c: [[t_sec, o, h, l, c, v], …] }
   لا يُنشر (`NO_PUBLISH`) ولا يُنسخ في لقطات الفاحصين (`snapshot.mjs`):
   الفاحص يقرأ ما بُني منه في `sym/`، لا الخام.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";

export const STORE_SRC = "alpaca_sip";
/* التعديل للتقسيم لا للتوزيعات — **مطابقٌ لياهو**: `v8/chart` يعطي OHLC
   معدَّلاً للتقسيم، والإغلاق المعدَّل للتوزيعات حقلٌ منفصل لا نقرؤه.
   قِيس على عشرة رموز × 40 يوماً: الفرق اليومي ≤ ‎0.006%‎. */
export const ADJUSTMENT = "split";

/* عمقُ كلّ فريمٍ خام، وتداخلُ التحديث التزايدي.
   · ‎15د‎ سنة: الساعة و‎4h‎ تُجمَّعان منه. ‎4h‎ المحفوظة ‎260‎ شمعة = ‎130‎
     يوم تداول، فسنةٌ تعطيها كاملة بهامشٍ واسع (ومدى ياهو البديل للساعة
     كان سنةً أصلاً — `422` على السنتين).
   · اليومي خمس سنوات — المدى نفسه الذي كان يُطلب من ياهو.
   · التداخل يومٌ لـ‎15د‎ وخمسة أيام لليومي: كلُّ تشغيلٍ يعيد آخر يوم،
     فيلتقط مراجعةَ المزوّد لشمعاتٍ أُغلقت للتوّ (مزادُ الإغلاق، صفقاتٌ
     متأخّرة) بلا مسارٍ منفصل «بعد الإغلاق». */
export const SPEC = {
  "15m": { days: Number(process.env.BARS_15M_DAYS || 365), overlapMs: 86400e3, barMs: 15 * 60e3 },
  "1d":  { days: Number(process.env.BARS_1D_DAYS || 1830), overlapMs: 5 * 86400e3, barMs: 86400e3 }
};

export function storeDir(dataDir) { return path.join(dataDir, "bars", STORE_SRC); }

const pack = (b) => [Math.round(b.t / 1000), b.o, b.h, b.l, b.c, b.v];
const unpack = (a) => ({ t: a[0] * 1000, o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] });

function fileOf(dir, sym, tf) { return path.join(dir, sym, `${tf}.json`); }

export function readSeries(dir, sym, tf) {
  try {
    const j = JSON.parse(fs.readFileSync(fileOf(dir, sym, tf), "utf8"));
    if (j.src !== STORE_SRC) return null;            // مصدرٌ آخر لا يُقرأ كأنه هذا
    return { fetchedAt: j.fetchedAt, histFrom: j.histFrom ?? null, bars: (j.c || []).map(unpack) };
  } catch { return null; }
}

/* كتابةٌ ذرّية — ملفٌّ مؤقّت ثم `rename`. كتابةٌ مباشرة تترك نافذةً يقرأ
   فيها مستهلكٌ نصفَ ملفّ. */
function writeSeries(dir, sym, tf, bars, fetchedAt, histFrom) {
  const f = fileOf(dir, sym, tf);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ src: STORE_SRC, tf, adj: ADJUSTMENT, fetchedAt, histFrom, c: bars.map(pack) }));
  fs.renameSync(tmp, f);
}

/* الشمعة الصالحة وحدها: أرقامٌ منتهية واتّساقٌ داخلي. نفس شرط
   `chartCandles` في ياهو ونفس شرط الطبيب (INV-04) — شمعةٌ مشوَّهة تُسقط
   ولا تُصلح، ويُعدّ عددُها. */
export function validBar(b) {
  if (![b.t, b.o, b.h, b.l, b.c].every(Number.isFinite)) return false;
  if (!(b.l > 0)) return false;
  if (!(b.h >= Math.max(b.o, b.c) - 1e-9 && Math.min(b.o, b.c) >= b.l - 1e-9)) return false;
  return Number.isFinite(b.v) && b.v >= 0;
}

/* =====================================================================
   الدمج — بالختم لا بالموضع، والجديد يغلب.

   ويُعَدّ ما تغيّر من شمعاتٍ **مغلقة** (`revised`): مراجعةُ المزوّد
   لشمعةٍ مكتملة حدثٌ مشروع يُسجَّل، وتغيّرُ الشمعة الجارية ليس حدثاً.
   وإن كانت كلُّ المتداخلة المغلقة مختلفةً بنسبةٍ **ثابتة** فهذا تقسيمُ
   أسهم: التاريخ المخزَّن كلُّه بمقياسٍ آخر، ويُعاد جلبُه كاملاً.
   ===================================================================== */
export function mergeBars(oldBars, fresh, { barMs, settledBefore }) {
  /* «مغلقة» = كانت مغلقةً **حين خُزّنت** (`settledBefore` = لحظة الجلب
     السابق). شمعةٌ خُزّنت جاريةً ثم اكتملت ليست مراجعة — عدُّها كان
     يُظهر «37 مراجعة» في دورةٍ لم يراجع فيها المزوّد شيئاً. */
  const byT = new Map(oldBars.map(b => [b.t, b]));
  let revised = 0;
  const ratios = [];
  for (const b of fresh) {
    const o = byT.get(b.t);
    const closed = b.t + barMs <= settledBefore;
    if (o && closed) {
      if (o.o !== b.o || o.h !== b.h || o.l !== b.l || o.c !== b.c || o.v !== b.v) revised++;
      if (o.c > 0 && b.c > 0) ratios.push(b.c / o.c);
    }
    byT.set(b.t, b);
  }
  const bars = [...byT.values()].sort((a, b) => a.t - b.t);
  return { bars, revised, split: splitSuspect(ratios) };
}

/* نسبةٌ ثابتة بعيدة عن الواحد على كل المتداخلة = تقسيم. شمعةٌ واحدة
   مختلفة مراجعةٌ لا تقسيم، فالشرط على الوسيط **والأطراف معاً**. */
export function splitSuspect(ratios) {
  if (ratios.length < 3) return false;
  const s = ratios.slice().sort((a, b) => a - b);
  const med = s[s.length >> 1];
  if (Math.abs(med - 1) < 0.02) return false;
  return s.every(r => Math.abs(r / med - 1) < 0.01);
}

/* =====================================================================
   التحديث — تزايديٌّ لمن له تاريخ، وكاملٌ لمن لا تاريخ له.

   الرموز تُجمَّع بنقطة البداية نفسها (مقرَّبةً إلى اليوم) فيذهب كلُّ
   جمعٍ في طلبات دفعة. وفي التشغيل العادي كلُّها بتاريخ ⇒ جمعٌ واحد ⇒
   طلبٌ واحد للكون.

   **فشلُ الطلب يُرمى ولا يُبتلع**: مستدعٍ يكتب ملفّات الرموز من مخزنٍ
   لم يُحدَّث يعرض أمسَ كأنه اليوم. ورمزٌ لم يعد في ردّ المزوّد (موقوف،
   مشطوب) يُعدّ ويُسمّى — والمستدعي يعلنه قديماً لا حديثاً.
   ===================================================================== */
export async function updateStore({ dir, symbols, provider, now = Date.now(), tfs = Object.keys(SPEC), log = () => {} }) {
  const stats = { requests0: provider.alStats?.requests || 0, bars: 0, revised: 0, invalid: 0,
                  splits: [], backfilled: [], missing: {}, lastBar: {} };
  const out = {};
  for (const tf of tfs) {
    const spec = SPEC[tf];
    const floor = now - spec.days * 86400e3;
    const state = new Map(), hist = new Map(), prevFetch = new Map();
    const groups = new Map();
    for (const s of symbols) {
      const cur = readSeries(dir, s, tf);
      const bars = cur?.bars || [];
      /* تاريخٌ لم يُطلب بعمقه (رمزٌ جديد، أو عمقٌ رُفع) يُملأ كاملاً.
         والحكم ببداية **ما طُلب** (`histFrom`) لا بأوّل شمعةٍ وصلت: رمزٌ
         أُدرج قبل شهرين أوّلُ شمعاته حديثةٌ أبداً، والحكمُ بها يعيد جلب
         سنةٍ كاملة في كل تشغيل. */
      const full = !bars.length || !(cur.histFrom <= floor + 7 * 86400e3);
      const from = full ? floor : bars[bars.length - 1].t - spec.overlapMs;
      if (full) stats.backfilled.push(s);
      hist.set(s, full ? floor : cur.histFrom);
      state.set(s, bars);
      prevFetch.set(s, cur?.fetchedAt || 0);
      const key = Math.floor(from / 86400e3) * 86400e3;
      (groups.get(key) || groups.set(key, []).get(key)).push(s);
    }
    const fetched = new Map();
    for (const [from, syms] of groups) {
      /* جمعُ التعبئة الكاملة بدفعاتٍ أصغر: سنةٌ من ‎15د‎ لرمزٍ واحد ~16 ألف
         شمعة، وصفحةُ Alpaca عشرة آلاف لكل الرموز — فدفعةُ مئتين تعني آلاف
         الصفحات في طلبٍ واحد لا ينتهي قبل مهلة المهمّة. */
      const size = (now - from > 30 * 86400e3) ? 10 : (provider.caps?.batchSize || 200);
      for (let i = 0; i < syms.length; i += size) {
        const part = syms.slice(i, i + size);
        const m = await provider.getCandlesBatch(part, tf, { from, feed: "sip", adjustment: ADJUSTMENT, maxPages: 2000 });
        for (const s of (m.__skipped || [])) stats.missing[s] = "رفضه المزوّد";
        delete m.__skipped;
        for (const [s, arr] of Object.entries(m)) fetched.set(s, arr);
      }
    }
    const settledBefore = now - 60e3;
    const refetch = [];
    for (const s of symbols) {
      const raw = fetched.get(s) || [];
      const fresh = raw.filter(validBar);
      stats.invalid += raw.length - fresh.length;
      stats.bars += fresh.length;
      if (!raw.length && !state.get(s).length) { stats.missing[s] ||= "لا شموع"; continue; }
      const { bars, revised, split } = mergeBars(state.get(s), fresh, { barMs: spec.barMs,
        settledBefore: Math.min(settledBefore, (prevFetch.get(s) || 0) - 60e3) });
      if (split) { refetch.push(s); continue; }
      stats.revised += revised;
      const kept = bars.filter(b => b.t >= floor);
      writeSeries(dir, s, tf, kept, now, Math.max(hist.get(s), floor));
      (out[s] ||= {})[tf] = kept;
    }
    /* تقسيم: التاريخ كلُّه يُعاد من المزوّد بمقياسه الجديد. رمزاً رمزاً
       لأن الحالة نادرة (أيامٌ في السنة لكل الكون). */
    for (const s of refetch) {
      stats.splits.push(`${s}/${tf}`);
      log(`  ⓘ ${s} ${tf}: نسبةٌ ثابتة على المتداخلة — تقسيم؛ يُعاد التاريخ كاملاً`);
      const m = await provider.getCandlesBatch([s], tf, { from: floor, feed: "sip", adjustment: ADJUSTMENT, maxPages: 2000 });
      const kept = (m[s] || []).filter(validBar);
      writeSeries(dir, s, tf, kept, now, floor);
      (out[s] ||= {})[tf] = kept;
    }
    stats.lastBar[tf] = Math.max(0, ...Object.values(out).map(o => o[tf]?.length ? o[tf][o[tf].length - 1].t : 0));
  }
  stats.requests = (provider.alStats?.requests || 0) - stats.requests0;
  delete stats.requests0;
  return { bars: out, stats };
}
