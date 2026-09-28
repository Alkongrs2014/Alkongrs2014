import "./scripts/lib/pw-browsers.mjs";   // مسار المتصفّحات قبل أيّ تشغيل (المجدول لا يرى AppData المغلَّف)
import { defineConfig, devices } from "@playwright/test";

/* الواجهة على خادمٍ محليّ ببياناتٍ مثبّتة (حتمية في CI) أو بلقطةٍ من data/
   (`E2E_DATA`). سطحُ المكتب والهاتف معاً، وأثرٌ ولقطةُ شاشة عند الفشل. */
const PORT = Number(process.env.E2E_PORT || 8795);
/* `E2E_BASE` = رابطٌ حقيقي (التحقّق من المنشور) — بلا خادمٍ محليّ */
const REMOTE = process.env.E2E_BASE || null;
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.mjs/,
  timeout: 60000,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "reports/playwright-report.json" }]],
  use: { baseURL: REMOTE || `http://localhost:${PORT}/`, trace: "retain-on-failure", screenshot: "only-on-failure",
         serviceWorkers: "block" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ],
  webServer: REMOTE ? undefined : { command: "node tests/e2e/server.mjs", port: PORT, reuseExistingServer: !process.env.CI,
               env: { E2E_PORT: String(PORT), E2E_DATA: process.env.E2E_DATA || "" } }
});
