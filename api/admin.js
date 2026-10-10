// لوحة التحكم: /api/admin?action=...   (تتطلب الترويسة x-admin-key)
import { getSettings, saveSettings, ADMIN_KEY, judgeKey, phase, optionLabel } from "../lib/settings.js";
import { DEFAULTS } from "../lib/defaults.js";
import { select, insert, update, removeAll, removeOne, hasDb } from "../lib/db.js";
import { aiAvailable, aiMode, MODEL, EVAL_MODEL } from "../lib/ai.js";
import { T, standings, runEvaluation, ensureCerts, certKind } from "../lib/hackcore.js";
import { createTicket, TICKETS } from "../lib/tickets.js";
import { usageToday, USAGE } from "../lib/limits.js";
import { mailEnabled, sendMail, layout, codeBox, escHtml } from "../lib/mailer.js";
import { siteUrl } from "../lib/site.js";

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

  const q = new URL(req.url, "http://x").searchParams;
  const action = q.get("action");
  const b = req.body || {};

  try {
    const s = await getSettings();
    const site = siteUrl(req);

    // ---------- نظرة عامة + الإعدادات ----------
    if (action === "get") {
      const [deals, { teams, subs, rows }, tickets, ann, used] = await Promise.all([select("deals"), standings(s), select(TICKETS), select("announcements"), usageToday()]);
      const invested = deals.filter((d) => d.decision === "invest");
      return res.status(200).json({
        settings: s,
        defaults: DEFAULTS,
        tickets: tickets.slice(-300).reverse().map((t) => ({
          code: t.code, kind: t.kind, name: t.name, email: t.email, label: t.label, used: Boolean(t.used_by_team), created_at: t.created_at,
          score: t.deal_id ? deals.find((d) => d.id === t.deal_id)?.score ?? null : null,
          team: t.used_by_team ? teams.find((x) => x.id === t.used_by_team)?.name ?? "" : "",
        })),
        announcements: ann.reverse().map((a) => ({ ...a, teamName: a.audience.startsWith("team:") ? teams.find((t) => `team:${t.id}` === a.audience)?.name || "" : "" })),
        system: {
          database: hasDb, ai: aiAvailable(), aiMode: aiMode(), model: MODEL, evalModel: EVAL_MODEL, mail: mailEnabled(),
          judgeKeySet: Boolean(await judgeKey()) || (s.hackathon.judges || []).length > 0, phase: phase(s),
          usageToday: used, dailyAiCalls: s.limits.dailyAiCalls,
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
      const r = await saveSettings(b.settings);
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
            files: (t.files || []).length,
          };
        }).reverse(),
      });
    }

    if (action === "team-status" && req.method === "POST") {
      const status = b.status === "disqualified" ? "disqualified" : "active";
      await update(T.teams, Number(b.id), { status, status_note: clip(b.note, 300) });
      return res.status(200).json({ ok: true });
    }

    // رسالة لفريق محدد: إعلان شخصي + بريد
    if (action === "message" && req.method === "POST") {
      const [team] = await select(T.teams, { id: Number(b.team_id) });
      if (!team) return res.status(404).json({ error: "الفريق غير موجود" });
      const title = clip(b.title, 120), body = clip(b.body, 2000);
      if (!title) return res.status(400).json({ error: "اكتب عنوان الرسالة" });
      await insert("announcements", { title, body, audience: `team:${team.id}`, active: true });
      const emailed = await sendMail(team.email, title, layout(s, title, `<p style="white-space:pre-wrap">${escHtml(body)}</p>`, { url: `${site}/hackathon?code=${team.code}`, label: "صفحة الفريق" }));
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
        const html = layout(s, title, `<p style="white-space:pre-wrap">${escHtml(body)}</p>`);
        if (audience === "judges") for (const j of s.hackathon.judges || []) emailed += (await sendMail(j.email, title, html)) ? 1 : 0;
        else if (audience !== "screens") for (const t of (await select(T.teams)).filter((t) => t.status !== "disqualified")) emailed += (await sendMail(t.email, title, html)) ? 1 : 0;
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
        sent += (await sendMail(j.email, `دعوة للتحكيم في ${s.hackathon.name}`, layout(s, `أهلًا ${j.name}`,
          `<p>يسعدنا انضمامك إلى لجنة تحكيم ${escHtml(s.hackathon.name)}. المسارات المسندة إليك: <b>${escHtml(tracks)}</b>.</p><p>مفتاح الدخول الخاص بك:</p>${codeBox(j.key)}`,
          { url: `${site}/judges`, label: "لوحة التحكيم" }))) ? 1 : 0;
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
      for (const r of rows.filter((x) => x.finalist)) {
        const title = `🎉 تأهل فريق «${r.team.name}» للتحكيم النهائي`;
        await insert("announcements", { title, body: `مبروك! مشروعكم «${r.best.title}» ضمن أفضل ${s.hackathon.finalists} مشاريع، وسيقيّمه أعضاء لجنة التحكيم.`, audience: `team:${r.team.id}`, active: true });
        sent += (await sendMail(r.team.email, title, layout(s, title, `<p>مشروعكم «${escHtml(r.best.title)}» ضمن أفضل ${s.hackathon.finalists} مشاريع في ${escHtml(s.hackathon.name)}، وسيقيّمه أعضاء لجنة التحكيم. تابعوا الإعلانات في صفحة الفريق.</p>`, { url: `${site}/hackathon?code=${r.team.code}`, label: "صفحة الفريق" }))) ? 1 : 0;
      }
      return res.status(200).json({ ok: true, emailed: sent });
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
        settings: s,
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
        winners: finals.map((r, i) => ({ place: i + 1, team: r.team.name, members: r.team.members, title: r.best.title, label: r.label, ai: r.best.ai_total, judges: r.judgeAvg, final: r.final })),
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
      const n = Math.min(100, Math.max(1, Math.round(Number(b.count) || 1)));
      const label = clip(b.label, 60);
      const codes = [];
      for (let i = 0; i < n; i++) codes.push((await createTicket({ kind: "invite", label })).code);
      return res.status(200).json({ codes });
    }

    // ---------- حذف البيانات ----------
    if (action === "reset" && req.method === "POST") {
      const scope = b.scope;
      if (b.confirm !== "حذف") return res.status(400).json({ error: "اكتب كلمة «حذف» للتأكيد" });
      if (scope === "investor" || scope === "all") { await removeAll("deals"); await removeAll(TICKETS); await removeAll("otp"); }
      if (scope === "hackathon" || scope === "all") { await removeAll(T.scores); await removeAll(T.subs); await removeAll(T.teams); }
      if (scope === "all") { await removeAll("announcements"); await removeAll(USAGE); }
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
          ["التاريخ", "الاسم", "البريد", "متأهل", "الفكرة", "المستثمر", "القرار", "المبلغ", "الحصة %", "التقييم", "الدرجة", "تعليق المستثمر"],
          deals.map((d) => [d.created_at, d.name, d.email || "", d.qualified ? "نعم" : "لا", d.idea || d.title, s.investor.investors.find((i) => i.id === d.investor)?.name || d.investor,
            d.decision === "invest" ? "استثمار" : "خارج", d.amount, d.equity, d.valuation, d.score, d.verdict])));
      }
      const { rows, teams } = await standings(s);
      const byId = new Map(rows.map((r) => [r.team.id, r]));
      res.setHeader("Content-Disposition", 'attachment; filename="hackathon-teams.csv"');
      return res.status(200).end(toCSV(
        ["الترتيب", "الفريق", "الحالة", "الأعضاء", "البريد", "الجوال", "المسار والتحدي", "المصدر", "المشروع", "المحاولات", "درجة الذكاء الاصطناعي", "متوسط اللجنة", "النهائية", "متأهل", "تنبيه تلاعب"],
        teams.map((t) => {
          const r = byId.get(t.id);
          return [r?.rank ?? "", t.name, t.status === "disqualified" ? "مستبعد" : "نشط", t.members, t.email, t.phone, optionLabel(s, t.track, t.challenge),
            { investor: "المستثمر الذكي", invite: "دعوة" }[t.source] || "مباشر", r?.best.title ?? "", r?.attempts ?? 0, r?.best.ai_total ?? "", r?.judgeAvg ?? "", r?.final ?? "", r?.finalist ? "نعم" : "", r?.flagged ? "نعم" : ""];
        })));
    }

    return res.status(400).json({ error: "طلب غير معروف" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
}
