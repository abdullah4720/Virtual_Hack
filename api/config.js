import { getSettings, publicSettings } from "../lib/settings.js";
import { mailEnabled } from "../lib/mailer.js";
import { select } from "../lib/db.js";
import { maybeReminders } from "../lib/campaigns.js";
import { siteUrl } from "../lib/site.js";
import { resolveLogos, serveLogo } from "../lib/logos.js";

export default async function handler(req, res) {
  try {
    const logo = new URL(req.url, "http://x").searchParams.get("logo");
    if (logo) return serveLogo(logo, res);
    res.setHeader("Cache-Control", "no-store");
    const s = await getSettings();
    const p = publicSettings(s);
    p.brand.logos = await resolveLogos(s);
    // رقم الإصدار المنشور: تعيد الشاشات تحميل نفسها تلقائيًا عند نشر تحديث جديد
    p.version = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "";
    p.features = { mail: mailEnabled(), verifyEmail: Boolean(s.investor.verifyEmail && mailEnabled()) };
    // الإعلانات العامة (للصفحات والشاشات)
    const ann = (await select("announcements")).filter((a) => a.active && (a.audience === "all" || a.audience === "screens"));
    p.announcements = ann.reverse().slice(0, 10).map(({ id, title, body, audience, created_at }) => ({ id, title, body, audience, created_at }));
    // التذكيرات التلقائية تعمل مع الطلبات العادية (الشاشات تطلب هذا الرابط كل 15 ثانية)، مرة كل 10 دقائق على الأكثر
    await maybeReminders(s, siteUrl(req));
    return res.status(200).json(p);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "config failed" });
  }
}
