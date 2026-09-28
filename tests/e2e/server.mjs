/* خادمٌ ثابت لاختبار الواجهة: `/stocks/*` من المستودع و`/data/*` من مجلّد
   بيانات يُختار بـ`E2E_DATA` (المثبّتات افتراضياً — حتمية، ولا تحتاج data/).
   `config.js` يقرأ `../data` على localhost، فالخريطة تطابق التشغيل المحلي. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA = path.resolve(process.env.E2E_DATA || path.join(ROOT, "tests/fixtures/data"));
const PORT = Number(process.env.E2E_PORT || 8795);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = null;
  if (u === "/" || u === "/stocks") { res.writeHead(302, { Location: "/stocks/" }); return res.end(); }
  if (u.startsWith("/stocks/")) f = path.join(ROOT, "stocks", u.slice(8) || "index.html");
  else if (u.startsWith("/data/")) f = path.join(DATA, u.slice(6));
  if (f && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!f || !f.startsWith(ROOT.slice(0, 2)) || !fs.existsSync(f)) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`e2e server :${PORT} data=${DATA}`));
