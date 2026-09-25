/* =====================================================================
   لقطةُ الفرص — **تُبنى مرّةً عند إغلاق شمعة، وتُقرأ كما هي بينهما.**

   لماذا وُجد هذا الملف: كانت قائمة الفرص تُحسب في المتصفّح عند كل رسم،
   من **ملفّين يكتبهما جدولان مختلفان**:

     • `summary.json`  ← `fetch-market`      كل ‎10‎ دقائق
     • `strategies.json` ← `track-strategies` كل ‎دقيقتين‎

   والشمعة تُغلق كل ‎15‎ دقيقة. فثلاثة إيقاعات لا يقسم أحدها الآخر:

     ٢٣:٤٥ أُغلقت الشمعة  ←  ٢٣:٤٦ `confBar` يتقدّم (دورة الدقيقتين)
                            ←  ٢٣:٥١ `cbar` يتقدّم (دورة العشر دقائق)

   فبين ‎23:46‎ و‎23:51‎ **خمسُ دقائق يصف فيها الملفّان شمعتين مختلفتين**،
   والقائمة مبنيّةٌ على مزجهما. ثم تتبدّل عند ‎23:51‎ — وهي لحظةٌ لا
   علاقة لها بإغلاق شمعة، فتُقرأ انقلاباً عشوائياً.

   قِيس على الإنتاج ‎2026-09-20‎: بين ‎23:51‎ و‎23:57‎ تغيّرت نتيجة
   `NEAR-USD` من ‎82‎ إلى ‎85‎، وخرج `ARB-USD` من القائمة، ودخل
   `BTC-USD` و`PENDLE-USD` — والشمعة الجارية (‎23:45–00:00‎) لم تُغلق.

   **الحلّ ليس حارساً في الواجهة**: ما دام الحساب يجري في المتصفّح على
   ملفّين متحرّكين، فأيُّ حارسٍ يؤجّل العرض ولا يثبّت المحتوى. فالحساب
   انتقل إلى الخادم كاملاً، ونتيجتُه **لقطةٌ ذرّية** مفتاحُها شمعة،
   لا تُكتب إلا حين يتقدّم المفتاح.

   والمتصفّح يقرؤها كما هي: لا يرتّب ولا يحسب درجةً ولا يعيد تقييم شرط.
   السعر اللحظي يُعرض سعراً فقط ولا يدخل أيَّ حساب.

   يُحمَّل في المتصفّح كسكربت كلاسيكي، ويُقرأ في Node عبر
   `module.exports`. ولا يستورد شيئاً بنفسه: كلُّ ما يحتاجه **يُحقن**
   (`deps`) — فلا يختلف مسارُه بين الخادم والمتصفّح بحرف.
   ===================================================================== */

/* مفتاح الشمعة: بدايةُ الشمعة الجارية = لحظةُ إغلاق آخر شمعة مغلقة.
   يتقدّم عند ‎:00‎ و‎:15‎ و‎:30‎ و‎:45‎ بالضبط، ولا يعتمد على بيانات أيّ
   رمز — فلا يتأخّر بتأخّر مزوّد ولا يسبق بسبق آخر. بالثواني كما
   `cbar` و`confBar`. */
var OPP_BAR_MS = 15 * 60 * 1000;
function candleKeyAt(nowMs) {
  return Math.floor(nowMs / OPP_BAR_MS) * (OPP_BAR_MS / 1000);
}

/* =====================================================================
   بناء القائمة — نفس رياضيات `renderScreen` السابقة حرفاً بحرف.

   `deps` تحمل الدوالّ المشتركة (`scanRow` · `forcedDir` · `resolveOpp`
   · `consFromRows` · `scsFrom` · `oppQualityOf`) و`SCANS`. تُحقن ولا
   تُستورد: في المتصفّح هي متغيّراتٌ عامّة وفي Node وحداتٌ مطلوبة،
   وحقنُها يجعل هذا الملفّ لا يعرف الفرق.

   **والترتيب يُحسب على الكون كاملاً مرّةً واحدة** ثم يُصفّى في الواجهة
   بنوع السوق بلا إعادة ترتيب. كان الترتيب يُعاد داخل كل نوع، فدرجةُ
   الرمز تتغيّر بإخفاء رموزٍ أخرى — ودرجةٌ تتبدّل بتغيير مرشّحِ عرضٍ
   ليست درجةَ الرمز. وهو أيضاً ما يجعل اللقطة ثلثَ حجمها.
   ===================================================================== */
function buildOpps(deps, input) {
  var SCANS = deps.SCANS, scanRow = deps.scanRow, forcedDir = deps.forcedDir;
  var resolveOpp = deps.resolveOpp, consFromRows = deps.consFromRows;
  var scsFrom = deps.scsFrom, oppQualityOf = deps.oppQualityOf;

  var live = input.rows || [];
  var wide = input.wideRows || [];
  var F = input.fund || {};
  var ctx = { secMed: input.secMed || {} };
  var byS = input.stratByS || {};
  var meta = input.stratMeta || {};
  var total = input.stratTotal || 0;
  var edge = input.edge || {};
  var coreSet = {};
  for (var i = 0; i < live.length; i++) coreSet[live[i].s] = 1;

  /* الإجماع لرمزٍ واحد — نفس `consSnapshot` في الواجهة، وهنا وحده.
     نسختان منه تجعلان الخادم يحفظ درجةً غير التي رآها المستخدم. */
  function consOf(sym) {
    return consFromRows(byS[sym] || [], meta, { total: total, edge: edge });
  }

  /* اتجاه محرّك الفرص — نفس `oppDirOf` بالحرف، بما فيه إسقاطُ الشروط
     التي تخالف الاتجاه المحسوم. */
  function dirOf(row) {
    if (!row) return null;
    var f = F[row.s];
    var rc = scanRow(row);
    var all = [];
    for (var k = 0; k < SCANS.length; k++) {
      try { if (SCANS[k].test(rc, f, ctx)) all.push(SCANS[k]); } catch (e) { /* حقل ناقص */ }
    }
    if (!all.length) return null;
    var hits = all.map(function (sc) {
      return { id: sc.id, dir: sc.dir === -1 ? -1 : 1, forced: forcedDir(sc.id) };
    });
    var R = resolveOpp({ score: row.score, band: row.band, tfScore: row.tfScore, hits: hits });
    if (!R.dir) return null;
    var kept = {};
    for (var q2 = 0; q2 < R.kept.length; q2++) kept[R.kept[q2].id] = 1;
    return { dir: R.dir, kept: kept };
  }
  /* تعليقٌ من الخادم على الصفّ: دورة الحياة والخطة (`annotate` تُحقن
     لأنها تحتاج الشمعات، وهذا الملفّ لا يقرأ ملفّات). غيابُها = بلا
     تعليق ولا مضاعِف — سلوكٌ سابقٌ لا ينكسر. */
  var annotate = typeof input.annotate === "function" ? input.annotate : null;

  var out = {}, dirCache = {}, consCache = {};
  for (var si = 0; si < SCANS.length; si++) {
    var scan = SCANS[si];
    var pool = scan.wide ? live.concat(wide) : live;

    /* ١) العضوية */
    var hits = [];
    for (var p = 0; p < pool.length; p++) {
      var r = pool[p];
      var fired = false;
      try { fired = !!scan.test(scanRow(r), F[r.s], ctx); } catch (e) { /* تخطَّ */ }
      if (!fired) continue;
      /* **اتّساق الاتجاه**: الصفّ يُدرج تحت شرطٍ بقي بعد `resolveOpp`
         وحده. كان «تباعد هابط ▼» يعرض سهماً اتجاهُه ▲ (و«أرخص من قطاعه
         ▲» سهماً ▼)، فتُقرأ فرصةُ هبوطٍ بخطة صعود — وهو بعينه ما تمنعه
         قاعدة «الحجب للشرط المتناقض». وتعارضٌ جوهري (`!dir`) لا فرصة. */
      if (!(r.s in dirCache)) dirCache[r.s] = dirOf(r);
      var od0 = dirCache[r.s];
      if (!od0 || !od0.kept[scan.id]) continue;
      hits.push(r);
    }
    if (!hits.length) { out[scan.id] = []; continue; }

    /* ٢) الرتبة الخام بمقياس المسح نفسه */
    var keyOf = function (row) {
      try {
        var v = scan.rank ? scan.rank(scanRow(row), F[row.s], ctx) : -(row.score == null ? -999 : row.score);
        return isFinite(v) ? v : Infinity;
      } catch (e) { return Infinity; }
    };
    var keyed = hits.map(function (row) { return { row: row, k: keyOf(row) }; });
    keyed.sort(function (a, b) { return a.k - b.k; });

    /* ٣) الدرجة = الرتبة المئوية ‎±‎ توافق الاستراتيجيات */
    var denom = Math.max(1, keyed.length - 1);
    var rowsOut = [];
    for (var h = 0; h < keyed.length; h++) {
      var row2 = keyed[h].row, sym = row2.s;
      var base = 1 - (h / denom);
      if (!(sym in consCache)) consCache[sym] = consOf(sym);
      var cons = consCache[sym];
      var sc = scsFrom(cons.cons);
      if (!(sym in dirCache)) dirCache[sym] = dirOf(row2);
      var od = dirCache[sym];
      var sd = od ? od.dir : null;
      var q = oppQualityOf(base, sc.scs, sd);
      var ann = annotate ? annotate(row2, scan, sd) : null;
      if (ann && ann.drop) continue;          // انتهت دورةُ حياتها — لا تُعرض
      var v = "";
      try { v = scan.val(scanRow(row2), F[sym], ctx) || ""; } catch (e) { /* بلا قيمة */ }
      var nAct = 0;
      for (var z = 0; z < cons.res.length; z++) if (cons.res[z].dir && cons.res[z].active) nAct++;
      rowsOut.push({
        s: sym,
        ar: row2.ar || null, en: row2.en || null, sec: row2.sec || "", mkt: row2.mkt || null,
        wide: coreSet[sym] ? 0 : 1,
        pc: row2.pc == null ? null : row2.pc,
        cbar: row2.cbar == null ? null : row2.cbar,
        ctf: row2.ctf || null,
        v: v,
        q: Math.round(q.q * 1e4) / 1e4,
        adj: Math.round(q.adj * 1e4) / 1e4,
        scs: sc.scs == null ? null : Math.round(sc.scs * 1e4) / 1e4,
        pct: sc.pct == null ? null : sc.pct,
        cdir: sc.dir, mixed: sc.mixed ? 1 : 0, n: nAct,
        sd: sd == null ? null : sd,
        /* الدرجة النهائية = درجةُ المسح والتوافق × الطزاجة × ما بقي من
           الحركة. `q0` تُحفظ كي يُرى أثرُ العمر لا أن يُستنتج. */
        q0: Math.round(q.q * 1e4) / 1e4
      });
      if (ann) {
        var last = rowsOut[rowsOut.length - 1];
        last.q = Math.round(q.q * (ann.mult == null ? 1 : ann.mult) * 1e4) / 1e4;
        for (var ak in ann.f) last[ak] = ann.f[ak];
      }
    }
    /* الترتيب النهائي بالدرجة، والرتبة الخام تفصل عند التساوي */
    rowsOut.sort(function (a, b) { return (b.q - a.q) || 0; });
    out[scan.id] = rowsOut;
  }
  return out;
}

/* =====================================================================
   بصمةُ الصفوف — **ما يجب ألّا يتغيّر داخل مفتاح الشمعة الواحد**.

   تشمل العضوية والترتيب والدرجة والتوافق والاتجاه وقيمة المسح
   المعروضة، ولا تشمل السعر ولا نسبة التغيّر: هذان لحظيّان بالتصميم
   ويُعرضان سعراً فقط. فإدخالُهما يجعل البصمة تتغيّر كل دقيقتين بلا
   أن يتغيّر شيءٌ مما يشتكي منه المستخدم — فتفقد البوّابة معناها.

   ونصٌّ قانونيّ لا `JSON.stringify` لكائن: ترتيبُ المفاتيح في الكائن
   غيرُ مضمون عبر المحرّكات، وبصمةٌ تتغيّر بترتيب المفاتيح تُبلّغ عن
   تغيّرٍ لم يقع.
   ===================================================================== */
function oppsCanon(scansObj) {
  var ids = Object.keys(scansObj).sort();
  var parts = [];
  for (var i = 0; i < ids.length; i++) {
    var rows = scansObj[ids[i]] || [];
    var seg = [ids[i], String(rows.length)];
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      seg.push([j, r.s, r.q, r.adj, r.scs, r.cdir, r.mixed, r.n, r.sd, r.v, r.cbar, r.ctf,
                r.since, r.px0, r.e, r.st, (r.t || []).join(","), r.hit, r.fk].join("|"));
    }
    parts.push(seg.join(";"));
  }
  return parts.join("\n");
}

/* نصُّ البصمة الكامل — الصفوف ثم تحليل الخمسين ثم دورة الحياة. دالّةٌ
   واحدة يقرؤها الخادم والفحوص معاً: بصمةٌ تُحسب بطريقتين تُبلّغ عن
   فرقٍ لا وجود له. وترتيبُ مفاتيح `bySym`/`life` يبقى كما كتبه الخادم
   عبر JSON، فالنصّ نفسه في الطرفين. */
function stableJSON(v) {
  if (Array.isArray(v)) return "[" + v.map(stableJSON).join(",") + "]";
  if (v && typeof v === "object") {
    var ks = Object.keys(v).sort(), out = [];
    for (var i = 0; i < ks.length; i++) if (v[ks[i]] !== undefined) out.push(JSON.stringify(ks[i]) + ":" + stableJSON(v[ks[i]]));
    return "{" + out.join(",") + "}";
  }
  return JSON.stringify(v === undefined ? null : v);
}
function snapCanon(doc) {
  var s = oppsCanon(doc.scans || {});
  /* مفاتيحُ مرتّبة: ترتيبُ bySym كان يتبع ترتيب صفوف الملخّص، وهو بالقيمة
     السوقية **اللحظية** — فتتغيّر البصمة والمحتوى هو هو (قِيس 2026-09-25
     شمعة 14:00Z: صفر فرقٍ في أيّ قيمة). */
  if (doc.bySym) s += "\n" + stableJSON(doc.bySym) + "\n" + stableJSON(doc.life || {});
  return s;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    snapCanon: snapCanon,
    OPP_BAR_MS: OPP_BAR_MS,
    candleKeyAt: candleKeyAt,
    buildOpps: buildOpps,
    oppsCanon: oppsCanon
  };
}
