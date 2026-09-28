import { defineConfig } from "vitest/config";

/* مجموعات الاختبار — كلُّها بلا شبكة وبلا أيّ نموذج لغوي.
   `FC_RUNS` يرفع عدد حالات fast-check (الافتراضي 1000، والتعذيب 10000+). */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    testTimeout: 180000,
    hookTimeout: 180000,
    pool: "forks",
    reporters: ["default", ["json", { outputFile: "reports/vitest-report.json" }]]
  }
});
