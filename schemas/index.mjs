/* =====================================================================
   مخطّطات JSON المنشورة — عقدٌ بنيويّ صارم (Ajv, draft-07).

   ولماذا في شيفرة لا في ملفّات `.json`: المخطّطات تتشارك تعريفات (الشمعة،
   الرقم المنتهي، مفاتيح الفريمات لكل دفتر) وتكرارُها نصّاً في عشرة ملفّات
   يجعلها تتباعد بأول تعديل — نفس علّة `plan.js` المشتركة.

   **ولماذا الرقم مطلوبٌ لا «رقمٌ أو null» في الحقول الحرجة**: JSON لا يحمل
   `NaN` — `JSON.stringify(NaN)` يكتب `null` بصمت. فالطريقة الوحيدة لالتقاط
   `NaN` المنشور هي أن يرفض المخطّطُ `null` حيث الرقم إلزاميّ (INV-18).

   ومفاتيحُ الفريمات **قائمةٌ مغلقة** (`propertyNames: enum`): ظهورُ `5m`
   في ملفّ سهم خرقٌ بنيويّ لا ينتظر فحصاً خاصّاً (INV-01..03).
   ===================================================================== */
export const STOCK_TFS = ["15m", "1h", "4h", "1d"];
export const CRYPTO_TFS = ["5m", "15m", "1h", "4h", "1d"];
export const TREND_TFS = ["1h", "4h", "1d"];

const num = { type: "number" };
const numOrNull = { type: ["number", "null"] };
const int = { type: "integer" };
const str = { type: "string" };
const bool = { type: "boolean" };
const dir = { enum: [-1, 0, 1] };
const bit = { enum: [0, 1] };
const epochS = { type: "integer", minimum: 1.6e9, maximum: 4e9 };      // ثوانٍ
const epochMs = { type: "integer", minimum: 1.6e12, maximum: 4e12 };   // ملّي

/* شمعةٌ مضغوطة [t,o,h,l,c,v] — الختم بالثواني، والأسعار موجبة */
const bar = { type: "array", minItems: 6, maxItems: 6,
  items: [epochS, { type: "number", exclusiveMinimum: 0 }, { type: "number", exclusiveMinimum: 0 },
          { type: "number", exclusiveMinimum: 0 }, { type: "number", exclusiveMinimum: 0 }, { type: ["number", "null"], minimum: 0 }] };
const series = { type: "object", required: ["c"], properties: { c: { type: "array", items: bar, minItems: 1 } } };
const tfMap = (tfs, v) => ({ type: "object", propertyNames: { enum: tfs }, additionalProperties: v });
const an = { type: "object", required: ["score", "px"],
  properties: { score: num, px: num, atr: numOrNull, rsi: numOrNull, e20: numOrNull, e50: numOrNull, e200: numOrNull } };

export const symSchema = (tfs) => ({
  type: "object", required: ["s", "tf", "an"],
  properties: {
    s: str, tf: tfMap(tfs, series), an: tfMap(tfs, an),
    /* السلسلة الممتدة للجلسة الممتدة وحدها — ‎15د‎ فقط */
    tfx: { type: "object", propertyNames: { enum: ["15m"] }, additionalProperties: series },
    anx: { type: "object", propertyNames: { enum: ["15m"] } },
    score: numOrNull, band: { enum: [0, 1, 2, 3, 4, null] }
  }
});

const summaryRow = (tfs, mkt) => ({
  type: "object", required: ["s", "p", "score", "band", "tfScore", "cbar", "pc"],
  properties: {
    s: str, p: num, pc: num, cbar: epochS, score: num, band: { enum: [0, 1, 2, 3, 4] },
    tfScore: tfMap(tfs, num), mkt: mkt === "crypto" ? { const: "crypto" } : { not: { const: "crypto" } },
    chg: numOrNull, atr: numOrNull, rsi: numOrNull
  }
});
export const summarySchema = (tfs, mkt) => ({
  type: "object", required: ["updated", "rows"],
  properties: { updated: epochMs, count: int, rows: { type: "array", minItems: 1, items: summaryRow(tfs, mkt) } }
});

const scanRow = {
  type: "object", required: ["s", "pc", "cbar", "q", "sd", "e", "st", "t"],
  properties: {
    s: str, pc: num, cbar: epochS, q: { type: "number", minimum: 0, maximum: 1 }, q0: numOrNull,
    sd: { enum: [-1, 1] }, cdir: dir, mixed: bit, scs: numOrNull, pct: numOrNull, n: int,
    e: num, st: num, t: { type: "array", items: num, maxItems: 3 }, hit: int, in: bit,
    since: epochS, px0: num
  }
};
const bySymRow = { type: "object", required: ["st", "dir", "sc", "act"],
  properties: { st: str, dir: { enum: [-1, 1] }, sc: num, act: bool, band: { enum: [0, 1, 2, 3] }, at: epochS } };
export const oppSchema = (tfs) => ({
  type: "object",
  required: ["generatedAt", "candleKey", "strategyVersion", "rowsHash", "count", "scans", "bySym", "sources"],
  properties: {
    generatedAt: epochMs, candleKey: epochS, candleKeyIso: str,
    strategyVersion: { type: "string", pattern: "^[0-9a-f]{12}$" },
    pipelineVersion: { type: "string", pattern: "^[0-9a-f]{12}$" },
    rowsHash: { type: "string", pattern: "^[0-9a-f]{12}$" }, count: int,
    scans: { type: "object", additionalProperties: { type: "array", items: scanRow } },
    bySym: { type: "object", additionalProperties: { type: "object",
      required: ["score", "band", "tf", "cbar", "rows"],
      properties: { score: num, band: { enum: [0, 1, 2, 3, 4] }, tf: tfMap(tfs, num), cbar: epochS,
                    scs: numOrNull, cdir: dir, mixed: bit, rows: { type: "array", items: bySymRow } } } },
    sources: { type: "object", required: ["confBar", "maxCbar"], properties: { confBar: epochS, maxCbar: epochS } }
  }
});

export const strategiesSchema = {
  type: "object", required: ["updated", "confBar", "rows", "strategies"],
  properties: {
    updated: epochMs, confBar: epochS, dirHold: int, actMin: num,
    strategies: { type: "array", minItems: 10, maxItems: 10 },
    rows: { type: "array", items: { type: "object", required: ["s", "st", "dir", "sc", "act"],
      properties: { s: str, st: str, dir: { enum: [-1, 1] }, sc: { type: "number", minimum: 0, maximum: 100 },
                    act: bool, band: { enum: [0, 1, 2, 3] }, ldir: dir } } },
    hold: { type: "object", additionalProperties: { type: "array", items: numOrNull } }
  }
};

export const marketDirSchema = {
  type: "object", required: ["updated", "tfs", "rows", "market"],
  properties: {
    updated: epochMs,
    tfs: { type: "array", items: { enum: TREND_TFS }, minItems: 3, maxItems: 3, uniqueItems: true },
    rows: { type: "array", items: { type: "object", required: ["s", "tf"],
      properties: { s: str, tf: { type: "object", propertyNames: { enum: TREND_TFS } } } } },
    market: { type: "object", required: ["dir"], properties: { dir: dir, pct: numOrNull } }
  }
};

export const marketSchema = {
  type: "object", required: ["updated", "status"],
  properties: { updated: epochMs, status: { type: "object", required: ["state"], properties: { state: str } } }
};

export const metaSchema = { type: "object", properties: { marketUpdated: epochMs } };

export const ma200Schema = {
  type: "object", required: ["updated", "bar", "rows"],
  properties: { updated: epochMs, bar: epochS, rows: { type: "array", items: { type: "object",
    required: ["s", "o", "dmin"], properties: { s: str, o: num, dmin: num } } } }
};

/* ملفّات كل دفتر ومخطّطاتها — `sym` تُطبَّق على كلّ ملفّ في `sym/` */
export const BOOK_SCHEMAS = {
  stocks: {
    "summary.json": summarySchema(STOCK_TFS, "stocks"),
    "opportunities.json": oppSchema(STOCK_TFS),
    "strategies.json": strategiesSchema,
    "market.json": marketSchema,
    "market-dir.json": marketDirSchema,
    "meta.json": metaSchema,
    "sym/*": symSchema(STOCK_TFS)
  },
  crypto: {
    "summary.json": summarySchema(["5m", "15m", "1h", "4h"], "crypto"),
    "opportunities.json": oppSchema(["5m", "15m", "1h", "4h"]),
    "strategies.json": strategiesSchema,
    "market.json": marketSchema,
    "ma200-open.json": ma200Schema,
    "sym/*": symSchema(CRYPTO_TFS)
  }
};
