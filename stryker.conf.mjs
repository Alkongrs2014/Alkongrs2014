/* اختبار الطفرات — يقيس قوّة مجموعة الاختبار نفسها على المنطق الحرج:
   شروط الاستراتيجيات، النتيجة، اختيار الفريم، الاتجاه، الإجماع، الدمج،
   حرّاس الزمن وسلامة البيانات. الهدف ليس 100% عمياء بل قتلُ ما يهمّ،
   وتُبرَّر الناجية في reports/mutation-summary.json. */
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.stryker.config.mjs", related: false },
  coverageAnalysis: "perTest",
  mutate: [
    /* المحرّك V3 — مصدر الفرص (docs/ENGINE_V3_SPEC.md) */
    "stocks/engine3.js",
    "stocks/score.js",
    "stocks/direction.js",
    "stocks/confluence.js:96-158",
    "stocks/consensus.js:29-184",
    "stocks/indicators.js:476-756",
    "stocks/strategies.js:117-210",
    "stocks/strategies.js:450-505",
    "stocks/strategies.js:826-1389",
    "scripts/fetch-market.mjs:305-322",
    "scripts/lib/publish.mjs:48-52", "scripts/lib/publish.mjs:114-127"
  ],
  reporters: ["html", "json", "clear-text", "progress"],
  htmlReporter: { fileName: "reports/mutation-report.html" },
  jsonReporter: { fileName: "reports/mutation-report.json" },
  thresholds: { high: 85, low: 70, break: null },
  concurrency: 6,
  timeoutMS: 60000,
  tempDirName: ".stryker-tmp",
  ignorePatterns: ["/data", "/reports", "/node_modules", "/.stryker-tmp"]
};
