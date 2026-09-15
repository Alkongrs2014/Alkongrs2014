#!/usr/bin/env node
/* =====================================================================
   تدقيق الفرص الفائتة — Missed Opportunities Audit.

   ---------------------------------------------------------------------
   **أخطرُ ما في هذا الملفّ أن يكون سهلاً.**

   الطريقة البديهية: انظر أيُّ الأسهم ارتفع أمس، ثم قل «كان يجب أن
   نلتقطه». وهي تقيس شيئاً واحداً — قدرتَنا على قراءة الماضي — وتعطي
   دائماً نتيجةً جميلة. هذا هو انحياز الناجين (Survivorship Bias)
   بتقريرٍ أنيق.

   فالتقرير هنا مقيَّدٌ بثلاثة شروط:

   ١) **الفرصة تُعرَّف قبل رؤية النتيجة**، وبمقياس السهم نفسه:
      حركةٌ تتجاوز ‎1.5×ATR‎ اليومي تبدأ في الجلسة الممتدة. و‎+2%‎ في
      سهمٍ مداه اليومي ‎4%‎ ليست حدثاً، و‎+2%‎ في سهمٍ مداه ‎0.8%‎
      حدثٌ — وعتبةٌ مئوية واحدة للجميع تخلط الاثنين.

   ٢) **المقام هو الكون كلُّه لا الرابحون**: كلُّ رمزٍ مُسح يدخل
      الحساب. فتخرج معه نسبةُ الإيجابيات الكاذبة من **نفس** التشغيل —
      إشاراتٌ أُطلقت ولم تتبعها حركة. نسبةُ اكتشافٍ بلا نسبة إيجابياتٍ
      كاذبة رقمٌ لا معنى له: يكفي أن نُطلق إشارةً على كل رمزٍ كل دقيقة
      لنبلغ ‎100%‎ اكتشاف.

   ٣) **لحظة الاكتشاف من إعادة تشغيلٍ بلا نظرٍ إلى المستقبل** —
      `replay.mjs` بساعته الافتراضية. فـ«أوّل لحظة كان يمكن اكتشافها
      فيها» تعني: بالمعلومات التي كانت متاحة **عندها**.

     node scripts/audit-missed.mjs --date=2026-09-14
     node scripts/audit-missed.mjs --check
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./lib/env.mjs";
import * as PROV from "./providers/index.mjs";
import { sessionOf, sessionWindows, ksaTime, isRegularBar } from "./lib/session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const argOf = (k, d = null) => {
  const a = args.find(x => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const OUT = path.resolve(argOf("out", path.join(ROOT, "data")));

/* عتبةُ «حدث» — بمقياس السهم لا بنسبةٍ ثابتة */
const MOVE_ATR = 1.5;
/* وبدايةُ الحركة: أوّل لحظةٍ تجاوزت فيها نصفَ العتبة واستمرّت إليها.
   بلا شرط الاستمرار يصير كلُّ تذبذبٍ «بدايةَ حركة». */
const START_ATR = 0.5;

const pct = (a, b) => (b > 0 ? (a - b) / b * 100 : null);
const r2 = (v) => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;

/* =====================================================================
   استخراج الفرص من بيانات اليوم — بلا علمٍ بما فعله الماسح.

   الفصل مقصود: لو بُنيت قائمة الفرص من الإشارات لصار التقرير يقيس
   «هل اكتشفنا ما اكتشفناه؟». تُبنى من **السعر وحده**، ثم تُقابَل
   بالإشارات.
   ===================================================================== */
export function findOpportunities(sym, k5, atr, prevClose, win) {
  if (!(atr > 0) || !(prevClose > 0) || !k5.length) return [];
  const thr = MOVE_ATR * atr, startThr = START_ATR * atr;
  const out = [];

  for (const dir of [1, -1]) {
    /* أقصى امتدادٍ في هذا الاتجاه عن إغلاق الأمس */
    let peak = 0, peakAt = null, peakPx = prevClose;
    for (const b of k5) {
      const ext = dir > 0 ? (b.h - prevClose) : (prevClose - b.l);
      if (ext > peak) { peak = ext; peakAt = b.t; peakPx = dir > 0 ? b.h : b.l; }
    }
    if (peak < thr) continue;                       // ليست حدثاً بمقياس السهم

    /* بدايةُ الحركة: أوّل شمعةٍ تجاوزت نصفَ العتبة **ولم يرجع** السعر
       تحتها قبل بلوغ العتبة كاملة. هذا يمنع عدّ تذبذبٍ عابر بدايةً. */
    let startAt = null, startPx = null;
    for (const b of k5) {
      if (b.t > peakAt) break;
      const ext = dir > 0 ? (b.h - prevClose) : (prevClose - b.l);
      if (startAt === null && ext >= startThr) { startAt = b.t; startPx = b.c; }
      else if (startAt !== null && ext < 0) { startAt = null; startPx = null; }   // ارتدّ عكسياً
    }
    if (startAt === null) continue;

    const sess = sessionOf(startAt);
    out.push({
      sym, dir, sess,
      moveStart: startAt, startPx: r2(startPx),
      peakAt, peakPx: r2(peakPx),
      prevClose: r2(prevClose),
      movePct: r2(pct(peakPx, prevClose) * dir),
      moveAtr: r2(peak / atr),
      /* الحركة التي بدأت في الجلسة الممتدة هي موضوع هذا التقرير */
      startedExtended: sess === "PRE" || sess === "AFTER"
    });
  }
  return out;
}

/* =====================================================================
   نسبةُ إشارةٍ إلى فرصة — بنافذةٍ من الطرفين.

   الشرط الأول كان `at <= peakAt` وحده، وهو **متساهلٌ من جهتين**:

   · يقبل إشارةً سبقت بدايةَ الحركة بساعتين ويسمّيها اكتشافاً. خرج
     بها NFLX فعلاً: «بدأت الحركة ‎12:50‎ · اكتُشفت ‎11:00‎» — رقمٌ
     يمدح النظام بما لم يفعله. من فُتح له مركزٌ قبل الحركة بساعتين
     ليس مكتشِفاً لها، وقد يكون خرج منه قبل أن تبدأ.
   · ويقبل إشارةً بعد جرس الافتتاح لفرصةٍ بدأت قبله، فيُظهر النظام
     القديم «مكتشِفاً» لحركاتٍ سبقته كلُّها — وهو ما أعطاه ‎10/13‎
     وهو لا يملك إشارةً واحدة قبل الافتتاح.

   فالنافذة `[moveStart, peakAt]`. وما قبلها يُحصى على حدة
   (`anticipated`) ولا يُخلط بالاكتشاف: معلومةٌ مختلفة تستحقّ اسمها.
   ===================================================================== */
function matchSignal(sigs, opp) {
  const c = sigs.filter(s => s.sym === opp.sym && s.dir === opp.dir &&
                             s.at >= opp.moveStart && s.at <= opp.peakAt);
  if (!c.length) return null;
  return c.reduce((a, b) => (a.at <= b.at ? a : b));
}
/* إشارةٌ سبقت بدايةَ الحركة — تُذكر ولا تُحتسب اكتشافاً */
function earlySignal(sigs, opp) {
  const c = sigs.filter(s => s.sym === opp.sym && s.dir === opp.dir && s.at < opp.moveStart);
  if (!c.length) return null;
  return c.reduce((a, b) => (a.at >= b.at ? a : b));   // أقربُها إلى الحركة
}

async function main() {
  const date = argOf("date");
  if (!date) throw new Error("مطلوب --date=YYYY-MM-DD");
  const rd = (eng) => {
    const f = path.join(OUT, "replay", `${date}-${eng}.json`);
    if (!fs.existsSync(f)) throw new Error(`لا يوجد ${path.relative(ROOT, f)} — شغّل replay.mjs أولاً`);
    return JSON.parse(fs.readFileSync(f, "utf8"));
  };
  const newRun = rd("new"), oldRun = rd("old");
  const syms = [...new Set(newRun.signals.map(s => s.sym))];
  const allSyms = argOf("symbols") ? argOf("symbols").split(",") : null;

  /* الكون المقيَّم = ما مرّ في إعادة التشغيل، لا ما ظهرت له إشارة.
     نأخذه من الملخّص ونقصّه بنفس حدّ التشغيل كي يتطابق المقام. */
  const summary = JSON.parse(fs.readFileSync(path.join(OUT, "summary.json"), "utf8"));
  let universe = allSyms || summary.rows.filter(r => r.mkt !== "crypto").map(r => r.s);
  if (newRun.symbols && universe.length > newRun.symbols) universe = universe.slice(0, newRun.symbols);

  console.log(`\n▶ تدقيق الفرص الفائتة · ${date} · ${universe.length} رمزاً في المقام`);

  const { provider } = PROV.pick("equity", ["extendedVolume"]);
  const dayStart = Date.parse(`${date}T00:00:00Z`);
  const bars5 = await provider.getCandlesBatch(universe, "5m", { from: dayStart, to: dayStart + 86400e3 });
  delete bars5.__skipped;
  const barsD = await provider.getCandlesBatch(universe, "1d", { from: dayStart - 40 * 86400e3, to: dayStart });
  delete barsD.__skipped;

  const win = sessionWindows(Date.parse(`${date}T15:00:00Z`));
  const opps = [];
  for (const sym of universe) {
    const k5 = bars5[sym] || [], kd = barsD[sym] || [];
    if (k5.length < 10 || kd.length < 15) continue;
    /* ATR بسيط على أربعة عشر يوماً — المدى الحقيقي لا مدى الشمعة، كي
       تُحتسب الفجوات (وهي بالضبط ما يقع قبل الافتتاح) */
    const tr = [];
    for (let i = 1; i < kd.length; i++) {
      const p = kd[i - 1].c, x = kd[i];
      tr.push(Math.max(x.h - x.l, Math.abs(x.h - p), Math.abs(x.l - p)));
    }
    const atr = tr.slice(-14).reduce((a, b) => a + b, 0) / Math.min(14, tr.length);
    const prevClose = kd[kd.length - 1].c;
    opps.push(...findOpportunities(sym, k5, atr, prevClose, win));
  }

  const ext = opps.filter(o => o.startedExtended);
  const rows = ext.map(o => {
    const sn = matchSignal(newRun.signals, o);
    const so = matchSignal(oldRun.signals, o);
    const en = earlySignal(newRun.signals, o);
    const openBar = (bars5[o.sym] || []).find(b => b.t >= win.regular.start);
    return {
      ...o,
      openPx: openBar ? r2(openBar.o) : null,
      newAt: sn?.at ?? null, newStrat: sn?.strat ?? null, newPx: sn ? r2(sn.px) : null,
      oldAt: so?.at ?? null, oldStrat: so?.strat ?? null,
      /* سبقُ الاكتشاف: كم دقيقة قبل جرس الافتتاح. وهو المقياس الذي
         يهمّ المستخدم فعلاً — «هل عرفتُ قبل أن يفتح السوق؟» */
      leadMin: sn ? Math.round((win.regular.start - sn.at) / 60000) : null,
      /* **المقياس الذي يصف طلب المستخدم حرفياً**: هل عرفنا قبل أن
         يُقرع الجرس؟ النظام القديم لا يملك إشارةً واحدة قبله بحكم
         بنيته، فهذا هو العمود الذي يفصل بين الحالتين فصلاً نظيفاً. */
      newBeforeOpen: !!(sn && sn.at < win.regular.start),
      oldBeforeOpen: !!(so && so.at < win.regular.start),
      earlyAt: en?.at ?? null, earlyStrat: en?.strat ?? null,
      /* وتأخّرُ الاكتشاف عن بداية الحركة — المقياس الذي يهمّ النظام */
      delayMin: sn ? Math.round((sn.at - o.moveStart) / 60000) : null,
      capturedPct: sn ? r2(pct(o.peakPx, sn.px) * o.dir) : null
    };
  });

  /* الإيجابيات الكاذبة: إشاراتٌ في الجلسة الممتدة لم تتبعها حركةٌ
     بحجم العتبة في اتجاهها. تُحسب من نفس التشغيل لا من تشغيلٍ آخر. */
  const oppKey = new Set(opps.map(o => o.sym + ":" + o.dir));
  const preSigs = newRun.signals.filter(s => s.sess === "PRE" || s.sess === "AFTER");
  const fp = preSigs.filter(s => !oppKey.has(s.sym + ":" + s.dir));

  const detNew = rows.filter(r => r.newAt).length;
  const detOld = rows.filter(r => r.oldAt).length;
  const preNew = rows.filter(r => r.newBeforeOpen).length;
  const preOld = rows.filter(r => r.oldBeforeOpen).length;
  const report = {
    date, generated: Date.now(),
    universe: universe.length,
    thresholds: { moveAtr: MOVE_ATR, startAtr: START_ATR },
    opportunities: { total: opps.length, extended: ext.length },
    detection: {
      newDetected: detNew, oldDetected: detOld,
      newRate: ext.length ? r2(detNew / ext.length * 100) : null,
      oldRate: ext.length ? r2(detOld / ext.length * 100) : null,
      newBeforeOpen: preNew, oldBeforeOpen: preOld,
      newBeforeOpenRate: ext.length ? r2(preNew / ext.length * 100) : null,
      oldBeforeOpenRate: ext.length ? r2(preOld / ext.length * 100) : null
    },
    falsePositives: {
      extendedSignals: preSigs.length, withoutMove: fp.length,
      rate: preSigs.length ? r2(fp.length / preSigs.length * 100) : null
    },
    rows: rows.sort((a, b) => Math.abs(b.movePct) - Math.abs(a.movePct))
  };

  const dir = path.join(OUT, "audit");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `missed-${date}.json`);
  fs.writeFileSync(file, JSON.stringify(report));

  console.log(`\n  فرصٌ بمقياس ‎${MOVE_ATR}×ATR‎: ${opps.length} · منها بدأت في الجلسة الممتدة: ${ext.length}`);
  console.log(`  اكتشافٌ داخل نافذة الحركة  — جديد: ${detNew}/${ext.length} (${report.detection.newRate}%) · قديم: ${detOld}/${ext.length} (${report.detection.oldRate}%)`);
  console.log(`  اكتشافٌ **قبل جرس الافتتاح** — جديد: ${preNew}/${ext.length} (${report.detection.newBeforeOpenRate}%) · قديم: ${preOld}/${ext.length} (${report.detection.oldBeforeOpenRate}%)`);
  console.log(`  إيجابيات كاذبة: ${fp.length}/${preSigs.length} (${report.falsePositives.rate}%)`);
  console.log(`\n  ${"الرمز".padEnd(7)}${"الحركة".padStart(8)}${"ATR×".padStart(7)}  ${"بدأت".padEnd(7)}${"اكتُشفت".padEnd(8)} سبق  قديم`);
  for (const r of rows.slice(0, 15)) {
    console.log(`  ${r.sym.padEnd(7)}${String(r.movePct).padStart(7)}%${String(r.moveAtr).padStart(6)}×  ` +
      `${ksaTime(r.moveStart).padEnd(7)}${(r.newAt ? ksaTime(r.newAt) : "—").padEnd(8)}` +
      `${(r.leadMin !== null ? r.leadMin + "د" : "—").padStart(5)} ${r.oldAt ? "✓" : "✗"}`);
  }
  console.log(`\n  كُتب: ${path.relative(ROOT, file)}\n`);
  return 0;
}

function selfCheck() {
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n} — ${e.message}`); fail++; } };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

  console.log("\n▶ فحص تدقيق الفرص\n");
  const win = sessionWindows(Date.parse("2026-09-14T15:00:00Z"));
  const bar = (iso, o, h, l, c) => ({ t: Date.parse(iso), o, h, l, c, v: 1000 });

  t("الحدث يُقاس بـATR السهم لا بنسبةٍ ثابتة", () => {
    // حركةُ ‎2%‎ في سهمٍ ATR‏ ‎4%‎ ليست حدثاً
    const k = [bar("2026-09-14T10:00:00Z", 100, 102, 100, 102)];
    eq(findOpportunities("X", k, 4, 100, win).length, 0, "داخل المدى الطبيعي");
    // ونفسُها في سهمٍ ATR‏ ‎0.8‎ حدثٌ
    eq(findOpportunities("Y", k, 0.8, 100, win).length, 1, "تتجاوز المدى");
  });

  t("الحركة الهابطة تُلتقط كما الصاعدة — لا افتراضَ صعود", () => {
    const k = [bar("2026-09-14T10:00:00Z", 100, 100, 96, 96)];
    const o = findOpportunities("X", k, 1, 100, win);
    eq(o.length, 1, "التُقطت");
    eq(o[0].dir, -1, "هابطة");
    eq(o[0].movePct > 0, true, "الحركة تُقاس بالاتجاه فتخرج موجبة");
  });

  t("الحركة التي تبدأ في الجلسة الممتدة تُوسَم كذلك", () => {
    const pre = findOpportunities("X", [bar("2026-09-14T10:00:00Z", 100, 104, 100, 104)], 1, 100, win);
    eq(pre[0].startedExtended, true, "06:00 ET ممتدة");
    const reg = findOpportunities("X", [bar("2026-09-14T15:00:00Z", 100, 104, 100, 104)], 1, 100, win);
    eq(reg[0].startedExtended, false, "11:00 ET رسمية");
  });

  t("النافذة من الطرفين: لا بعد الذروة ولا قبل بداية الحركة", () => {
    const opp = { sym: "X", dir: 1,
                  moveStart: Date.parse("2026-09-14T10:30:00Z"),
                  peakAt: Date.parse("2026-09-14T12:00:00Z") };
    const late = [{ sym: "X", dir: 1, at: Date.parse("2026-09-14T13:00:00Z") }];
    eq(matchSignal(late, opp), null, "بعد الذروة تُرفض");
    /* وهذه هي الحالة التي كانت تمدح النظام بما لم يفعله: إشارةٌ قبل
       بداية الحركة بساعة ونصف كانت تُحتسب «اكتشافاً» لها. */
    const tooEarly = [{ sym: "X", dir: 1, at: Date.parse("2026-09-14T09:00:00Z") }];
    eq(matchSignal(tooEarly, opp), null, "قبل بداية الحركة تُرفض");
    eq(earlySignal(tooEarly, opp).at, tooEarly[0].at, "وتُحصى «سابقة» على حدة");
    const inside = [{ sym: "X", dir: 1, at: Date.parse("2026-09-14T11:00:00Z") }];
    eq(matchSignal(inside, opp).at, inside[0].at, "داخل النافذة تُقبل");
  });

  t("الإشارة المعاكسة لا تُحسب اكتشافاً للفرصة", () => {
    const opp = { sym: "X", dir: 1, moveStart: Date.parse("2026-09-14T10:00:00Z"),
                  peakAt: Date.parse("2026-09-14T12:00:00Z") };
    const wrong = [{ sym: "X", dir: -1, at: Date.parse("2026-09-14T11:00:00Z") }];
    eq(matchSignal(wrong, opp), null, "الاتجاه المعاكس مرفوض");
  });

  t("وأبكرُ إشارةٍ داخل النافذة هي المنسوبة لا آخرُها", () => {
    const opp = { sym: "X", dir: 1,
                  moveStart: Date.parse("2026-09-14T09:30:00Z"),
                  peakAt: Date.parse("2026-09-14T12:00:00Z") };
    const many = [
      { sym: "X", dir: 1, at: Date.parse("2026-09-14T11:30:00Z"), strat: "b" },
      { sym: "X", dir: 1, at: Date.parse("2026-09-14T10:00:00Z"), strat: "a" }
    ];
    eq(matchSignal(many, opp).strat, "a", "الأبكر");
  });

  t("الإشارة المعاكسة لا تُحتسب «سابقة» أيضاً", () => {
    const opp = { sym: "X", dir: 1, moveStart: Date.parse("2026-09-14T10:30:00Z"),
                  peakAt: Date.parse("2026-09-14T12:00:00Z") };
    eq(earlySignal([{ sym: "X", dir: -1, at: Date.parse("2026-09-14T09:00:00Z") }], opp),
       null, "الاتجاه المعاكس مرفوض في الطرفين");
  });

  console.log(`\n${fail ? "✗" : "✔"} ${pass} نجح · ${fail} فشل\n`);
  return fail ? 1 : 0;
}

const IS_MAIN = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (IS_MAIN) {
  if (CHECK) process.exit(selfCheck());
  else main().then(c => process.exit(c)).catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });
}
