// رسائل جماعية: التذكيرات التلقائية، النتائج والشهادات، تذكير المحكّمين
import { select } from "./db.js";
import { phase, toDate } from "./settings.js";
import { mailEnabled } from "./mailer.js";
import { T, standings, ensureCerts, judgeSees } from "./hackcore.js";
import { notify, teamEmails, closesAtText } from "./notify.js";

const RANK = ["", "الأول", "الثاني", "الثالث"];
const count = (acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; };

// التذكيرات: كل فريق يتلقى كل تذكير مرة واحدة فقط (منع التكرار عبر سجل البريد)
export async function runReminders(s, site, now = Date.now()) {
  const out = { close: 0, noSubmit: 0, ran: false };
  if (!mailEnabled() || !s.modules.hackathon || phase(s, now) !== "open") return out;
  const R = s.notify?.reminders || {};
  const close = toDate(s.hackathon.closesAt, s.brand.tzOffset);
  const tpl = s.notify?.templates || {};
  const wantClose = R.closeOn && tpl.reminderClose?.on !== false && close && now >= close - R.closeHours * 3600e3;
  const wantNo = R.noSubmitOn && tpl.reminderNoSubmit?.on !== false;
  if (!wantClose && !wantNo) return out;
  out.ran = true;
  const [teams, subs] = await Promise.all([select(T.teams), select(T.subs)]);
  const H = s.hackathon, closesAt = closesAtText(s);
  for (const team of teams.filter((t) => t.status !== "disqualified")) {
    const mine = subs.filter((x) => x.team_id === team.id);
    const link = `${site}/hackathon?code=${team.code}`;
    const to = teamEmails(s, team);
    if (wantClose) {
      const done = mine.filter((x) => !x.status || x.status === "done");
      const best = done.reduce((a, x) => Math.max(a, x.ai_total || 0), -1);
      const left = Math.max(0, H.maxAttempts - mine.length);
      const status = !mine.length ? "لم تقدّموا مشروعكم بعد. لا تفوّتوا الفرصة!"
        : left ? `قدّمتم مشروعكم${best >= 0 ? ` بدرجة ${best}` : ""}، وما زال لديكم ${left} محاولة لتحسينه.`
        : `قدّمتم مشروعكم${best >= 0 ? ` بدرجة ${best}` : ""} واستنفدتم المحاولات. بالتوفيق في التحكيم!`;
      const hours = Math.max(1, Math.round((close - now) / 3600e3));
      const r = await notify(s, "reminderClose", to, { team: team.name, hours, closesAt, status, link }, { ref: team.id });
      if (r.ok) out.close++;
    }
    if (wantNo && !mine.length && now - Date.parse(team.created_at) >= R.noSubmitHours * 3600e3 && (!close || now < close - 3600e3)) {
      const r = await notify(s, "reminderNoSubmit", to, { team: team.name, hours: R.noSubmitHours, closesAt, maxAttempts: H.maxAttempts, link }, { ref: team.id });
      if (r.ok) out.noSubmit++;
    }
  }
  return out;
}

// تشغيل التذكيرات أثناء الطلبات العادية (مرة كل 10 دقائق لكل خادم) — لا يحتاج جدولة خارجية
const G = globalThis.__remind || (globalThis.__remind = { t: 0 });
export async function maybeReminders(s, site) {
  if (!mailEnabled() || Date.now() - G.t < 600e3) return null;
  G.t = Date.now();
  try { return await runReminders(s, site); } catch (e) { console.error("reminders", e.message); return null; }
}

// النتائج والشهادات: الفائزون برسالة فوز، والبقية برسالة النتائج، ومع كل منهما روابط شهادات الأعضاء
export async function sendResults(s, site) {
  const { rows } = await standings(s);
  const tally = {};
  for (const r of rows) {
    const team = r.team;
    const codes = await ensureCerts(team);
    const certs = (team.members || []).map((m, i) => ({ name: m, url: `${site}/certificate?c=${codes[i]}` }));
    const winner = s.hackathon.resultsPublished && r.finalRank && r.finalRank <= 3;
    const vars = {
      team: team.name, project: r.best.title, certs, link: `${site}/hackathon?code=${team.code}`,
      rank: winner ? RANK[r.finalRank] : r.rank, total: rows.length, score: r.final ?? r.best.ai_total,
    };
    const res = await notify(s, winner ? "winner" : "results", teamEmails(s, team), vars, { ref: team.id });
    count(tally, res);
  }
  return { teams: rows.length, ...tally };
}

// تذكير المحكّمين بما بقي عليهم من المتأهلين
export async function remindJudges(s, site) {
  const { rows } = await standings(s);
  const finals = rows.filter((r) => r.finalist);
  const tally = { judges: 0 };
  for (const j of s.hackathon.judges || []) {
    const mine = finals.filter((r) => judgeSees(j, r.team, s));
    const done = mine.filter((r) => r.judges.some((x) => x.judge_id === j.id)).length;
    if (!mine.length || done >= mine.length || !j.email) continue;
    tally.judges++;
    const res = await notify(s, "judgeReminder", j.email, { name: j.name, done, total: mine.length, remaining: mine.length - done, link: `${site}/judges` });
    count(tally, res);
  }
  return tally;
}

