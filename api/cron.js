// تشغيل مجدول (Vercel Cron) للتذكيرات، احتياطًا إن لم تكن هناك شاشات مفتوحة تطلب الإعدادات
import { getSettings } from "../lib/settings.js";
import { runReminders } from "../lib/campaigns.js";
import { siteUrl } from "../lib/site.js";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });
  try {
    const s = await getSettings();
    return res.status(200).json(await runReminders(s, siteUrl(req)));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
