import { defineConfig } from "vitest/config";
/* مجموعةُ Stryker: الاختبارات السريعة التي تقتل الطفرات في المنطق الحرج.
   المستبعد: ما يُنشئ عمليات أو مستودعات (السباقات، الإعادة، التعذيب) —
   بطءٌ بلا قتلٍ إضافيّ لطفرات الرياضيات. */
export default defineConfig({
  test: {
    include: ["tests/golden/**/*.test.mjs", "tests/unit/libs.test.mjs", "tests/unit/boundaries.test.mjs", "tests/regression/known.test.mjs",
              "tests/regression/tfpin.test.mjs", "tests/property/**/*.test.mjs", "tests/metamorphic/**/*.test.mjs",
              "tests/reference/reference.test.mjs"],
    testTimeout: 120000, pool: "forks"
  }
});
