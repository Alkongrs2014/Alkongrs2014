/* =====================================================================
   REG-TFPIN — بوابتان كانتا تقرآن فريماً مرقوناً رغم تثبيت الفريم.

   نفس عائلة علّة `momo` الموثّقة («كانت ترقن "1h"… فتثبيتُها على ‎4‎ ساعات
   كان يعطي عموداً عنوانه ‎4‎ ساعات وأرقامُه من الساعة»):
     · `sqzExp.expRatio` كان يقرأ `bw["1h"]` بينما المشغِّل وبقية البوابات
       تقرأ `sqTf(c)` — فعمود «‎4‎ ساعات» في توجّه السوق يزن قوّةَ توسّعٍ
       قيست على الساعة.
     · `pbTrend.volDry` كان يقرأ حجم `"1h"` بينما التراجع يُقاس على `pbTf(c)`.
   كُشفا بكتابة المرجع من المواصفة (§5.4 و§5.6) لا بمقارنته: في مسار الفرص
   (بلا تثبيت) الفريمان متطابقان فلا فرق، والفرق في توجّه السوق وحده.
   ===================================================================== */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("../../stocks/strategies.js");

const gate = (sid, gid) => S.STRAT_BY_ID[sid].gates.find((g) => g.id === gid);
/* سلسلة عرضٍ: 30 قيمةً ثابتة ثم 12 «ضيّقة» ثم آخرُها بنسبة `ratio` من الضيّق */
const widths = (ratio) => [...Array(30).fill(0.1), ...Array(12).fill(0.05), 0.05 * ratio];

describe("REG-TFPIN sqzExp.expRatio يتبع فريم الانضغاط", () => {
  it("تثبيت 4 ساعات يقيس التوسّع على 4 ساعات لا الساعة", () => {
    const c = { tfPin: "4h", bw: { "1h": widths(2.0), "4h": widths(1.0) }, k: {}, an: {} };
    expect(S.sqTf(c)).toBe("4h");
    // 4h: النسبة 1.0 < 1.3 ⇒ −1 · (الساعة كانت ستعطي 2.0 ⇒ +1)
    expect(gate("sqzExp", "expRatio").v(c)).toBe(-1);
  });
  it("بلا تثبيت يبقى السلوك كما كان (الساعة)", () => {
    const c = { bw: { "1h": widths(2.0), "4h": widths(1.0) }, k: {}, an: {} };
    expect(gate("sqzExp", "expRatio").v(c)).toBe(1);
  });
});

describe("REG-TFPIN pbTrend.volDry يقيس حجم فريم التراجع", () => {
  const bars = (lastV) => [...Array(20).fill(0).map((_, i) => ({ t: i * 1000, v: 100, h: 1, l: 0, c: 0.5 })),
                           { t: 20000, v: lastV, h: 1, l: 0, c: 0.5 }, { t: 21000, v: 1, h: 1, l: 0, c: 0.5 }];
  it("تثبيت 4 ساعات يقرأ حجم 4 ساعات", () => {
    // الساعة: دفعة 300 ⇒ 3× ⇒ −1 · 4 ساعات: 100 ⇒ 1× ⇒ +1
    const c = { tfPin: "4h", k: { "1h": bars(300), "4h": bars(100) }, an: { "4h": {}, "1h": {} } };
    expect(gate("pbTrend", "volDry").v(c)).toBe(1);
  });
  it("بلا تثبيت يبقى على الساعة", () => {
    const c = { k: { "1h": bars(300), "4h": bars(100) }, an: { "4h": {}, "1h": {} } };
    expect(gate("pbTrend", "volDry").v(c)).toBe(-1);
  });
});
