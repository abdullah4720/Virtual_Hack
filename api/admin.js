// لوحة التحكم: /api/admin?action=...   (تتطلب الترويسة x-admin-key)
import { getSettings, saveSettings, ADMIN_KEY, judgeKey, phase, optionLabel } from "../lib/settings.js";
import { DEFAULTS } from "../lib/defaults.js";
import { select, insert, update, removeAll, removeOne, hasDb, schemaCheck } from "../lib/db.js";
import { aiAvailable, aiMode, MODEL, EVAL_MODEL, askOnce, explainAiError } from "../lib/ai.js";
import { T, standings, runEvaluation, ensureCerts, certKind, expectedJudges, judgingOrder } from "../lib/hackcore.js";
import { createTicket, TICKETS } from "../lib/tickets.js";
import { usageToday, USAGE } from "../lib/limits.js";
import { mailEnabled } from "../lib/mailer.js";
import { notify, render as renderMail, teamEmails, mailLog, KINDS, COMMON_VARS, LOG } from "../lib/notify.js";
import { runReminders, sendResults, remindJudges } from "../lib/campaigns.js";
import { siteUrl } from "../lib/site.js";
import { keyProblem } from "../lib/supabase.js";
import { hashPassword, passwordProblem } from "../lib/password.js";
import { resolveLogos, storeLogo } from "../lib/logos.js";
import { remove as removeFile } from "../lib/files.js";

const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const csvCell = (v) => {
  const s = v == null ? "" : Array.isArray(v) ? v.join(" | ") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = (head, rows) => "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!ADMIN_KEY) return res.status(503).json({ error: "لم يُضبط ADMIN_KEY في متغيرات البيئة" });
  if (req.headers["x-admin-key"] !== ADMIN_KEY) return res.status(401).json({ error: "مفتاح الإدارة غير صحيح" });
  if (keyProblem) return res.status(503).json({ error: keyProblem });

  const q = new URL(req.url, "http://x").searchParams;
  const action = q.get("action");
  const b = req.body || {};

  try {
    const s = await getSettings();
    const site = siteUrl(req);

    // ---------- نظرة عامة + الإعدادات ----------
    if (action === "get") {
      const [deals, { teams, subs, rows }, tickets, ann, used, missing] = await Promise.all([select("deals"), standings(s), select(TICKETS), select("announcements"), usageToday(), schemaCheck().catch(() => [])]);
      const invested = deals.filter((d) => d.decision === "invest");
      return res.status(200).json({
        settings: s,
        logoPreview: Object.fromEntries((await resolveLogos(s)).map((l, i) => [s.brand.logos[i]?.src, l.url])),
        defaults: DEFAULTS,
        notifyKinds: KINDS, notifyCommon: COMMON_VARS,
        tickets: tickets.slice(-300).reverse().map((t) => ({
          id: t.id, code: t.code, kind: t.kind, name: t.name, email: t.email, label: t.label, used: Boolean(t.used_by_team), created_at: t.created_at,
          score: t.deal_id ? deals.find((d) => d.id === t.deal_id)?.score ?? null : null,
          team: t.used_by_team ? teams.find((x) => x.id === t.used_by_team)?.name ?? "" : "",
        })),
        announcements: ann.reverse().map((a) => ({ ...a, teamName: a.audience.startsWith("team:") ? teams.find((t) => `team:${t.id}` === a.audience)?.name || "" : "" })),
        system: {
          database: hasDb, ai: aiAvailable(), aiMode: aiMode(), model: MODEL, evalModel: EVAL_MODEL, mail: mailEnabled(),
          judgeKeySet: Boolean(await judgeKey()) || (s.hackathon.judges || []).length > 0, phase: phase(s),
          usageToday: used, dailyAiCalls: s.limits.dailyAiCalls, schemaMissing: missing,
        },
        stats: {
          pitches: deals.length, deals: invested.length, investedTotal: invested.reduce((a, d) => a + (Number(d.amount) || 0), 0),
          teams: teams.length, activeTeams: teams.filter((t) => t.status !== "disqualified").length,
          submissions: subs.length, evaluated: rows.length,
          pendingEvals: subs.filter((x) => x.status === "pending" || x.status === "failed").length,
          fromInvestor: teams.filter((t) => t.source === "investor").length,
          qualified: deals.filter((d) => d.qualified).length, ticketsUsed: tickets.filter((t) => t.used_by_team).length,
          judged: rows.filter((r) => r.finalist && r.judges.some((j) => !j.coi)).length, finalists: Math.min(s.hackathon.finalists, rows.length),
        },
      });
    }

    if (action === "save" && req.method === "POST") {
      const wasPublished = Boolean(s.hackathon.resultsPublished);
      const r = await saveSettings(b.settings);
      // عند إعلان النتائج: إشعار تلقائي يظهر للفرق في صفحاتها وعلى الشاشات
      if (r.ok && !wasPublished && r.settings.hackathon.resultsPublished) {
        const H = r.settings.hackathon;
        await insert("announcements", { title: `أُعلنت نتائج ${H.name}`, body: `شكرًا لجميع الفرق المشاركة. النتيجة وشهادات الأعضاء متاحة الآن في صفحة كل فريق${(H.awards || "track") === "track" ? "، ومبروك للفائزين بالمركز الأول في كل مسار" : "، ومبروك للفائزين"}.`, audience: "all", active: true });
      }
      return res.status(r.ok ? 200 : 400).json(r);
    }

    // ---------- المشاركون ----------
    if (action === "teams") {
      const { teams, subs, rows } = await standings(s);
      const byId = new Map(rows.map((r) => [r.team.id, r]));
      return res.status(200).json({
        teams: teams.map((t) => {
          const r = byId.get(t.id), ts = subs.filter((x) => x.team_id === t.id);
          return {
            id: t.id, code: t.code, name: t.name, members: t.members, email: t.email, phone: t.phone, status: t.status || "active",
            label: optionLabel(s, t.track, t.challenge), source: t.source, created_at: t.created_at,
            attempts: ts.length, pending: ts.filter((x) => x.status === "pending" || x.status === "failed").length,
            best: r ? r.best.ai_total : null, title: r?.best.title || ts[ts.length - 1]?.title || "", rank: r?.rank ?? null,
            finalist: Boolean(r?.finalist), flagged: Boolean(r?.flagged), judgeAvg: r?.judgeAvg ?? null, final: r?.final ?? null,
            files: (t.files || []).length, hasPassword: Boolean(t.password_hash),
          };
        }).reverse(),
      });
    }

    if (action === "team-status" && req.method === "POST") {
      const status = b.status === "disqualified" ? "disqualified" : "active";
      await update(T.teams, Number(b.id), { status });
      return res.status(200).json({ ok: true });
    }

    // ---------- حذف فريق نهائيًا: تقديماته ودرجاته وملفاته ورسائله، وتحرير رمز التأهل ليُستخدم من جديد ----------
    if (action === "team-delete" && req.method === "POST") {
      const id = Number(b.id);
      const [team] = await select(T.teams, { id });
      if (!team) return res.status(404).json({ error: "الفريق غير موجود" });
      if (b.confirm !== team.name) return res.status(400).json({ error: "اكتب اسم الفريق كما هو للتأكيد" });
      const subs = (await select(T.subs)).filter((x) => x.team_id === id);
      const keys = new Set([...(team.files || []), ...subs.flatMap((x) => x.files || [])].map((f) => f?.key).filter(Boolean));
      for (const k of keys) { try { await removeFile(k); } catch (e) { console.error("file delete", k, e.message); } }
      for (const x of (await select(T.scores)).filter((x) => x.team_id === id)) await removeOne(T.scores, x.id);
      for (const x of subs) await removeOne(T.subs, x.id);
      for (const x of (await select("announcements")).filter((x) => x.audience === `team:${id}`)) await removeOne("announcements", x.id);
      for (const t of (await select(TICKETS)).filter((x) => x.used_by_team === id)) await update(TICKETS, t.id, { used_by_team: null, used_at: null, deal_id: null });
      await removeOne(T.teams, id);
      // عرض الفكرة الذي تأهل منه الفريق يُحذف أيضًا، فيختفي من شاشات الجناح ولوحة البيانات
      // وكل محاولاته السابقة في المستثمر الذكي (ببريده نفسه)، حتى لا يبقى له أثر على الشاشات
      let pitch = 0;
      {
        const [d] = team.deal_id ? await select("deals", { id: team.deal_id }) : [];
        // بريد صاحب العرض + بريد القائد والأعضاء (لمن سجّل مباشرة أو بدعوة وعرض فكرته منفصلًا)
        const mails = new Set([d?.email, team.email, ...(team.member_emails || [])].map((e) => String(e || "").trim().toLowerCase()).filter(Boolean));
        const mine = (await select("deals")).filter((x) => x.id === team.deal_id || mails.has(String(x.email || "").trim().toLowerCase()));
        const usedByOthers = new Set((await select(T.teams)).filter((t) => t.id !== id && t.deal_id).map((t) => t.deal_id));
        for (const x of mine) {
          if (usedByOthers.has(x.id)) continue;
          for (const t of (await select(TICKETS)).filter((t) => t.deal_id === x.id && !t.used_by_team)) await removeOne(TICKETS, t.id);
          await removeOne("deals", x.id); pitch++;
        }
      }
      // إزالة الفريق من إسناد اللجان وترتيب العرض
      const J = s.hackathon.judging;
      if (J && (J.assign?.[String(id)] || J.order?.[String(id)])) {
        const next = JSON.parse(JSON.stringify(s)); delete next.hackathon.judging.assign[String(id)]; delete next.hackathon.judging.order[String(id)];
        await saveSettings(next);
      }
      return res.status(200).json({ ok: true, files: keys.size, submissions: subs.length, ticketFreed: Boolean(team.ticket), pitch });
    }

    // ---------- عروض الأفكار في المستثمر الذكي: القائمة والحذف ----------
    if (action === "pitches") {
      const [deals, tickets, teams] = await Promise.all([select("deals"), select(TICKETS), select(T.teams)]);
      return res.status(200).json({
        pitches: deals.sort((a, c) => Date.parse(c.created_at) - Date.parse(a.created_at)).map((d) => {
          const tk = tickets.find((t) => t.deal_id === d.id), tm = teams.find((t) => t.deal_id === d.id);
          return { id: d.id, at: d.created_at, name: d.name, email: d.email || "", title: d.title || "", idea: d.idea || "", score: d.score, qualified: Boolean(d.qualified), ticket: tk?.code || null, team: tm?.name || null };
        }),
      });
    }
    // حذف متأهل أو رمز دعوة واحد من «التأهيل والدعوات»: رمز التأهل يُحذف مع عرض فكرته فيختفي من الشاشات
    if (action === "ticket-delete" && req.method === "POST") {
      const [t] = await select(TICKETS, { id: Number(b.id) });
      if (!t) return res.status(404).json({ error: "الرمز غير موجود" });
      if (t.used_by_team) {
        const team = (await select(T.teams, { id: t.used_by_team }))[0];
        return res.status(409).json({ error: `هذا الرمز سجّل به فريق «${team?.name || ""}». احذف الفريق من «المشاركون» ليُحذف معه.` });
      }
      if (t.deal_id) {
        const team = (await select(T.teams)).find((x) => x.deal_id === t.deal_id);
        if (team) return res.status(409).json({ error: `صاحب هذا التأهل سجّل فريق «${team.name}». احذف الفريق من «المشاركون» ليُحذف معه.` });
        if ((await select("deals", { id: t.deal_id })).length) await removeOne("deals", t.deal_id);
      }
      await removeOne(TICKETS, t.id);
      return res.status(200).json({ ok: true });
    }

    if (action === "pitch-delete" && req.method === "POST") {
      const id = Number(b.id);
      const [d] = await select("deals", { id });
      if (!d) return res.status(404).json({ error: "العرض غير موجود" });
      const team = (await select(T.teams)).find((t) => t.deal_id === id);
      if (team) return res.status(409).json({ error: `هذا العرض سجّل به فريق «${team.name}». احذف الفريق من «المشاركون» ليُحذف معه.` });
      // رمز التأهل غير المستخدم يُلغى مع العرض
      for (const t of (await select(TICKETS)).filter((x) => x.deal_id === id)) await removeOne(TICKETS, t.id);
      await removeOne("deals", id);
      return res.status(200).json({ ok: true });
    }

    // كلمات مرور الفرق: تُعيّنها الإدارة وتسلّمها للفرق (لا تُرسل بالبريد)
    const genPass = () => { const A = "abcdefghjkmnpqrstuvwxyz23456789"; return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(10)), (x) => A[x % A.length]).join(""); };
    if (action === "team-password" && req.method === "POST") {
      const [team] = await select(T.teams, { id: Number(b.id) });
      if (!team) return res.status(404).json({ error: "الفريق غير موجود" });
      const pass = clip(b.password, 100) || genPass();
      const err = passwordProblem(pass);
      if (err) return res.status(400).json({ error: err });
      await update(T.teams, team.id, { password_hash: await hashPassword(pass) });
      return res.status(200).json({ password: pass, email: team.email, team: team.name, code: team.code });
    }
    // توليد كلمات مرور لكل الفرق التي ليس لها كلمة مرور (تُعرض مرة واحدة لتنزيلها)
    if (action === "passwords-bulk" && req.method === "POST") {
      const list = [];
      for (const t of (await select(T.teams)).filter((t) => !t.password_hash && t.status !== "disqualified")) {
        const pass = genPass();
        await update(T.teams, t.id, { password_hash: await hashPassword(pass) });
        list.push({ team: t.name, email: t.email, members: (t.member_emails || []).filter(Boolean), code: t.code, password: pass });
      }
      return res.status(200).json({ list });
    }

    // رسالة لفريق محدد: إعلان شخصي + بريد
    if (action === "message" && req.method === "POST") {
      const [team] = await select(T.teams, { id: Number(b.team_id) });
      if (!team) return res.status(404).json({ error: "الفريق غير موجود" });
      const title = clip(b.title, 120), body = clip(b.body, 2000);
      if (!title) return res.status(400).json({ error: "اكتب عنوان الرسالة" });
      await insert("announcements", { title, body, audience: `team:${team.id}`, active: true });
      const emailed = (await notify(s, "message", teamEmails(s, team), { title, body, link: `${site}/hackathon?code=${team.code}` })).ok;
      return res.status(200).json({ ok: true, emailed });
    }

    // ---------- الإعلانات ----------
    if (action === "announce" && req.method === "POST") {
      const title = clip(b.title, 120), body = clip(b.body, 2000);
      const audience = ["all", "participants", "judges", "screens"].includes(b.audience) ? b.audience : "all";
      if (!title) return res.status(400).json({ error: "اكتب عنوان الإعلان" });
      await insert("announcements", { title, body, audience, active: true });
      let emailed = 0;
      if (b.email) {
        if (audience === "judges") for (const j of s.hackathon.judges || []) emailed += (await notify(s, "announcement", j.email, { title, body, link: `${site}/judges` })).ok ? 1 : 0;
        else if (audience !== "screens") for (const t of (await select(T.teams)).filter((t) => t.status !== "disqualified")) emailed += (await notify(s, "announcement", teamEmails(s, t), { title, body, link: `${site}/hackathon?code=${t.code}` })).ok ? 1 : 0;
      }
      return res.status(200).json({ ok: true, emailed });
    }
    if (action === "announce-toggle" && req.method === "POST") {
      await update("announcements", Number(b.id), { active: Boolean(b.active) });
      return res.status(200).json({ ok: true });
    }
    if (action === "announce-delete" && req.method === "POST") {
      await removeOne("announcements", Number(b.id));
      return res.status(200).json({ ok: true });
    }

    // ---------- المحكّمون: إرسال الدعوات ----------
    if (action === "judge-invite" && req.method === "POST") {
      const list = (s.hackathon.judges || []).filter((j) => !b.id || j.id === b.id);
      let sent = 0;
      for (const j of list) {
        const tracks = j.tracks?.length ? j.tracks.map((id) => s.hackathon.tracks.find((t) => t.id === id)?.title).filter(Boolean).join("، ") : "كل المسارات";
        sent += (await notify(s, "judgeInvite", j.email, { name: j.name, tracks, code: j.key, link: `${site}/judges` }, { force: true })).ok ? 1 : 0;
      }
      return res.status(200).json({ sent, total: list.length, mail: mailEnabled() });
    }

    // ---------- التقييمات المعلّقة ----------
    if (action === "reeval" && req.method === "POST") {
      const subs = (await select(T.subs)).filter((x) => x.status === "pending" || x.status === "failed");
      const teams = await select(T.teams);
      let ok = 0;
      for (const x of subs.slice(0, 10)) {
        const team = teams.find((t) => t.id === x.team_id);
        if (team && (await runEvaluation(s, x, team, { link: `${site}/hackathon?code=${team.code}` }))) ok++;
      }
      return res.status(200).json({ evaluated: ok, remaining: subs.length - ok });
    }

    // ---------- إشعار المتأهلين ----------
    if (action === "notify-finalists" && req.method === "POST") {
      const { rows } = await standings(s);
      let sent = 0;
      const H = s.hackathon, sc = H.judging?.scope;
      for (const r of rows.filter((x) => x.finalist)) {
        const title = `مبروك: تأهل فريق «${r.team.name}» للتحكيم النهائي`;
        // وصف التأهل حسب نطاق التحكيم: أفضل N في المسار، أو أفضل N إجمالًا، أو كل المشاريع
        const best = (n) => (n === 1 ? "أفضل مشروع" : n === 2 ? "أفضل مشروعين" : `أفضل ${n} مشاريع`);
        const group = sc === "perTrack" ? `${best(H.finalistsPerTrack)} في مسار «${(H.tracks.find((t) => t.id === r.team.track) || {}).title || r.label}»` : sc === "all" ? "المشاريع المتأهلة للتحكيم النهائي" : best(H.finalists);
        await insert("announcements", { title, body: `مشروعكم «${r.best.title}» ضمن ${group}، وسيقيّمه أعضاء لجنة التحكيم.`, audience: `team:${r.team.id}`, active: true });
        sent += (await notify(s, "finalists", teamEmails(s, r.team), { team: r.team.name, project: r.best.title, finalists: group, link: `${site}/hackathon?code=${r.team.code}` }, { ref: r.team.id })).ok ? 1 : 0;
      }
      return res.status(200).json({ ok: true, emailed: sent });
    }

    // ---------- اختبار الذكاء الاصطناعي (يبيّن سبب الفشل إن وُجد) ----------
    if (action === "ai-test" && req.method === "POST") {
      if (!aiAvailable()) return res.status(200).json({ ok: false, error: "لا يوجد مفتاح: أضف ANTHROPIC_API_KEY في إعدادات Vercel ثم أعد النشر (Redeploy)." });
      const out = [];
      for (const [label, m] of [["المحادثة", "chat"], ["التقييم", "eval"]]) {
        const t0 = Date.now();
        try {
          const r = await askOnce('Reply with JSON only: {"ok": true}', "ping", 20, 0, m === "eval" ? EVAL_MODEL : MODEL);
          out.push({ label, model: m === "eval" ? EVAL_MODEL : MODEL, ok: r?.ok === true, ms: Date.now() - t0 });
        } catch (e) {
          out.push({ label, model: m === "eval" ? EVAL_MODEL : MODEL, ok: false, error: explainAiError(e), raw: String(e.message).slice(0, 300) });
        }
      }
      return res.status(200).json({ ok: out.every((x) => x.ok), results: out });
    }

    // ---------- رفع شعار ----------
    if (action === "logo-upload" && req.method === "POST") {
      try { const src = await storeLogo(String(b.data || "")); return res.status(200).json({ src, preview: hasDb ? `api/config?logo=${src.slice(5)}` : b.data }); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }

    // ---------- الإشعارات ----------
    if (action === "mail-log") {
      const rows = await mailLog(200);
      const all = await select(LOG);
      const by = (st) => all.filter((x) => x.status === st).length;
      return res.status(200).json({ log: rows, totals: { sent: by("sent"), failed: by("failed"), skipped: by("skipped"), sending: by("sending") }, mail: mailEnabled() });
    }
    // معاينة رسالة بنص القالب الحالي (حتى قبل الحفظ) وبيانات تجريبية
    if (action === "notify-preview" && req.method === "POST") {
      const kind = String(b.kind || "");
      if (!KINDS[kind]) return res.status(400).json({ error: "نوع رسالة غير معروف" });
      const vars = { ...KINDS[kind].sample, link: `${site}/` };
      if (kind === "winner" || kind === "results") vars.certs = [{ name: "سارة", url: `${site}/certificate?c=C-SAMPLE01` }, { name: "محمد", url: `${site}/certificate?c=C-SAMPLE02` }];
      const tpl = b.template && typeof b.template === "object" ? { subject: clip(b.template.subject, 200), title: clip(b.template.title, 200), body: clip(b.template.body, 3000), cta: clip(b.template.cta, 60) } : null;
      const out = renderMail(s, kind, vars, tpl);
      if (b.to) {
        const r = await notify(s, kind, String(b.to), vars, { force: true, override: tpl });
        return res.status(r.ok ? 200 : 400).json({ ...out, sent: r.ok, status: r.status, error: r.ok ? null : r.error || (r.status === "skipped" ? "البريد غير مفعّل (RESEND_API_KEY و MAIL_FROM)" : "تعذّر الإرسال") });
      }
      return res.status(200).json(out);
    }
    if (action === "run-reminders" && req.method === "POST") {
      if (!mailEnabled()) return res.status(400).json({ error: "البريد غير مفعّل" });
      return res.status(200).json(await runReminders(s, site));
    }
    if (action === "send-results" && req.method === "POST") {
      if (!s.hackathon.resultsPublished) return res.status(400).json({ error: "فعّل «نشر النتائج» واحفظ أولًا، كي تصل شهادات الفوز الصحيحة" });
      return res.status(200).json(await sendResults(s, site));
    }
    if (action === "remind-judges" && req.method === "POST") {
      return res.status(200).json(await remindJudges(s, site));
    }

    // ---------- إدارة التحكيم: المشاريع، الإسناد، تقدّم كل محكّم ----------
    if (action === "judging") {
      const { rows } = await standings(s);
      const J = s.hackathon.judging;
      const pool = rows.filter((r) => r.finalist && r.team.status !== "disqualified");
      const projects = pool.map((r) => {
        const exp = expectedJudges(s, r.team);
        const scored = new Set(r.judges.map((x) => x.judge_id));
        const vals = r.judges.filter((x) => !x.coi).map((x) => x.score);
        return {
          id: r.team.id, name: r.team.name, title: r.best.title, label: r.label, track: r.team.track, rank: r.rank,
          ai: r.best.ai_total, committee: J.assign[String(r.team.id)] || null, order: judgingOrder(s, r.team),
          expected: exp.map((j) => ({ id: j.id, name: j.name, done: scored.has(j.id) })),
          done: exp.filter((j) => scored.has(j.id)).length,
          scores: r.judges.map((x) => ({ judge_id: x.judge_id, judge: x.judge, score: x.score, coi: x.coi, note: x.note, at: x.at })),
          judgeAvg: r.judgeAvg, final: r.final, finalRank: r.finalRank ?? null, trackRank: r.trackRank ?? null, award: r.award ?? null,
          spread: vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0, flagged: r.flagged,
        };
      });
      const judges = (s.hackathon.judges || []).map((j) => {
        const mine = pool.filter((r) => expectedJudges(s, r.team).some((x) => x.id === j.id));
        const own = mine.map((r) => r.judges.find((x) => x.judge_id === j.id)).filter(Boolean);
        const last = own.map((x) => x.at).filter(Boolean).sort().pop() || null;
        return { id: j.id, name: j.name, email: j.email, total: mine.length, done: own.length, coi: own.filter((x) => x.coi).length, last };
      });
      const others = rows.length - pool.length;
      return res.status(200).json({ projects, judges, others, submitted: rows.length });
    }
    if (action === "judge-reset" && req.method === "POST") {
      const team = Number(b.team_id);
      if (!team) return res.status(400).json({ error: "الفريق غير محدد" });
      const all = (await select(T.scores)).filter((x) => x.team_id === team && (b.judge_id ? x.judge_id === b.judge_id : !b.judge || x.judge === b.judge));
      for (const x of all) await removeOne(T.scores, x.id);
      return res.status(200).json({ ok: true, removed: all.length });
    }

    // ---------- بيانات التقرير الختامي والكتيّب ----------
    if (action === "report") {
      const [deals, { teams, subs, rows }, tickets] = await Promise.all([select("deals"), standings(s), select(TICKETS)]);
      const byDay = {};
      for (const x of [...deals, ...subs]) { const d = String(x.created_at).slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; }
      const tracks = s.hackathon.tracks.map((t) => ({ title: t.title, icon: t.icon, teams: teams.filter((x) => x.track === t.id).length }));
      const finals = rows.filter((r) => r.finalist).sort((a, c) => (c.final ?? c.best.ai_total) - (a.final ?? a.best.ai_total));
      const subsByTeam = new Map();
      for (const x of subs) subsByTeam.set(x.team_id, [...(subsByTeam.get(x.team_id) || []), x]);
      return res.status(200).json({
        settings: { ...s, brand: { ...s.brand, logos: await resolveLogos(s) } },
        stats: {
          pitches: deals.length, qualified: deals.filter((d) => d.qualified).length,
          avgPitch: deals.length ? Math.round(deals.reduce((a, d) => a + (d.score || 0), 0) / deals.length) : 0,
          teams: teams.filter((t) => t.status !== "disqualified").length, members: teams.reduce((a, t) => a + (t.members || []).length, 0),
          submissions: subs.length, evaluated: rows.length,
          avgScore: rows.length ? Math.round(rows.reduce((a, r) => a + r.best.ai_total, 0) / rows.length) : 0,
          fromInvestor: teams.filter((t) => t.source === "investor").length, invites: tickets.filter((t) => t.kind === "invite" && t.used_by_team).length,
          improved: [...subsByTeam.values()].filter((l) => l.length > 1 && l[l.length - 1].ai_total > l[0].ai_total).length,
        },
        byDay, tracks,
        awards: s.hackathon.awards || "track",
        winners: ((s.hackathon.awards || "track") === "track" ? [...finals].sort((a, c) => (a.trackRank || 99) - (c.trackRank || 99) || (c.final ?? c.best.ai_total) - (a.final ?? a.best.ai_total)) : finals).map((r, i) => ({ place: (s.hackathon.awards || "track") === "track" ? (r.trackRank === 1 ? 1 : 4) : i + 1, winner: Boolean(r.award), trackTitle: r.trackTitle, team: r.team.name, members: r.team.members, title: r.best.title, label: r.label, ai: r.best.ai_total, judges: r.judgeAvg, final: r.final })),
        projects: rows.map((r) => ({
          rank: r.rank, team: r.team.name, members: r.team.members, label: r.label, title: r.best.title, problem: r.best.problem, solution: r.best.solution,
          customer: r.best.customer, business: r.best.business, score: r.best.ai_total, summary: r.best.ai_feedback?.summary || "", finalist: r.finalist,
          attempts: r.attempts, first: (subsByTeam.get(r.team.id) || [])[0]?.ai_total ?? null,
        })),
      });
    }

    // ---------- الشهادات (روابط لكل عضو) ----------
    if (action === "certs") {
      const { teams, rows, subs } = await standings(s);
      const out = [];
      for (const t of teams.filter((t) => t.status !== "disqualified" && subs.some((x) => x.team_id === t.id))) {
        const codes = await ensureCerts(t);
        const row = rows.find((r) => r.team.id === t.id);
        out.push({ team: t.name, kind: certKind(s, row), list: t.members.map((m, i) => ({ name: m, code: codes[i] })) });
      }
      return res.status(200).json({ certs: out });
    }

    // ---------- رموز الدعوة ----------
    if (action === "invites" && req.method === "POST") {
      const label = clip(b.label, 60);
      // قائمة مدعوين (سطر لكل مدعو: «الاسم، البريد» أو البريد وحده) ← رمز لكل مدعو يُرسل بالبريد
      const people = String(b.people || "").split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 200).map((l) => {
        const email = (l.match(/[^\s,،<>]+@[^\s,،<>]+\.[^\s,،<>]+/) || [""])[0].toLowerCase();
        const name = clip(l.replace(email, "").replace(/[<>,،\-–:]+/g, " "), 60);
        return { name, email };
      });
      const bad = people.filter((p) => !p.email);
      if (bad.length) return res.status(400).json({ error: `لا يوجد بريد صحيح في: ${bad.slice(0, 3).map((p) => p.name || "سطر فارغ").join("، ")}` });
      const codes = [], sent = { sent: 0, skipped: 0, failed: 0, off: 0 };
      if (people.length) {
        for (const p of people) {
          const code = (await createTicket({ kind: "invite", label, name: p.name || "", email: p.email })).code;
          codes.push(code);
          const r = await notify(s, "invite", p.email, { name: p.name || "بك", code, link: `${site}/hackathon?ticket=${code}` });
          sent[r.status] = (sent[r.status] || 0) + 1;
        }
      } else {
        const n = Math.min(100, Math.max(1, Math.round(Number(b.count) || 1)));
        for (let i = 0; i < n; i++) codes.push((await createTicket({ kind: "invite", label })).code);
      }
      return res.status(200).json({ codes, mail: people.length ? sent : null });
    }

    // ---------- حذف البيانات ----------
    if (action === "reset" && req.method === "POST") {
      const scope = b.scope;
      if (b.confirm !== "حذف") return res.status(400).json({ error: "اكتب كلمة «حذف» للتأكيد" });
      if (scope === "investor" || scope === "all") { await removeAll("deals"); await removeAll(TICKETS); await removeAll("otp"); }
      if (scope === "hackathon" || scope === "all") {
        // الملفات المرفوعة (العروض والمرفقات) تُحذف من التخزين أيضًا
        const [teams, subs] = await Promise.all([select(T.teams), select(T.subs)]);
        const keys = new Set([...teams.flatMap((t) => t.files || []), ...subs.flatMap((x) => x.files || [])].map((f) => f?.key).filter(Boolean));
        for (const k of keys) { try { await removeFile(k); } catch (e) { console.error("file delete", k, e.message); } }
        await removeAll(T.scores); await removeAll(T.subs); await removeAll(T.teams);
        // إسناد اللجان وترتيب العرض كانا لفرق محذوفة
        if (Object.keys(s.hackathon.judging?.assign || {}).length || Object.keys(s.hackathon.judging?.order || {}).length) {
          const next = JSON.parse(JSON.stringify(s)); next.hackathon.judging.assign = {}; next.hackathon.judging.order = {}; await saveSettings(next);
        }
        // رموز التأهل المستخدمة تعود صالحة للتسجيل، فلا تبقى مرتبطة بفرق محذوفة
        if (scope === "hackathon") for (const t of (await select(TICKETS)).filter((x) => x.used_by_team)) await update(TICKETS, t.id, { used_by_team: null, used_at: null });
      }
      if (scope === "all") { await removeAll("announcements"); await removeAll(USAGE); await removeAll(LOG); }
      return res.status(200).json({ ok: true });
    }

    // ---------- التصدير ----------
    if (action === "export") {
      const what = q.get("what");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      if (what === "deals") {
        const deals = await select("deals");
        res.setHeader("Content-Disposition", 'attachment; filename="investor-pitches.csv"');
        return res.status(200).end(toCSV(
          ["التاريخ", "الاسم", "البريد", "متأهل", "الفكرة", "المستشار", "القرار", "الدرجة", "تعليق المستشار"],
          deals.map((d) => [d.created_at, d.name, d.email || "", d.qualified ? "نعم" : "لا", d.idea || d.title, s.investor.investors.find((i) => i.id === d.investor)?.name || d.investor,
            d.qualified ? "متأهل" : "غير متأهل", d.score, d.verdict])));
      }
      // درجات المحكّمين: صف لكل محكّم × فريق (آخر تقييم)
      if (what === "scores") {
        const { rows } = await standings(s);
        const R = s.hackathon.rubric;
        res.setHeader("Content-Disposition", 'attachment; filename="judges-scores.csv"');
        const out = [];
        for (const r of rows) for (const j of r.judges) out.push([j.judge, r.team.name, r.best.title, r.label, ...R.map((c) => j.criteria?.[c.key] ?? ""), j.coi ? "" : j.score, j.coi ? "تعارض مصالح" : "", j.note || ""]);
        return res.status(200).end(toCSV(["المحكّم", "الفريق", "المشروع", "المسار", ...R.map((c) => `${c.label} (${c.max})`), "المجموع", "ملاحظة", "تعليق المحكّم"], out));
      }
      const { rows, teams } = await standings(s);
      const byId = new Map(rows.map((r) => [r.team.id, r]));
      res.setHeader("Content-Disposition", 'attachment; filename="hackathon-teams.csv"');
      return res.status(200).end(toCSV(
        ["الترتيب", "الفريق", "الحالة", "الأعضاء", "البريد", "بريد الأعضاء", "الجوال", "رمز الفريق", "المسار والتحدي", "المصدر", "المشروع", "المحاولات", ...s.hackathon.rubric.map((c) => `${c.label} (${c.max})`), "درجة الذكاء الاصطناعي", "عدد المحكّمين", "متوسط اللجنة", "النهائية", "متأهل للتحكيم", "الترتيب النهائي", "ملخص التقييم", "تنبيه تلاعب", "تاريخ التسجيل"],
        teams.map((t) => {
          const r = byId.get(t.id);
          return [r?.rank ?? "", t.name, t.status === "disqualified" ? "مستبعد" : "نشط", t.members, t.email, (t.member_emails || []).filter(Boolean), t.phone, t.code, optionLabel(s, t.track, t.challenge),
            { investor: s.investor.title, invite: "دعوة" }[t.source] || "مباشر", r?.best.title ?? "", r?.attempts ?? 0, ...s.hackathon.rubric.map((c) => r?.best.ai_scores?.[c.key] ?? ""), r?.best.ai_total ?? "",
            r ? r.judges.filter((j) => !j.coi).length : "", r?.judgeAvg ?? "", r?.final ?? "", r?.finalist ? "نعم" : "", r?.finalRank ?? "", r?.best.ai_feedback?.summary ?? "", r?.flagged ? "نعم" : "", t.created_at];
        })));
    }

    return res.status(400).json({ error: "طلب غير معروف" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
}
