// الهاكاثون — نقطة API واحدة: /api/hack?action=...
import crypto from "node:crypto";
import { getSettings, publicSettings, phase, findOption, optionLabel } from "../lib/settings.js";
import { insert, select, update } from "../lib/db.js";
import { createUpload, stat, remove, TYPES, extOf, safeName } from "../lib/files.js";
import { aiAvailable } from "../lib/ai.js";
import { findTicket, useTicket } from "../lib/tickets.js";
import { checkLimits, recordUse } from "../lib/limits.js";
import { notify, teamEmails, closesAtText } from "../lib/notify.js";
import { siteUrl } from "../lib/site.js";
import { resolveLogos } from "../lib/logos.js";
import { hashPassword, verifyPassword, passwordProblem } from "../lib/password.js";
import { count } from "../lib/db.js";
import { clientKey } from "../lib/limits.js";
import { T, standings, runEvaluation, identifyJudge, judgeSees, judgingOrder, withUrls, ensureCerts, certKind } from "../lib/hackcore.js";

export { T, standings };
const clip = (s, n) => String(s ?? "").trim().slice(0, n);

function genCode() {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(6), (b) => a[b % a.length]).join("");
}
const fileLimits = (H, kind) =>
  kind === "deck"
    ? { maxMB: H.uploads.deckMaxMB, exts: ["pdf"] }
    : { maxMB: H.uploads.extraMaxMB, exts: ["pdf", "pptx", "docx", "xlsx", "png", "jpg", "jpeg"] };

function publicSub(x) {
  return {
    attempt: x.attempt, created_at: x.created_at, status: x.status || "done", title: x.title, problem: x.problem, solution: x.solution,
    customer: x.customer, business: x.business, prototype_desc: x.prototype_desc, prototype_url: x.prototype_url,
    video_url: x.video_url, scores: x.ai_scores, total: x.ai_total, feedback: x.ai_feedback, files: x.files || [], deck_read: x.deck_read,
  };
}

// الفرق المرتبطة ببريد (قائد الفريق أو أحد الأعضاء)
async function teamsByEmail(email) {
  return (await select(T.teams)).filter((t) => t.email === email || (t.member_emails || []).includes(email));
}
// حماية الدخول: عدد المحاولات الفاشلة لكل جهاز في الساعة
const LOGIN_FAILS = 10;
const loginBlocked = async (req) => (await count("usage", { ip: clientKey(req), kind: "login-fail" }, new Date(Date.now() - 3600e3).toISOString())) >= LOGIN_FAILS;
const loginFail = (req) => insert("usage", { ip: clientKey(req), kind: "login-fail" });

async function teamByCode(code) {
  const [team] = await select(T.teams, { code: clip(code, 10).toUpperCase() });
  return team || null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const q = new URL(req.url, "http://x").searchParams;
  const action = q.get("action");
  const b = req.body || {};

  try {
    const s = await getSettings();
    const H = s.hackathon;
    const ph = phase(s);
    const isPublic = ["board", "register", "team", "submit", "ticket", "evaluate"].includes(action);
    if (isPublic && !s.modules.hackathon) return res.status(403).json({ error: "الهاكاثون غير مفعّل حاليًا", disabled: true });

    // ===================== عام =====================
    if (action === "board") {
      const { active, subs, rows } = await standings(s);
      return res.status(200).json({
        phase: ph,
        stats: { teams: active.length, submissions: subs.length, evaluated: rows.length },
        leaderboard: rows.slice(0, 20).map((r) => ({
          rank: r.rank, team: r.team.name, title: r.best.title, track: r.team.track, label: r.label, score: r.best.ai_total, attempts: r.attempts,
        })),
      });
    }

    // التحقق من شهادة (عام)
    if (action === "cert") {
      const code = clip(q.get("code"), 20).toUpperCase();
      const { teams, rows } = await standings(s);
      for (const t of teams) {
        const i = (t.certs || []).indexOf(code);
        if (i < 0) continue;
        if (t.status === "disqualified") break;
        const row = rows.find((r) => r.team.id === t.id);
        return res.status(200).json({
          valid: true, code, name: t.members[i], team: t.name, project: row?.best.title || "", label: optionLabel(s, t.track, t.challenge),
          kind: certKind(s, row), brand: { ...s.brand, logos: await resolveLogos(s) }, hackathon: H.name, date: row?.best.created_at || t.created_at,
        });
      }
      return res.status(404).json({ valid: false, error: "الشهادة غير موجودة" });
    }

    if (action === "ticket") {
      const t = await findTicket(q.get("code") || b.ticket);
      if (!t) return res.status(404).json({ error: "رمز التأهل غير صحيح" });
      if (t.used_by_team) return res.status(409).json({ error: "هذا الرمز استُخدم لتسجيل فريق من قبل. إن كنت عضوًا فيه فادخل برمز الفريق." });
      let idea = null, track = null;
      if (t.deal_id) {
        const [d] = await select("deals", { id: t.deal_id });
        if (d) idea = { title: d.title, idea: d.idea, score: d.score };
        const o = d?.scores?._track && findOption(s, d.scores._track, d.scores._challenge);
        if (o) track = { track: o.track.id, challenge: o.challenge?.id ?? null, label: optionLabel(s, o.track.id, o.challenge?.id) };
      }
      return res.status(200).json({ valid: true, kind: t.kind, name: t.name, email: t.email, idea, track });
    }

    if (action === "register" && req.method === "POST") {
      if (ph === "closed") return res.status(403).json({ error: "انتهت فترة التسجيل" });
      if (!b.consent) return res.status(400).json({ error: "الرجاء الموافقة على استخدام البيانات لأغراض البرنامج" });
      let ticket = null;
      if (H.registration === "ticket") {
        ticket = await findTicket(b.ticket);
        if (!ticket) return res.status(403).json({ error: "التسجيل في الهاكاثون للمتأهلين فقط. أدخل رمز التأهل الذي حصلت عليه من المستثمر الذكي، أو رمز الدعوة من المنظمين." });
        if (ticket.used_by_team) return res.status(409).json({ error: "رمز التأهل استُخدم لتسجيل فريق من قبل" });
      }
      const name = clip(b.name, 40);
      // الأعضاء مع بريد اختياري لكل عضو
      const rawM = Array.isArray(b.members) ? b.members : [], rawE = Array.isArray(b.memberEmails) ? b.memberEmails : [];
      const pairs = rawM.map((m, i) => [clip(m, 50), clip(rawE[i], 80).toLowerCase()]).filter(([m]) => m).slice(0, H.maxMembers);
      const members = pairs.map(([m]) => m);
      const badMail = pairs.find(([, e]) => e && !/^\S+@\S+\.\S+$/.test(e));
      if (badMail) return res.status(400).json({ error: `بريد العضو «${badMail[0]}» غير صحيح` });
      const member_emails = [...new Set(pairs.map(([, e]) => e).filter(Boolean))];
      const email = clip(b.email, 80).toLowerCase();
      const phone = clip(b.phone, 20);
      // المسار المختار عند عرض الفكرة يُعتمد للفريق (لا يتغير بعد التأهل)
      let fixed = null;
      if (ticket?.deal_id) { const [d] = await select("deals", { id: ticket.deal_id }); fixed = d?.scores?._track ? findOption(s, d.scores._track, d.scores._challenge) : null; }
      const opt = fixed || findOption(s, b.track, b.challenge);
      if (name.length < 2) return res.status(400).json({ error: "اكتب اسم الفريق" });
      if (!members.length) return res.status(400).json({ error: "أضف اسم عضو واحد على الأقل" });
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "البريد الإلكتروني غير صحيح" });
      if (!opt) return res.status(400).json({ error: "الرجاء اختيار المسار والتحدي" });
      const pwErr = passwordProblem(b.password);
      if (pwErr) return res.status(400).json({ error: pwErr });
      const existing = await select(T.teams);
      if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: "اسم الفريق مستخدم، اختر اسمًا آخر" });
      const team = await insert(T.teams, {
        code: genCode(), name, members, member_emails, email, phone, status: "active", password_hash: await hashPassword(b.password),
        track: opt.track.id, challenge: opt.challenge?.id ?? null,
        source: ticket ? ticket.kind : "direct", deal_id: ticket?.deal_id ?? null, ticket: ticket?.code ?? null,
        consent_at: new Date().toISOString(),
      });
      if (ticket) await useTicket(ticket, team.id);
      const link = `${siteUrl(req)}/hackathon?code=${team.code}`;
      const emailed = (await notify(s, "registered", teamEmails(s, team), { team: name, track: optionLabel(s, opt.track.id, opt.challenge?.id), code: team.code, closesAt: closesAtText(s), link })).ok;
      return res.status(200).json({ code: team.code, emailed });
    }

    // ===================== الدخول بالبريد وكلمة المرور =====================
    if (action === "login" && req.method === "POST") {
      const email = clip(b.email, 80).toLowerCase();
      if (await loginBlocked(req)) return res.status(429).json({ error: "محاولات دخول كثيرة. الرجاء المحاولة بعد ساعة، أو استخدام رمز الفريق." });
      const teams = await teamsByEmail(email);
      for (const t of teams) {
        if (t.password_hash && (await verifyPassword(b.password, t.password_hash))) return res.status(200).json({ code: t.code, team: t.name });
      }
      await loginFail(req);
      if (teams.length && !teams.some((t) => t.password_hash)) return res.status(401).json({ error: "لم تُعيَّن كلمة مرور لهذا الفريق بعد. الرجاء الدخول برمز الفريق ثم تعيين كلمة المرور من صفحة الفريق.", noPassword: true });
      return res.status(401).json({ error: "البريد أو كلمة المرور غير صحيحة" });
    }

    // تعيين كلمة المرور أو تغييرها من صفحة الفريق: يلزم إدخال الكلمة الحالية إن وُجدت
    if (action === "set-password" && req.method === "POST") {
      const team = await teamByCode(b.code);
      if (!team) return res.status(404).json({ error: "رمز الفريق غير صحيح" });
      if (team.password_hash) {
        if (await loginBlocked(req)) return res.status(429).json({ error: "محاولات كثيرة. الرجاء المحاولة بعد ساعة." });
        if (!(await verifyPassword(b.current, team.password_hash))) { await loginFail(req); return res.status(400).json({ error: "كلمة المرور الحالية غير صحيحة" }); }
      }
      const pwErr = passwordProblem(b.password);
      if (pwErr) return res.status(400).json({ error: pwErr });
      await update(T.teams, team.id, { password_hash: await hashPassword(b.password) });
      return res.status(200).json({ ok: true });
    }

    if (action === "team") {
      const team = await teamByCode(q.get("code") || b.code);
      if (!team) return res.status(404).json({ error: "رمز الفريق غير صحيح" });
      const subs = await select(T.subs, { team_id: team.id });
      const ann = (await select("announcements")).filter((a) => a.active && (a.audience === "all" || a.audience === "participants" || a.audience === `team:${team.id}`));
      let certs = null;
      if (ph === "closed" && subs.length && team.status !== "disqualified") {
        const { rows } = await standings(s);
        const row = rows.find((r) => r.team.id === team.id);
        const codes = await ensureCerts(team);
        certs = { kind: certKind(s, row), list: team.members.map((m, i) => ({ name: m, code: codes[i] })) };
      }
      return res.status(200).json({
        team: { name: team.name, members: team.members, email: team.email, hasPassword: Boolean(team.password_hash), track: team.track, challenge: team.challenge, label: optionLabel(s, team.track, team.challenge), source: team.source, status: team.status || "active" },
        submissions: subs.map(publicSub),
        files: await withUrls(team.files),
        announcements: ann.reverse().slice(0, 20).map(({ id, title, body, created_at, audience }) => ({ id, title, body, created_at, personal: audience.startsWith("team:") })),
        attemptsLeft: Math.max(0, H.maxAttempts - subs.length),
        phase: ph, certs,
      });
    }

    // ===================== الملفات =====================
    if (["upload-url", "attach", "detach"].includes(action) && req.method === "POST") {
      const team = await teamByCode(b.code);
      if (!team) return res.status(404).json({ error: "رمز الفريق غير صحيح" });
      if (team.status === "disqualified") return res.status(403).json({ error: "تم إيقاف مشاركة هذا الفريق" });
      if (ph === "closed") return res.status(403).json({ error: "انتهت فترة التقديم" });
      const files = team.files || [];

      if (action === "detach") {
        if (!files.some((x) => x.key === b.key)) return res.status(404).json({ error: "الملف غير موجود" });
        await update(T.teams, team.id, { files: files.filter((x) => x.key !== b.key) });
        const used = (await select(T.subs, { team_id: team.id })).some((x) => (x.files || []).some((y) => y.key === b.key));
        if (!used) await remove(b.key);
        return res.status(200).json({ ok: true });
      }

      const kind = b.kind === "deck" ? "deck" : "extra";
      const lim = fileLimits(H, kind);
      const name = clip(b.name, 120), ext = extOf(name), size = Number(b.size) || 0;
      if (!lim.exts.includes(ext)) return res.status(400).json({ error: kind === "deck" ? "العرض الاستثماري يجب أن يكون PDF. صدّره من PowerPoint أو Canva بصيغة PDF" : `نوع الملف غير مدعوم. المسموح: ${lim.exts.join("، ")}` });
      if (size > lim.maxMB * 1024 * 1024) return res.status(400).json({ error: `حجم الملف أكبر من ${lim.maxMB} ميجابايت` });
      if (kind === "extra" && files.filter((x) => x.kind === "extra").length >= H.uploads.extraFiles)
        return res.status(400).json({ error: `الحد الأقصى ${H.uploads.extraFiles} ملفات إضافية` });

      if (action === "upload-url") {
        const key = `teams/${team.id}/${Date.now().toString(36)}-${safeName(name)}`;
        return res.status(200).json({ key, ...(await createUpload(key)), contentType: TYPES[ext] });
      }
      const key = String(b.key || "");
      if (!key.startsWith(`teams/${team.id}/`)) return res.status(400).json({ error: "ملف غير صالح" });
      const st = await stat(key);
      if (!st) return res.status(400).json({ error: "لم يكتمل رفع الملف، حاول مرة أخرى" });
      if (st.size > lim.maxMB * 1024 * 1024) { await remove(key); return res.status(400).json({ error: `حجم الملف أكبر من ${lim.maxMB} ميجابايت` }); }
      const entry = { key, kind, name, size: st.size || size, at: new Date().toISOString() };
      const next = kind === "deck" ? files.filter((x) => x.kind !== "deck") : files;
      await update(T.teams, team.id, { files: [...next, entry] });
      return res.status(200).json({ file: (await withUrls([entry]))[0] });
    }

    // ===================== التقديم والتقييم =====================
    if (action === "submit" && req.method === "POST") {
      if (ph !== "open") return res.status(403).json({ error: ph === "soon" ? "لم يبدأ التقديم بعد" : "انتهت فترة التقديم" });
      const team = await teamByCode(b.code);
      if (!team) return res.status(404).json({ error: "رمز الفريق غير صحيح" });
      if (team.status === "disqualified") return res.status(403).json({ error: "تم إيقاف مشاركة هذا الفريق. تواصل مع المنظمين." });
      const prev = await select(T.subs, { team_id: team.id });
      if (prev.length >= H.maxAttempts) return res.status(403).json({ error: "استنفد فريقك عدد المحاولات المتاحة" });
      if (prev.some((x) => x.status === "pending" || x.status === "failed")) return res.status(409).json({ error: "لديكم تقديم قيد التقييم، انتظروا اكتماله" });
      const limitMsg = await checkLimits(s, req, "submit");
      if (limitMsg) return res.status(429).json({ error: limitMsg });

      const url = (u) => (/^https?:\/\/\S+$/i.test(clip(u, 300)) ? clip(u, 300) : "");
      const sub = {
        title: clip(b.title, 60), problem: clip(b.problem, 800), solution: clip(b.solution, 1200), customer: clip(b.customer, 600),
        business: clip(b.business, 600), prototype_desc: clip(b.prototype_desc, 600), prototype_url: url(b.prototype_url), video_url: url(b.video_url),
      };
      if (!sub.title) return res.status(400).json({ error: "اكتب اسم المشروع" });
      for (const [k, label] of [["problem", "المشكلة"], ["solution", "الحل"], ["customer", "العميل والسوق"], ["business", "نموذج الربح"]])
        if (sub[k].length < 30) return res.status(400).json({ error: `وضّح «${label}» أكثر (30 حرفًا على الأقل)` });
      const files = team.files || [];
      if (H.uploads.deckRequired && !files.some((x) => x.kind === "deck")) return res.status(400).json({ error: "ارفع العرض الاستثماري (PDF) قبل التقديم" });

      // 1) الحفظ أولًا: لا يضيع التقديم مهما حدث في التقييم
      const pending = await insert(T.subs, { team_id: team.id, attempt: prev.length + 1, ...sub, files, status: "pending" });
      if (aiAvailable()) await recordUse(req, "submit", 2);
      // 2) التقييم
      const done = await runEvaluation(s, pending, team, { link: `${siteUrl(req)}/hackathon?code=${team.code}` });
      if (!done) return res.status(202).json({ pending: true, attemptsLeft: Math.max(0, H.maxAttempts - prev.length - 1),
        message: "تم حفظ تقديمكم، لكن التقييم تأخر بسبب ضغط على الخدمة. سيكتمل تلقائيًا، ارجعوا لهذه الصفحة بعد دقائق." });
      return res.status(200).json({ submission: publicSub(done), attemptsLeft: Math.max(0, H.maxAttempts - prev.length - 1), demo: !aiAvailable() });
    }

    // إكمال تقييم معلّق (يستدعيه المتصفح تلقائيًا عند فتح صفحة الفريق)
    if (action === "evaluate" && req.method === "POST") {
      const team = await teamByCode(b.code);
      if (!team) return res.status(404).json({ error: "رمز الفريق غير صحيح" });
      const stale = (x) => x.status === "failed" || (x.status === "pending" && Date.now() - Date.parse(x.created_at) > 90e3);
      const todo = (await select(T.subs, { team_id: team.id })).filter(stale);
      let ok = 0;
      for (const x of todo) if (await runEvaluation(s, x, team, { link: `${siteUrl(req)}/hackathon?code=${team.code}` })) ok++;
      return res.status(200).json({ evaluated: ok, remaining: todo.length - ok });
    }

    // ===================== اللجنة =====================
    if (["judge", "score", "results"].includes(action)) {
      const judge = await identifyJudge(s, req.headers["x-judge-key"]);
      if (!judge) return res.status(401).json({ error: "مفتاح المحكّم غير صحيح" });
      if (judge.shared) judge.name = clip(b.judge || q.get("name"), 40) || "محكّم";
      if (judge.shared) judge.id = `shared:${judge.name}`;

      if (action === "judge") {
        const { rows, active, subs } = await standings(s);
        const mine = rows.filter((r) => judge.admin || judgeSees(judge, r.team, s));
        // ترتيب العرض المحدد في إدارة التحكيم، ثم الترتيب العام
        mine.sort((a, c) => (judgingOrder(s, a.team) ?? 1e4 + a.rank) - (judgingOrder(s, c.team) ?? 1e4 + c.rank));
        for (const r of mine) r.files = await withUrls(r.best.files || r.team.files, 4 * 3600);
        const ann = (await select("announcements")).filter((a) => a.active && (a.audience === "judges" || a.audience === "all"));
        const finals = mine.filter((r) => r.finalist);
        return res.status(200).json({
          config: publicSettings(s),
          me: { name: judge.name, id: judge.id, tracks: judge.tracks, admin: Boolean(judge.admin), personal: Boolean(judge.personal) },
          open: H.judging?.open !== false,
          progress: { done: finals.filter((r) => r.judges.some((j) => j.judge_id === judge.id)).length, total: finals.length },
          announcements: ann.reverse().slice(0, 5).map(({ id, title, body, created_at }) => ({ id, title, body, created_at })),
          stats: { teams: active.length, submissions: subs.length },
          rows: mine.map((r) => ({
            id: r.team.id, rank: r.rank, finalist: r.finalist, order: judgingOrder(s, r.team), team: r.team.name, members: r.team.members,
            email: r.team.email, phone: r.team.phone, challenge: r.label, source: r.team.source, attempts: r.attempts,
            submission: { ...publicSub(r.best), flagged: r.flagged, files: r.files },
            judges: r.judges, judgeAvg: r.judgeAvg, final: r.final,
            mine: r.judges.find((j) => j.judge_id === judge.id) || null,
          })),
        });
      }

      if (action === "score" && req.method === "POST") {
        if (judge.admin) return res.status(403).json({ error: "التقييم للمحكّمين فقط" });
        if (H.judging?.open === false) return res.status(403).json({ error: "التحكيم مغلق حاليًا. الرجاء التواصل مع المنظمين." });
        const { rows } = await standings(s);
        const row = rows.find((r) => r.team.id === Number(b.team_id));
        if (!row) return res.status(404).json({ error: "الفريق غير موجود" });
        if (!row.finalist) return res.status(400).json({ error: "هذا الفريق ليس ضمن المتأهلين" });
        if (!judgeSees(judge, row.team, s)) return res.status(403).json({ error: "هذا المشروع غير مسند إليك" });
        const coi = Boolean(b.coi);
        let criteria = null, score = 0;
        if (!coi) {
          if (b.criteria && typeof b.criteria === "object") {
            criteria = {};
            for (const r of H.rubric) {
              const v = Number(b.criteria[r.key]);
              if (!(v >= 0 && v <= r.max)) return res.status(400).json({ error: `درجة «${r.label}» من 0 إلى ${r.max}` });
              criteria[r.key] = Math.round(v);
            }
            score = Object.values(criteria).reduce((a, n) => a + n, 0);
          } else {
            score = Math.round(Number(b.score));
            if (b.score === "" || !(score >= 0 && score <= 100)) return res.status(400).json({ error: "الدرجة من 0 إلى 100" });
          }
        }
        await insert(T.scores, { team_id: row.team.id, judge: judge.name, judge_id: judge.id, score, criteria, coi, note: clip(b.note, 600) });
        return res.status(200).json({ ok: true, score });
      }

      if (action === "results") {
        const { rows } = await standings(s);
        const finalists = rows.filter((r) => r.finalist).map((r) => ({
          team: r.team.name, members: r.team.members, title: r.best.title, challenge: r.label, ai: r.best.ai_total,
          judgeAvg: r.judgeAvg, final: r.final ?? r.best.ai_total, pending: r.final == null,
        })).sort((a, c) => c.final - a.final);
        return res.status(200).json({ config: publicSettings(s), finalists });
      }
    }

    return res.status(400).json({ error: "طلب غير معروف" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "حدث خطأ مؤقت، حاول مرة أخرى" });
  }
}
