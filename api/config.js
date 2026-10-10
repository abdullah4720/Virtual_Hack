import { getSettings, publicSettings } from "../lib/settings.js";
import { mailEnabled } from "../lib/mailer.js";
import { select } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    const s = await getSettings();
    const p = publicSettings(s);
    p.features = { mail: mailEnabled(), verifyEmail: Boolean(s.investor.verifyEmail && mailEnabled()) };
    // الإعلانات العامة (للصفحات والشاشات)
    const ann = (await select("announcements")).filter((a) => a.active && (a.audience === "all" || a.audience === "screens"));
    p.announcements = ann.reverse().slice(0, 10).map(({ id, title, body, audience, created_at }) => ({ id, title, body, audience, created_at }));
    return res.status(200).json(p);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "config failed" });
  }
}
