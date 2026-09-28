/* =====================================================================
   النشر المعاملاتيّ — مرشَّحٌ ثم تحقّقٌ ثم ترقيةٌ ذرّية، أو لا شيء.

   كان النشر (`local/run.mjs publish`) يتحقّق من `data/` الحيّ ثم **ينسخه
   مرّةً ثانية** ثم يدفع `-f`. ثلاث علل في هذا وحده:

   ١) **ما فُحص غيرُ ما نُشر** — المجدول يكتب كل دقيقتين، فالفحص يرى حالةً
      والنسخُ بعده بثوانٍ يلتقط أخرى (وقد تكون نصف كتابة). والحلّ لقطةٌ
      **واحدة** تحت قفل الكاتب، والفحص والنشر عليها هي بعينها (INV-17).
   ٢) **مجلّد تجهيزٍ ثابت الاسم** (`tmp/webtrade-publish`) — نشران متداخلان
      (مهمّة Publish وأيُّ `--publish`) يمحو أحدُهما مجلّدَ الآخر في منتصف
      نسخه. الآن مجلّدٌ فريد لكل نشر، وقفلُ نشرٍ فوقه.
   ٣) **`push -f` غير مشروط** — نشرٌ بدأ أوّلاً وانتهى آخراً يكتب حالةً أقدم
      فوق أحدث. الآن `--force-with-lease` على SHA قُرئ قبل التحقّق، وحارسٌ
      رتيب يرفض أيَّ `candleKey`/`updated` ينزل. عدمُ تطابق الإيجار **إلغاءٌ
      بلا إعادة**: كاتبٌ آخر سبقنا، والصواب أن نفسح له لا أن نعاود.

   ورابعةٌ ظهرت أثناء الفحص: حين يسقط دفتر الكريبتو في بوّابته كان يُستبعد
   مجلّدُه من الالتزام — والفرع يتيمٌ يُعاد بناؤه كلّ مرّة، **فتُحذف بيانات
   الكريبتو المنشورة**. تحديثٌ جزئيّ يحلّ محلّ حالةٍ كاملة (INV-10). الآن
   يُحمَل مجلّدُ الكريبتو من الالتزام المنشور كما هو (آخر نسخة سليمة له).

   **آخر نسخة سليمة (LKG)**: عند كلّ ترقية يُدفَع الالتزامُ الذي كان منشوراً
   إلى `data-lkg` — إن اجتاز مخطّطاته — فيبقى هدفُ رجوعٍ صالح دائماً.
   ===================================================================== */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { takeSnapshot, dropSnapshot } from "./snapshot.mjs";
import { acquire, release } from "./lockfile.mjs";
import { validateBook } from "./validate-schemas.mjs";

const git = (args, cwd, env) => execFileSync("git", args,
  { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: env ? { ...process.env, ...env } : process.env }).trim();

/* ما لا يُنشر — قائمة **منع** (قائمةُ السماح تُسقط ملفّاً جديداً بصمت).
   `logs/` و`replay/` و`audit/` تُستبعد في اللقطة نفسها: تشخيصٌ محلّي لا
   تطلبه الواجهة (21 م.ب كانت تُنشر كل دقيقتين). */
export const NO_PUBLISH = new Set([".run.lock", ".publish.lock", ".run.skips.json", "i18n.json", "cik.json",
  "opportunities-log.json", ".opportunities.tmp.json", ".archive", ".monitor"]);

/* =====================================================================
   بوّابتا الدفترين — كما كانتا في `run.mjs` حرفياً، على **مجلّدٍ مُمرَّر**.
   ===================================================================== */
/* رمزٌ مكرّر يُعرض مرّتين ويُحسب في الاتساع والقطاعات مرّتين — كشفه التعذيب:
   كان يمرّ من كلّ البوّابات (المخطّط لا يعبّر عن التفرّد بمفتاح). */
export function dupSymbols(rows) {
  const seen = new Set(), dup = new Set();
  for (const r of rows || []) { if (seen.has(r.s)) dup.add(r.s); seen.add(r.s); }
  return [...dup];
}
export function validateStocks(dir) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const sum = read("summary.json"), mkt = read("market.json");
  if (!Array.isArray(sum.rows) || sum.rows.length < 40)
    throw new Error(`summary.json فيه ${(sum.rows || []).length} صفاً فقط — مرفوض`);
  const bad = sum.rows.filter((r) => !r.s || !Number.isFinite(r.p) || r.p <= 0);
  const BAD_MAX = Math.max(5, Math.ceil(sum.rows.length * 0.02));
  if (bad.length > BAD_MAX)
    throw new Error(`${bad.length} صفّاً بأسعار غير صالحة من ${sum.rows.length} (السقف ${BAD_MAX})`);
  const empty = sum.rows.filter((r) => (!Number.isFinite(r.p) || r.p <= 0) && (!Number.isFinite(r.pc) || r.pc <= 0));
  if (empty.length) throw new Error(`صفوف بلا سعرٍ حيّ ولا إغلاقٍ مؤكَّد: ${empty.map((b) => b.s).join(", ")}`);
  if (!mkt.status) throw new Error("market.json بلا حالة سوق");
  const dup = dupSymbols(sum.rows);
  if (dup.length) throw new Error(`رموزٌ مكرّرة في الملخّص: ${dup.join(", ")}`);
  const crypto = sum.rows.filter((r) => r.mkt === "crypto");
  if (crypto.length) throw new Error(`صفوف كريبتو في دفتر الأسهم: ${crypto.map((r) => r.s).join(", ")}`);
  const four = sum.rows.filter((r) => Object.keys(r.tfScore || {}).length === 4).length;
  if (four < sum.rows.length * 0.70)
    throw new Error(`${four} من ${sum.rows.length} صفّاً بأربعة فريمات — بياناتٌ منقوصة العمق`);
  const files = fs.readdirSync(path.join(dir, "sym")).length;
  if (files < 40) throw new Error(`${files} ملف سهم فقط — مرفوض`);
  const errs = validateBook(dir, "stocks");
  if (errs.length) throw new Error("مخالفة مخطّط: " + errs.slice(0, 3).map((e) => e.file + " " + e.errors[0]).join(" · "));
  return { rows: sum.rows.length, files, four, updated: sum.updated,
           stale: sum.rows.filter((r) => r.stale).length, noLive: bad.map((b) => b.s) };
}

export function validateCryptoBook(dir) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const sum = read("summary.json"), opp = read("opportunities.json");
  const rows = sum.rows || [];
  if (rows.length < 10) throw new Error(`${rows.length} صفّاً فقط`);
  const alien = rows.filter((r) => r.mkt !== "crypto");
  if (alien.length) throw new Error(`صفوفٌ غير كريبتو في دفتر الكريبتو: ${alien.map((r) => r.s).join(", ")}`);
  const dup = dupSymbols(rows);
  if (dup.length) throw new Error(`رموزٌ مكرّرة: ${dup.join(", ")}`);
  const four = rows.filter((r) => Object.keys(r.tfScore || {}).length === 4).length;
  if (four < rows.length * 0.70) throw new Error(`${four} من ${rows.length} بأربعة فريمات`);
  if (!Number.isFinite(opp.candleKey)) throw new Error("لقطة الفرص بلا candleKey");
  const errs = validateBook(dir, "crypto", { symLimit: 0, optional: ["ma200-open.json"] });
  if (errs.length) throw new Error("مخالفة مخطّط: " + errs.slice(0, 3).map((e) => e.file + " " + e.errors[0]).join(" · "));
  return { rows: rows.length, four, candleKey: opp.candleKey, show: new Set(Object.keys(opp.bySym || {})) };
}

/* ---------------------------------------------------------------------
   بصمةُ الحالة لحارس الرتابة — من الملفّات الصغيرة وحدها.
   --------------------------------------------------------------------- */
function stateOf(readFile) {
  const j = (f) => { try { const t = readFile(f); return t === null ? null : JSON.parse(t); } catch { return null; } };
  const sum = j("summary.json"), opp = j("opportunities.json"), csum = j("crypto/summary.json"), copp = j("crypto/opportunities.json");
  return {
    stocks: { updated: sum && sum.updated, candleKey: opp && opp.candleKey, rowsHash: opp && opp.rowsHash,
              version: opp && ((opp.strategyVersion || "") + "/" + (opp.pipelineVersion || "")) },
    crypto: { updated: csum && csum.updated, candleKey: copp && copp.candleKey, rowsHash: copp && copp.rowsHash,
              version: copp && ((copp.strategyVersion || "") + "/" + (copp.pipelineVersion || "")) }
  };
}

/* =====================================================================
   حارس الرتابة (INV-12 · INV-25) — يعيد قائمة أسباب الرفض، فارغةً إن سُمح.
   ===================================================================== */
export function monotonicGuard(cand, remote) {
  const why = [];
  for (const book of ["stocks", "crypto"]) {
    const c = cand[book], r = remote[book];
    if (!r || !Number.isFinite(r.candleKey)) continue;          // لا منشورٌ سابق لهذا الدفتر
    if (!c || !Number.isFinite(c.candleKey)) { why.push(`${book}: المرشَّح بلا candleKey والمنشور يحمل ${r.candleKey}`); continue; }
    if (c.candleKey < r.candleKey) why.push(`${book}: candleKey ينزل ${r.candleKey} → ${c.candleKey}`);
    if (Number.isFinite(r.updated) && Number.isFinite(c.updated) && c.updated < r.updated)
      why.push(`${book}: updated ينزل ${r.updated} → ${c.updated}`);
    if (c.candleKey === r.candleKey && c.rowsHash !== r.rowsHash && c.version === r.version)
      why.push(`${book}: البصمة تغيّرت داخل نفس الشمعة ${c.candleKey} بلا تغيّر نسخة`);
  }
  return why;
}

/* قارئُ ملفّ من التزامٍ بعينه على البعيد: GitHub ⇒ raw بالـSHA (ثابتٌ لا
   يُخزَّن خطأً)، وإلا (مستودعٌ محلي في الاختبار) ⇒ `git fetch` ثم `show`. */
async function remoteReader(url, sha, work) {
  const m = /github\.com[/:]([^/]+)\/([^/.]+?)(\.git)?$/.exec(url);
  if (m && !process.env.PUBLISH_GIT_READ) {
    const cache = new Map();
    return async (f) => {
      if (cache.has(f)) return cache.get(f);
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${sha}/${f}`, { signal: AbortSignal.timeout(20000) });
        const t = r.ok ? await r.text() : (r.status === 404 ? null : (() => { throw new Error("HTTP " + r.status); })());
        cache.set(f, t); return t;
      } catch (e) { throw new Error("تعذّرت قراءة المنشور (" + f + "): " + e.message); }
    };
  }
  git(["init", "-q"], work);
  git(["fetch", "-q", url, sha], work);
  return async (f) => { try { return git(["show", `${sha}:${f}`], work); } catch { return null; } };
}

function lsRemote(url, ref) {
  const out = git(["ls-remote", url, "refs/heads/" + ref], process.cwd());
  const sha = out.split(/\s+/)[0];
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/* تطبيقُ قائمة المنع ومرشّحات الكريبتو على مجلّد التجهيز */
function prune(stage, cryptoShow) {
  for (const n of NO_PUBLISH) fs.rmSync(path.join(stage, n), { recursive: true, force: true });
  const cdir = path.join(stage, "crypto");
  if (!fs.existsSync(cdir)) return;
  for (const n of NO_PUBLISH) fs.rmSync(path.join(cdir, n), { recursive: true, force: true });
  fs.rmSync(path.join(cdir, "strat"), { recursive: true, force: true });
  const sym = path.join(cdir, "sym");
  if (fs.existsSync(sym) && cryptoShow)
    for (const f of fs.readdirSync(sym)) if (!cryptoShow.has(path.basename(f, ".json"))) fs.rmSync(path.join(sym, f));
}

/* =====================================================================
   النشر. `opts`:
     root       جذر المستودع (للهويّة والريموت)
     dataDir    مجلّد البيانات (الافتراضي data/)
     remote     عنوان الريموت (الافتراضي origin)
     branch     الفرع المنشور (data) · lkgBranch (data-lkg)
     quick      دالّةٌ اختيارية تُنادى على المرشَّح (الطبيب السريع) وتعيد قائمة أخطاء
     log        دالّة الطباعة
   يعيد { ok, code, why, sha, prev }.
   ===================================================================== */
export async function publishData(opts = {}) {
  const root = opts.root;
  const dataDir = opts.dataDir || path.join(root, "data");
  const branch = opts.branch || "data", lkgBranch = opts.lkgBranch || "data-lkg";
  const log = opts.log || console.log;
  const url = opts.remote || git(["remote", "get-url", "origin"], root);
  const lock = path.join(dataDir, ".publish.lock");
  const res = (ok, code, why, extra = {}) => Object.assign({ ok, code, why }, extra);

  if (!(await acquire(lock, "publish", opts.lockCapMs ?? 90000)))
    return res(false, "locked", "نشرٌ آخر جارٍ — نفسح له");
  let stage = null, work = null;
  try {
    /* ١) الإيجار: SHA المنشور **قبل** أيّ فحص — كلُّ ما بعده يُقاس عليه. */
    const prevSha = lsRemote(url, branch);
    /* ٢) لقطةٌ واحدة تحت قفل الكاتب — ما يُفحص هو ما يُنشر. */
    stage = await takeSnapshot({ src: dataDir, job: "publish" });
    let info;
    try { info = validateStocks(stage); }
    catch (e) { return res(false, "invalid", "الأسهم لم تجتز البوّابة: " + e.message); }

    work = fs.mkdtempSync(path.join(os.tmpdir(), "webtrade-remote-"));
    const readRemote = prevSha ? await remoteReader(url, prevSha, work) : null;
    const remoteFiles = {};
    if (readRemote) for (const f of ["summary.json", "opportunities.json", "crypto/summary.json", "crypto/opportunities.json"])
      remoteFiles[f] = await readRemote(f);
    const remoteState = stateOf((f) => remoteFiles[f] ?? null);

    /* ٣) دفتر الكريبتو: سليمٌ ⇒ يُنشر، ساقطٌ ⇒ يُحمَل المنشورُ كما هو. */
    let cryptoShow = null, cryptoNote = "لا دفتر كريبتو";
    const cdir = path.join(stage, "crypto");
    let carry = false;
    if (fs.existsSync(cdir)) {
      try { const c = validateCryptoBook(cdir); cryptoShow = c.show; cryptoNote = `${c.rows} صفّاً · شمعة ${new Date(c.candleKey * 1000).toISOString()}`; }
      catch (e) { carry = true; cryptoNote = "ساقطٌ في بوّابته (" + e.message + ") — يُحمَل المنشور"; }
    } else if (remoteFiles["crypto/opportunities.json"]) { carry = true; cryptoNote = "غائبٌ محلياً — يُحمَل المنشور"; }
    if (carry) {
      fs.rmSync(cdir, { recursive: true, force: true });
      if (prevSha && remoteFiles["crypto/opportunities.json"]) {
        if (!fs.existsSync(path.join(work, ".git"))) { git(["init", "-q"], work); git(["fetch", "-q", url, prevSha], work); }
        git(["--work-tree", stage, "checkout", prevSha, "--", "crypto"], work);
      }
    }
    prune(stage, cryptoShow);

    /* ٤) الطبيب السريع على المرشَّح نفسه */
    if (typeof opts.quick === "function") {
      const errs = await opts.quick(stage);
      if (errs && errs.length) return res(false, "doctor", "الطبيب السريع: " + errs.slice(0, 3).join(" · "));
    }

    /* ٥) حارس الرتابة */
    const candState = stateOf((f) => { try { return fs.readFileSync(path.join(stage, f), "utf8"); } catch { return null; } });
    const mono = monotonicGuard(candState, remoteState);
    if (mono.length) return res(false, "regression", "حالةٌ أقدم من المنشور: " + mono.join(" · "));
    const same = ["stocks", "crypto"].every((b) => candState[b].rowsHash === remoteState[b].rowsHash
      && candState[b].updated === remoteState[b].updated);
    if (prevSha && same) return res(true, "unchanged", "لا جديد — المنشور مطابق", { sha: prevSha, prev: prevSha });

    /* ٦) الالتزام اليتيم والترقية بإيجار */
    const cfg = (k, d) => { try { return git(["config", k], root) || d; } catch { return d; } };
    git(["init", "-q", "-b", "snapshot"], stage);
    git(["config", "user.name", cfg("user.name", "webtrade-local")], stage);
    git(["config", "user.email", cfg("user.email", "local@webtrade")], stage);
    git(["add", "-A"], stage);
    git(["commit", "-q", "-m", `بيانات محلية ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`], stage);
    const sha = git(["rev-parse", "HEAD"], stage);
    /* نقطةُ اختبارٍ وحيدة: السباق «بدأ A، نشر B، ثم دفع A» لا يُحاكى إلا
       بإدخال B بين قراءة الإيجار والدفع. لا يمرّرها أيُّ مستدعٍ إنتاجيّ. */
    if (opts.hooks && typeof opts.hooks.beforePush === "function") await opts.hooks.beforePush();
    const lease = `--force-with-lease=refs/heads/${branch}:${prevSha || ""}`;
    try { git(["push", "-q", lease, url, `snapshot:refs/heads/${branch}`], stage); }
    catch (e) {
      const msg = String(e.stderr || e.message || "");
      if (/stale info|rejected|fetch first/i.test(msg))
        return res(false, "lease", "الإيجار لم يطابق — كاتبٌ آخر نشر بعد قراءتنا؛ أُلغي النشر بلا إعادة");
      return res(false, "push", "فشل الدفع: " + msg.trim().slice(0, 300));
    }

    /* ٧) آخر نسخة سليمة: المنشورُ السابق إن اجتاز مخطّطاته. فشلُ هذه الخطوة
       لا يُفشل النشر (البيانات الجديدة نُشرت فعلاً) لكنه يُقال. */
    let lkg = null;
    if (prevSha) {
      try {
        const okPrev = ["summary.json", "opportunities.json"].every((f) => remoteFiles[f] !== null);
        if (okPrev) {
          const cur = lsRemote(url, lkgBranch);
          if (cur !== prevSha) {
            if (!fs.existsSync(path.join(work, ".git"))) { git(["init", "-q"], work); git(["fetch", "-q", url, prevSha], work); }
            else { try { git(["cat-file", "-e", prevSha], work); } catch { git(["fetch", "-q", url, prevSha], work); } }
            git(["push", "-q", `--force-with-lease=refs/heads/${lkgBranch}:${cur || ""}`, url, `${prevSha}:refs/heads/${lkgBranch}`], work);
          }
          lkg = prevSha;
        }
      } catch (e) { log("  ⚠ تعذّر تحديث " + lkgBranch + ": " + String(e.stderr || e.message).trim().slice(0, 200)); }
    }
    return res(true, "published", "نُشر", { sha, prev: prevSha, lkg, info, crypto: cryptoNote });
  } finally {
    release(lock);
    if (stage) dropSnapshot(stage);
    if (work) fs.rmSync(work, { recursive: true, force: true });
  }
}

/* =====================================================================
   الرجوع إلى آخر نسخة سليمة — بإيجارٍ كذلك. لا يُنادى لتغيّرٍ طبيعيّ في
   السوق، بل لخللٍ تقنيٍّ حرج (مخطّط، تلوّث دفترين، فريمٌ ممنوع، انحدار).
   ===================================================================== */
export async function rollbackData({ root, remote, branch = "data", lkgBranch = "data-lkg", reason = "" } = {}) {
  const url = remote || git(["remote", "get-url", "origin"], root);
  const cur = lsRemote(url, branch), lkg = lsRemote(url, lkgBranch);
  if (!lkg) return { ok: false, why: "لا " + lkgBranch + " — لا هدف للرجوع" };
  if (cur === lkg) return { ok: false, why: "المنشور هو آخر نسخة سليمة نفسها" };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "webtrade-rb-"));
  try {
    git(["init", "-q"], work);
    git(["fetch", "-q", url, lkg], work);
    git(["push", "-q", `--force-with-lease=refs/heads/${branch}:${cur || ""}`, url, `${lkg}:refs/heads/${branch}`], work);
    return { ok: true, from: cur, to: lkg, reason };
  } catch (e) {
    return { ok: false, why: "فشل الرجوع: " + String(e.stderr || e.message).trim().slice(0, 300) };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
