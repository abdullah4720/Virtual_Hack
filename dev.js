// تشغيل محلي للتجربة على اللابتوب:  node dev.js   ثم افتح http://localhost:3000
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import pitch from "./api/pitch.js";
import feed from "./api/feed.js";
import hack from "./api/hack.js";
import config from "./api/config.js";
import admin from "./api/admin.js";
import files from "./api/files.js";

const PORT = process.env.PORT || 3000;
const routes = { "/api/pitch": pitch, "/api/feed": feed, "/api/hack": hack, "/api/config": config, "/api/admin": admin, "/api/files": files };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".pdf": "application/pdf" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const handler = routes[url.pathname];
    if (handler) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      const isJson = (req.headers["content-type"] || "").includes("json");
      req.body = isJson || (!raw.length) ? (raw.length ? JSON.parse(raw.toString("utf8")) : {}) : raw;
      res.status = (s) => ((res.statusCode = s), res);
      res.json = (o) => (res.setHeader("Content-Type", "application/json; charset=utf-8"), res.end(JSON.stringify(o)));
      return handler(req, res);
    }
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!extname(p)) p += ".html"; // روابط بدون .html مثل /screen و /hackathon
    try {
      const file = join("public", normalize(p).replace(/^(\.\.[/\\])+/, ""));
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  })
  .listen(PORT, () => {
    console.log(`\n  صفحة الترحيب:  http://localhost:${PORT}/welcome`);
    console.log(`  صفحة الزائر:   http://localhost:${PORT}`);
    console.log(`  شاشة العرض:    http://localhost:${PORT}/screen`);
    console.log(`  الهاكاثون:      http://localhost:${PORT}/hackathon`);
    console.log(`  شاشة الجناح:   http://localhost:${PORT}/booth   (تتناوب بين الشاشتين)`);
    console.log(`  لوحة اللجنة:   http://localhost:${PORT}/judges  (المفتاح المحلي: demo)`);
    console.log(`  إعلان الفائزين: http://localhost:${PORT}/winners`);
    console.log(`  لوحة التحكم:   http://localhost:${PORT}/admin   (المفتاح المحلي: admin)`);
    console.log(process.env.ANTHROPIC_API_KEY ? "  الذكاء الاصطناعي: مفعّل ✅" : "  وضع التجربة (بدون مفتاح API) ⚠️");
    console.log(process.env.SUPABASE_URL ? "  التخزين: Supabase ✅\n" : "  التخزين: ذاكرة مؤقتة ⚠️\n");
  });
