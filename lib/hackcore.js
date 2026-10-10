// منطق الهاكاثون المشترك: الترتيب، التقييم (مع الحفظ المسبق وإعادة المحاولة)، المحكّمون، الشهادات
import { select, update } from "./db.js";
import { optionLabel, findOption, ADMIN_KEY, judgeKey } from "./settings.js";
import { pdfSource, signedUrl } from "./files.js";
import { aiAvailable, aiMode } from "./ai.js";
import { hackEvaluate } from "./evaluator.js";
import { notify, teamEmails } from "./notify.js";

export const T = { teams: "hack_teams", subs: "hack_submissions", scores: "hack_judge_scores" };
const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const isDone = (x) => !x.status || x.status === "done";

// ---------- الترتيب ----------
export async function standings(s) {
  const [teams, subs, scores] = await Promise.all([select(T.teams), select(T.subs), select(T.scores)]);
  const active = teams.filter((t) => t.status !== "disqualified");
  const best = new Map(), counts = new Map(), flagged = new Set(), pending = new Map();
  for (const x of subs) {
    counts.set(x.team_id, (counts.get(x.team_id) || 0) + 1);
    if (!isDone(x)) { pending.set(x.team_id, (pending.get(x.team_id) || 0) + 1); continue; }
    const cur = best.get(x.team_id);
    if (!cur || x.ai_total > cur.ai_total) best.set(x.team_id, x);
    if (x.flagged) flagged.add(x.team_id);
  }
  // آخر تقييم لكل محكّم
  const latest = new Map();
  for (const x of scores) latest.set(`${x.team_id}|${x.judge_id || x.judge}`, x);
  const judgeByTeam = new Map();
  for (const x of latest.values()) {
    if (!judgeByTeam.has(x.team_id)) judgeByTeam.set(x.team_id, []);
    judgeByTeam.get(x.team_id).push(x);
  }
  const W = s.hackathon.weights;
  const rows = active
    .filter((t) => best.has(t.id))
    .map((t) => ({ team: t, best: best.get(t.id), attempts: counts.get(t.id) || 0, pending: pending.get(t.id) || 0 }))
    .sort((a, b) => b.best.ai_total - a.best.ai_total || Date.parse(a.best.created_at) - Date.parse(b.best.created_at));
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.finalist = s.hackathon.judging?.scope === "all" || i < s.hackathon.finalists;
    r.flagged = flagged.has(r.team.id);
    const all = judgeByTeam.get(r.team.id) || [];
    const js = all.filter((x) => !x.coi);
    r.judges = all.map((x) => ({ judge: x.judge, judge_id: x.judge_id, score: x.score, criteria: x.criteria, note: x.note, coi: Boolean(x.coi), at: x.created_at }));
    r.judgeAvg = js.length ? Math.round((js.reduce((a, x) => a + x.score, 0) / js.length) * 10) / 10 : null;
    r.final = r.judgeAvg == null ? null : Math.round(((r.best.ai_total * W.ai + r.judgeAvg * W.judges) / 100) * 10) / 10;
    r.label = optionLabel(s, r.team.track, r.team.challenge);
  });
  // الترتيب النهائي للمتأهلين
  const fin = rows.filter((r) => r.finalist).sort((a, b) => (b.final ?? b.best.ai_total) - (a.final ?? a.best.ai_total));
  fin.forEach((r, i) => (r.finalRank = i + 1));
  return { teams, active, subs, rows };
}

// ---------- التقييم: يُحفظ التقديم أولًا، ثم يُقيَّم، وإن فشل يُعاد لاحقًا ----------
const INJECTION = /(ignore|disregard|system prompt|full marks|100\s*\/\s*100|تجاهل|الدرجة الكاملة|درجة كاملة|أعط(ِ)?\s*(هذا|المشروع)|امنح\s*(هذا|المشروع)|أنت الآن)/i;

function demoEval(H) {
  return {
    scores: Object.fromEntries(H.rubric.map((r) => [r.key, Math.round(r.max * (0.3 + Math.random() * 0.5))])),
    details: {}, capsApplied: [], reviewed: false, demo: true,
    strengths: ["تقييم وهمي: الذكاء الاصطناعي غير مفعّل"],
    improvements: ["فعّل الذكاء الاصطناعي من لوحة التحكم للحصول على تقييم حقيقي"],
    summary: "⚠️ هذا تقييم وهمي عشوائي للعرض فقط، وليس تقييمًا حقيقيًا.",
    manipulation: false,
  };
}

export async function runEvaluation(s, sub, team, opts = {}) {
  const H = s.hackathon;
  try {
    const deckFile = (sub.files || []).find((x) => x.kind === "deck");
    let deck = null, ev;
    if (!aiAvailable()) ev = demoEval(H);
    else {
      if (deckFile && H.uploads.aiReadsDeck && aiMode() !== "claude-account") deck = await pdfSource(deckFile.key);
      const opt = findOption(s, team.track, team.challenge);
      try { ev = await hackEvaluate(s, sub, opt, deck, { deckAttached: Boolean(deckFile) }); }
      catch (e) {
        if (!deck) throw e;
        console.error("deck read failed, retrying without deck", e.message);
        deck = null;
        ev = await hackEvaluate(s, sub, opt, null, { deckAttached: Boolean(deckFile) });
      }
    }
    const scores = Object.fromEntries(H.rubric.map((r) => [r.key, Math.min(r.max, Math.max(0, Math.round(Number(ev.scores?.[r.key]) || 0)))]));
    const total = Object.values(scores).reduce((a, n) => a + n, 0);
    const text = [sub.title, sub.problem, sub.solution, sub.customer, sub.business, sub.prototype_desc].join(" ");
    const saved = await update(T.subs, sub.id, {
      status: "done", eval_error: null, evaluated_at: new Date().toISOString(),
      ai_scores: scores, ai_total: total, deck_read: Boolean(deck),
      flagged: Boolean(ev.manipulation) || INJECTION.test(text),
      ai_feedback: {
        strengths: (ev.strengths || []).slice(0, 3).map((x) => clip(x, 200)),
        improvements: (ev.improvements || []).slice(0, 4).map((x) => clip(x, 200)),
        summary: clip(ev.summary, 400), details: ev.details || {}, caps: ev.capsApplied || [],
        reviewed: Boolean(ev.reviewed), demo: Boolean(ev.demo),
      },
    });
    if (opts.notify !== false && !ev.demo) {
      await notify(s, "evaluated", teamEmails(s, team), {
        team: team.name, project: sub.title, score: total, attempt: sub.attempt, maxAttempts: H.maxAttempts, summary: clip(ev.summary, 400), link: opts.link,
      }, { ref: sub.id });
    }
    return saved;
  } catch (e) {
    console.error("evaluation failed", e.message);
    await update(T.subs, sub.id, { status: "failed", eval_error: clip(e.message, 300) });
    return null;
  }
}

// ---------- المحكّمون ----------
// يرجع هوية المحكّم من المفتاح: محكّم شخصي، أو المفتاح المشترك، أو مفتاح الإدارة
export async function identifyJudge(s, key) {
  if (!key) return null;
  if (ADMIN_KEY && key === ADMIN_KEY) return { id: "admin", name: "الإدارة", tracks: [], admin: true };
  const j = (s.hackathon.judges || []).find((x) => x.key && x.key === key);
  if (j) return { id: j.id, name: j.name, tracks: j.tracks || [], personal: true };
  const shared = await judgeKey();
  if (shared && key === shared) return { id: null, name: null, tracks: [], shared: true };
  return null;
}
// من يرى المشروع ويقيّمه، حسب طريقة التوزيع في «إدارة التحكيم»
export function judgeSees(judge, team, s) {
  if (judge.admin || judge.shared) return true;
  const J = s?.hackathon?.judging || {};
  if (J.mode === "all") return true;
  if (J.mode === "committees") {
    const cid = J.assign?.[String(team.id)];
    const c = cid && (J.committees || []).find((x) => x.id === cid);
    return Boolean(c && c.judges.includes(String(judge.id)));
  }
  return !judge.tracks?.length || judge.tracks.includes(team.track);
}
// المحكّمون المطلوب منهم تقييم المشروع (الحسابات الشخصية)
export const expectedJudges = (s, team) => (s.hackathon.judges || []).filter((j) => judgeSees({ id: j.id, tracks: j.tracks || [] }, team, s));
export const judgingOrder = (s, team) => s.hackathon.judging?.order?.[String(team.id)] ?? null;

// ---------- الملفات ----------
export async function withUrls(files, seconds = 3600) {
  return Promise.all((files || []).map(async (f) => ({ ...f, url: await signedUrl(f.key, seconds) })));
}

// ---------- الشهادات ----------
const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const rnd = (n) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => A[b % A.length]).join("");

export async function ensureCerts(team) {
  const members = team.members || [];
  if (Array.isArray(team.certs) && team.certs.length === members.length) return team.certs;
  const certs = members.map((m, i) => team.certs?.[i] || `C-${rnd(8)}`);
  await update(T.teams, team.id, { certs });
  team.certs = certs;
  return certs;
}

// نوع الشهادة حسب الترتيب
export function certKind(s, row) {
  if (!row) return "participant";
  if (s.hackathon.resultsPublished && row.finalRank && row.finalRank <= 3) return `winner${row.finalRank}`;
  if (row.finalist) return "finalist";
  return "participant";
}
