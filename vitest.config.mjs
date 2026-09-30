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
    /* في CI: مراسلُ GitHub يكتب اسم الاختبار الساقط وسببه في تعليقات التشغيل —
       سجلّات Actions تحتاج مصادقة، والتعليقات عامّة (وقع فشلٌ لم يُعرف سببه) */
    reporters: ["default", ["json", { outputFile: "reports/vitest-report.json" }],
                ...(process.env.GITHUB_ACTIONS ? ["github-actions"] : [])]
  }
});
