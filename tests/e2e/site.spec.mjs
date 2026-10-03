/* =====================================================================
   الواجهة — كلُّ شاشة على سطح المكتب والهاتف.

   لا يكفي أن تُحمَّل الصفحة: يُفحص ما يراه المستخدم — لا `NaN` ولا
   `Infinity` ولا `undefined` في النصّ، لا شاشةٌ حرجة فارغة، لا استثناءٌ غير
   ملتقَط، لا طلبٌ حرج فاشل، لا خلطٌ بين الأسهم والكريبتو، والتنقّل يعمل من
   الشريط ومن ورقة «المزيد». (INV-51 · INV-40)
   ===================================================================== */
import { test, expect } from "@playwright/test";

const VIEWS = ["now", "screen", "mdir", "analysis", "list", "crypto", "contracts", "log", "news"];
const BAD_TEXT = /\bNaN\b|\bInfinity\b|\bundefined\b|\[object Object\]/;

async function open(page) {
  const errors = [], failed = [];
  page.on("pageerror", (e) => errors.push(e.message));
  /* يُستثنى ردّ api.github.com وحده: حدُّه 60 طلباً/ساعة لكل عنوان بلا مصادقة،
     و`dataBase()` تلتقط الرفض وتسقط إلى رابط الفرع (تدهورٌ هادئ موثّق) —
     المتصفّح يطبع الرفض وإن عولج. أيُّ خطأٍ آخر يبقى فشلاً. */
  page.on("console", (m) => {
    if (m.type() !== "error" || /favicon|manifest/i.test(m.text())) return;
    const url = (m.location() && m.location().url) || "";
    if (/api\.github\.com/.test(url) && /status of 403|status of 429/.test(m.text())) return;
    /* خطوط جوجل — الاعتماد الخارجي الوحيد المسموح، وسقوطها يعود إلى خطوط النظام
       (نفس استثنائها من «طلبات حرجة فاشلة» أدناه). رُصد ERR_NO_BUFFER_SPACE عابراً. */
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return;
    errors.push("console: " + m.text() + (url ? " @ " + url : ""));
  });
  page.on("requestfailed", (r) => { if (!/fonts\.(googleapis|gstatic)|api\.github\.com/.test(r.url())) failed.push(r.url()); });
  page.on("response", (r) => { if (r.status() >= 500) failed.push(r.status() + " " + r.url()); });
  await page.goto("stocks/");
  await page.waitForFunction(() => typeof window.__diag === "function", null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  return { errors, failed };
}

/* التنقّل كما يفعله المستخدم: زرُّ الشريط إن كان ظاهراً، وإلا ورقةُ «المزيد» */
async function nav(page, view) {
  const btn = page.locator(`.tabbar [data-go="${view}"]`);
  if (await btn.isVisible()) await btn.click();
  else {
    await page.locator("#btnMore").click();
    await page.locator(`#sheetMore [data-nav="${view}"]`).click();
  }
  await expect(page.locator(`section[data-view="${view}"]`)).toHaveClass(/\bon\b/, { timeout: 15000 });
  await page.waitForTimeout(1200);
}

async function visibleText(page, view) {
  return page.locator(`section[data-view="${view}"]`).innerText();
}

for (const view of VIEWS) {
  test(`الشاشة «${view}» تُرسم بلا قيمٍ فاسدة ولا أخطاء`, async ({ page }) => {
    const { errors, failed } = await open(page);
    await nav(page, view);
    const txt = await visibleText(page, view);
    expect(txt.trim().length, "الشاشة فارغة").toBeGreaterThan(40);
    expect(txt.match(BAD_TEXT), "نصٌّ فاسد ظاهر").toBeNull();
    const js = await page.evaluate(() => (window.__errors ? window.__errors() : []).map((e) => e.msg));
    expect(js, "أخطاء وقت التشغيل").toEqual([]);
    const renderErr = await page.evaluate(() => window.__diag().filter((d) => /render|card|بطاقة/i.test(d.tag + d.msg)).map((d) => d.msg));
    expect(renderErr, "بطاقةٌ فشل رسمها").toEqual([]);
    expect(errors, "استثناءات/أخطاء console").toEqual([]);
    expect(failed, "طلبات حرجة فاشلة").toEqual([]);
  });
}

test("الفرص: قائمةٌ حقيقية بختم شمعة، ولا عملة في دفتر الأسهم", async ({ page }) => {
  await open(page);
  await nav(page, "screen");
  const rows = page.locator('section[data-view="screen"] [data-open]');
  await expect(rows.first()).toBeVisible({ timeout: 20000 });
  const syms = await rows.evaluateAll((a) => a.map((x) => x.getAttribute("data-open")));
  expect(syms.length).toBeGreaterThan(0);
  expect(syms.filter((s) => /-USD$/.test(s)), "عملةٌ في فرص الأسهم").toEqual([]);
  const txt = await visibleText(page, "screen");
  expect(txt).toMatch(/شمعة/);
});

test("الكريبتو: لقطة V3 كل 30 دقيقة على :15/:45 — عملاتٌ فقط وبطاقاتٌ بدرجتها", async ({ page }) => {
  await open(page);
  await nav(page, "crypto");
  const syms = await page.locator('section[data-view="crypto"] [data-open]').evaluateAll((a) => a.map((x) => x.getAttribute("data-open")));
  expect(syms.filter((s) => !/-USD$/.test(s)), "سهمٌ في دفتر الكريبتو").toEqual([]);
  // قرار المالك 2026-10-03: لقطة الكريبتو كل 30 دقيقة (كانت كل ساعة)
  expect(await visibleText(page, "crypto")).toMatch(/لقطة .*كل 30 دقيقة/s);
});

test("بحث الكريبتو: على كون الكريبتو كلِّه بالرمز والاسم العربي والإنجليزي، ولا يمسّ بحث الأسهم", async ({ page }) => {
  await open(page);
  await nav(page, "crypto");
  const hits = async (q) => {
    await page.fill("#cSearch", q);
    return page.locator("#cSearchOut [data-csearch]").evaluateAll((a) => a.map((x) => x.getAttribute("data-csearch")));
  };
  expect((await hits("BTC"))[0]).toBe("BTC-USD");
  expect((await hits("Bitcoin"))[0]).toBe("BTC-USD");
  expect((await hits("بيتكوين"))[0]).toBe("BTC-USD");
  expect((await hits("ETH"))[0]).toBe("ETH-USD");
  expect((await hits("Ethereum"))[0]).toBe("ETH-USD");
  expect((await hits("btcusdt"))[0]).toBe("BTC-USD");
  expect(await hits("zzzzqq")).toEqual([]);
  // البحث يعمّ الكون لا الفرص وحدها
  const universe = await page.evaluate(() => bookGet("crypto", "summary").rows.length);
  expect(universe).toBeGreaterThan(await page.locator('section[data-view="crypto"] [data-open]').count());
  // وبحثُ الأسهم كما هو
  await nav(page, "list");
  await page.fill("#qSearch", "NVDA");
  expect(await page.locator("#stockList [data-open]").first().getAttribute("data-open")).toBe("NVDA");
});

test("بطاقة الفرصة تشرح درجتها: الخمس بأوزانها ✓/✗ والدرجة مجموعُ المتوافقة", async ({ page }) => {
  await open(page);
  await nav(page, "screen");
  const card = page.locator('section[data-view="screen"] .srow.opp').first();
  await expect(card).toBeVisible({ timeout: 20000 });
  const r = await card.evaluate((c) => ({
    score: parseFloat(c.querySelector(".v3q b").textContent),
    items: [...c.querySelectorAll(".v3els .it")].map((x) => ({ on: x.classList.contains("on"), t: x.textContent }))
  }));
  expect(r.items.length).toBe(5);
  const W = [40, 40, 6.67, 6.67, 6.66];
  const sum = Math.round(r.items.reduce((a, x, i) => a + (x.on ? W[i] : 0), 0) * 100) / 100;
  expect(r.score).toBeCloseTo(sum, 6);
  expect(r.score).toBeLessThanOrEqual(100);
  expect(await card.innerText()).toMatch(/قوة التوافق/);
});

test("فتحُ سهمٍ من الفرص يعرض تفاصيله بلا خطأ، والعودة تعمل", async ({ page }) => {
  const { errors } = await open(page);
  await nav(page, "screen");
  const first = page.locator('section[data-view="screen"] [data-open]').first();
  await expect(first).toBeVisible({ timeout: 20000 });
  const sym = await first.getAttribute("data-open");
  await first.click();
  await expect(page.locator('section[data-view="detail"]')).toHaveClass(/\bon\b/, { timeout: 15000 });
  await page.waitForTimeout(2500);
  const txt = await visibleText(page, "detail");
  expect(txt).toContain(sym);
  expect(txt.match(BAD_TEXT)).toBeNull();
  await page.locator("#btnBack").click();
  await expect(page.locator('section[data-view="detail"]')).not.toHaveClass(/\bon\b/);
  expect(errors).toEqual([]);
});

test("كلُّ الأوقات المعروضة بتوقيت الرياض مهما كانت منطقة الجهاز", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ timezoneId: "America/Los_Angeles", baseURL });
  const page = await ctx.newPage();
  await open(page);
  for (const view of ["now", "screen", "crypto"]) {
    await nav(page, view);
    expect(await visibleText(page, view), `«نيويورك» ظاهرة في ${view}`).not.toMatch(/نيويورك/);
  }
  await nav(page, "screen");
  const r = await page.evaluate(() => {
    const h = TRADES.hour * 1000;
    const want = new Date(h).toLocaleTimeString("ar-EG-u-nu-latn", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });
    const dev = new Date(h).toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
    return { txt: document.querySelector("#scanCount").textContent, want, dev };
  });
  expect(r.txt).toContain(r.want);
  expect(r.txt).toContain("بتوقيت الرياض");
  expect(r.want).not.toBe(r.dev);             // الفحص يميّز فعلاً: منطقة الجهاز مختلفة
  await ctx.close();
});

/* قسم العقود (2026-10-03): بطاقاتٌ من اللقطة، والتصنيف لا يعرض عقداً لا يستوفي شروطه */
test("العقود: البطاقات والتصنيفات — لا عقد في تصنيفٍ لا يستوفيه", async ({ page }) => {
  await open(page);
  await nav(page, "contracts");
  const all = await page.locator("#oList .ocard").count();
  expect(all, "لا بطاقات عقود").toBeGreaterThan(0);
  for (const [cat, re] of [["etf", /ETF/], ["weekly", /أسبوعية/], ["swing", /متوسطة وطويلة/]]) {
    await page.locator(`#oCats [data-ocat="${cat}"]`).click();
    const cats = await page.locator("#oList .ocard .ocat").allTextContents();   // content-visibility يُفرغ innerText خارج الشاشة
    for (const t of cats) expect(t, `بطاقة خارج تصنيف ${cat}`).toMatch(re);
  }
  await page.locator('#oCats [data-ocat=""]').click();
  await page.locator("#oKind").selectOption("spread");
  const kinds = await page.locator("#oList .ocard .okind").allTextContents();
  for (const t of kinds) expect(t).toMatch(/Spread/);
  expect((await visibleText(page, "contracts")).match(BAD_TEXT)).toBeNull();
});
