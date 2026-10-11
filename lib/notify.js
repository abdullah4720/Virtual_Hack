// محرك الإشعارات: قوالب قابلة للتعديل من لوحة التحكم، منع التكرار، وسجل لكل رسالة
import { insert, select, update } from "./db.js";
import { toDate } from "./settings.js";
import { mailEnabled, sendMailDetailed, layout, codeBox, escHtml } from "./mailer.js";

export const LOG = "mail_log";

// وصف كل رسالة: متى تُرسل، ولمن، وما المتغيرات المتاحة في نصها
const COMMON = ["hackathon", "investor", "event", "org"];
export const KINDS = {
  otp: { label: "رمز التحقق من البريد", when: "عند بدء عرض فكرة (إذا فُعّل التحقق من البريد)", to: "الزائر", vars: ["code"], locked: true, sample: { code: "482913" } },
  qualified: { label: "التأهل وتذكرة التسجيل", when: "عند تجاوز درجة التأهل في المستثمر الذكي", to: "الزائر", vars: ["name", "idea", "score", "qualify", "code"], sample: { name: "ريم", idea: "تطبيق مواعيد الأدوية", score: 72, qualify: 60, code: "Q-7KD2M9" } },
  notQualified: { label: "نتيجة من لم يتأهل", when: "عند انتهاء عرض فكرة لم تبلغ درجة التأهل", to: "الزائر", vars: ["name", "idea", "score", "qualify", "missing", "tips", "attemptsLeft"], sample: { name: "سلمان", idea: "منصة لتأجير الأدوات", score: 48, qualify: 60, missing: 12, tips: "• حدّد شريحة عملاء واحدة بعينها\n• اذكر سعرًا واضحًا ومن يدفع", attemptsLeft: 2 } },
  invite: { label: "رمز دعوة من المنظّمين", when: "عند توليد رموز دعوة مع بريد المدعوين", to: "المدعو", vars: ["name", "code"], sample: { name: "فريق كلية الحاسب", code: "I-4XR8PT" } },
  registered: { label: "تسجيل الفريق ورمزه", when: "عند تسجيل فريق", to: "الفريق", vars: ["team", "track", "code", "closesAt"], sample: { team: "فريق نخلة", track: "الزراعة · التمور", code: "H-93KQ", closesAt: "الخميس 17 أكتوبر 10:00 م" } },
  evaluated: { label: "نتيجة تقييم المشروع", when: "عند اكتمال تقييم الذكاء الاصطناعي لكل تقديم", to: "الفريق", vars: ["team", "project", "score", "attempt", "maxAttempts", "summary"], sample: { team: "فريق نخلة", project: "سوق التمور الذكي", score: 64, attempt: 1, maxAttempts: 3, summary: "فكرة واضحة، وتحتاج دليلًا على استعداد العملاء للدفع." } },
  finalists: { label: "التأهل للتحكيم النهائي", when: "عند الضغط على «إشعار المتأهلين»", to: "الفرق المتأهلة", vars: ["team", "project", "finalists"], sample: { team: "فريق نخلة", project: "سوق التمور الذكي", finalists: 5 } },
  winner: { label: "إعلان الفوز وشهاداته", when: "عند الضغط على «إرسال النتائج والشهادات» بعد نشر النتائج", to: "الفرق الفائزة (المراكز 1–3)", vars: ["team", "project", "rank", "score"], sample: { team: "فريق نخلة", project: "سوق التمور الذكي", rank: "الأول", score: 84.5 } },
  results: { label: "النتائج وشهادات المشاركة", when: "عند الضغط على «إرسال النتائج والشهادات» بعد نشر النتائج", to: "بقية الفرق المقدِّمة", vars: ["team", "project", "rank", "total", "score"], sample: { team: "فريق رعاية", project: "منبّه الأدوية", rank: 7, total: 24, score: 58 } },
  reminderClose: { label: "تذكير قبل الإقفال", when: "تلقائيًا قبل إقفال التقديم بعدد الساعات المحدد", to: "كل الفرق النشطة", vars: ["team", "hours", "closesAt", "status"], sample: { team: "فريق نخلة", hours: 24, closesAt: "الخميس 17 أكتوبر 10:00 م", status: "قدّمتم مشروعكم بدرجة 64، وما زال لديكم 2 محاولة لتحسينه." } },
  reminderNoSubmit: { label: "تذكير من لم يقدّم", when: "تلقائيًا بعد مرور المدة المحددة على التسجيل دون تقديم", to: "الفرق التي لم تقدّم", vars: ["team", "hours", "closesAt", "maxAttempts"], sample: { team: "فريق رعاية", hours: 12, closesAt: "الخميس 17 أكتوبر 10:00 م", maxAttempts: 3 } },
  judgeInvite: { label: "دعوة المحكّم ومفتاحه", when: "عند الضغط على «إرسال الدعوة» في قسم المحكّمين", to: "المحكّم", vars: ["name", "tracks", "code"], sample: { name: "د. أحمد", tracks: "كل المسارات", code: "JX7K2MPQ4R" } },
  judgeReminder: { label: "تذكير المحكّمين", when: "عند الضغط على «تذكير المحكّمين»", to: "المحكّمون الذين لم يكملوا", vars: ["name", "done", "total", "remaining"], sample: { name: "د. أحمد", done: 3, total: 5, remaining: 2 } },
  message: { label: "رسائل المنظّم الخاصة", when: "عند إرسال رسالة لفريق من قسم المشاركين", to: "الفريق", vars: ["title", "body"], custom: true, sample: { title: "تذكير بموعد العرض", body: "عرضكم أمام اللجنة الساعة 7 مساءً." } },
  announcement: { label: "الإعلانات بالبريد", when: "عند نشر إعلان مع خيار «إرسال بالبريد»", to: "الفرق أو المحكّمون", vars: ["title", "body"], custom: true, sample: { title: "تم تمديد التقديم", body: "يستمر التقديم حتى الساعة 10 مساءً." } },
};
export const COMMON_VARS = COMMON;

const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const fill = (t, v) => String(t ?? "").replace(/\{(\w+)\}/g, (m, k) => (v[k] == null ? "" : String(v[k])));

// تاريخ مقروء بالمنطقة الزمنية للفعالية
export function fmtDate(s, ms) {
  if (!ms) return "";
  const m = /^([+-])(\d\d):(\d\d)$/.exec(s.brand.tzOffset || "+03:00");
  const off = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 180;
  const d = new Date(ms + off * 60e3);
  return d.toLocaleString("ar-SA-u-nu-latn-ca-gregory", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
}
export const closesAtText = (s) => fmtDate(s, toDate(s.hackathon.closesAt, s.brand.tzOffset)) || "نهاية الفعالية";

// تجهيز الرسالة من القالب
export function render(s, kind, vars = {}, override = null) {
  const t = { ...(s.notify?.templates?.[kind] || {}), ...(override || {}) };
  const v = { hackathon: s.hackathon.name, investor: s.investor.title, event: s.brand.eventName, org: s.brand.orgName, ...vars };
  const paras = fill(t.body, v).split(/\n{2,}/).map((p) => `<p style="white-space:pre-wrap;margin:0 0 12px">${escHtml(p)}</p>`).join("");
  const box = vars.code && kind !== "message" && kind !== "announcement" ? codeBox(vars.code) : "";
  const certs = Array.isArray(vars.certs) && vars.certs.length
    ? `<table style="width:100%;border-collapse:collapse;margin:8px 0">${vars.certs.map((c) => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${escHtml(c.name)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:left"><a href="${escHtml(c.url)}" style="color:#1a1f36;font-weight:bold">عرض الشهادة ↗</a></td></tr>`).join("")}</table>`
    : "";
  const cta = vars.link && t.cta ? { url: vars.link, label: fill(t.cta, v) } : null;
  const subject = fill(t.subject, v).slice(0, 200);
  return { subject, html: layout(s, fill(t.title, v) || subject, paras + box + certs, cta) };
}

const uniqEmails = (to) => [...new Set((Array.isArray(to) ? to : [to]).map((e) => String(e || "").trim().toLowerCase()).filter(okEmail))];

// بريد الفريق: القائد + الأعضاء (إن فُعّل)
export const teamEmails = (s, team) => uniqEmails([team.email, ...(s.notify?.members !== false ? team.member_emails || [] : [])]);

// الإرسال: يحترم التشغيل/الإيقاف، ويمنع تكرار الرسالة نفسها (ref)، ويسجّل كل محاولة
export async function notify(s, kind, to, vars = {}, opts = {}) {
  const meta = KINDS[kind];
  const tpl = s.notify?.templates?.[kind];
  if (!meta || !tpl) return { status: "unknown", ok: false };
  if (!opts.force && !meta.locked && tpl.on === false) return { status: "off", ok: false };
  const list = uniqEmails(to);
  if (!list.length) return { status: "none", ok: false };
  const ref = opts.ref != null ? String(opts.ref) : null;
  if (ref) {
    const prev = await select(LOG, { kind, ref });
    if (prev.some((x) => x.status === "sent" || x.status === "sending")) return { status: "dup", ok: false };
  }
  const { subject, html } = render(s, kind, vars, opts.override);
  const base = { kind, ref, recipients: list.join(", ").slice(0, 1000), subject };
  if (!mailEnabled()) {
    await insert(LOG, { ...base, status: "skipped", error: "البريد غير مفعّل" }).catch(() => {});
    return { status: "skipped", ok: false };
  }
  let row = null;
  try { row = await insert(LOG, { ...base, status: "sending" }); } catch (e) { console.error("mail log", e.message); }
  const r = await sendMailDetailed(list, subject, html);
  if (row) await update(LOG, row.id, { status: r.ok ? "sent" : "failed", error: r.error ? String(r.error).slice(0, 300) : null }).catch(() => {});
  return { status: r.ok ? "sent" : "failed", ok: r.ok, error: r.error };
}

// آخر الرسائل للوحة التحكم
export async function mailLog(limit = 150) {
  const rows = await select(LOG);
  return rows.slice(-limit).reverse();
}
