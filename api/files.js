// رفع وتنزيل الملفات في وضع التجربة المحلي فقط. عند النشر يتم الرفع مباشرة إلى Supabase Storage.
import { putLocal, getLocal } from "../lib/files.js";
import { hasDb } from "../lib/db.js";

export default async function handler(req, res) {
  if (hasDb) return res.status(404).json({ error: "not available" });
  const q = new URL(req.url, "http://x").searchParams;
  try {
    if (q.get("action") === "put" && req.method === "PUT") {
      const r = await putLocal(q.get("key"), q.get("t"), req.body, req.headers["content-type"] || "");
      return res.status(200).json({ ok: true, ...r });
    }
    if (q.get("action") === "get") {
      const f = getLocal(q.get("t"));
      if (!f) return res.status(404).json({ error: "الملف غير موجود" });
      res.setHeader("Content-Type", f.type || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
      return res.status(200).end(Buffer.from(f.data, "base64"));
    }
    return res.status(400).json({ error: "طلب غير معروف" });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}
