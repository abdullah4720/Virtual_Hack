import { getFeed } from "../lib/store.js";
import { getSettings, phase } from "../lib/settings.js";
import { select } from "../lib/db.js";
import { standings } from "../lib/hackcore.js";

// ?scope=dashboard: إحصائيات مجمّعة لشاشة البيانات (بدون بيانات شخصية)
async function dashboard() {
  const s = await getSettings();
  const [deals, { active, subs, rows }] = await Promise.all([select("deals"), standings(s)]);
  const now = Date.now();
  const hours = Array.from({ length: 12 }, (_, i) => {
    const end = now - (11 - i) * 3600e3, start = end - 3600e3;
    const inH = (x) => { const t = Date.parse(x.created_at); return t > start && t <= end; };
    return { h: new Date(end).toISOString(), pitches: deals.filter(inH).length, subs: subs.filter(inH).length };
  });
  const bucket = (arr) => [0, 20, 40, 60, 80].map((lo) => arr.filter((v) => v >= lo && (lo === 80 ? v <= 100 : v < lo + 20)).length);
  const events = [
    ...deals.map((d) => ({ t: d.created_at, kind: d.qualified ? "qualified" : "pitch", name: d.name, title: d.title, score: d.score })),
    ...active.map((t) => ({ t: t.created_at, kind: "team", name: t.name })),
    ...subs.filter((x) => !x.status || x.status === "done").map((x) => ({ t: x.evaluated_at || x.created_at, kind: "eval", name: active.find((t) => t.id === x.team_id)?.name || "", title: x.title, score: x.ai_total })),
  ].filter((e) => e.name).sort((a, b) => (b.t > a.t ? 1 : -1)).slice(0, 12);
  return {
    phase: phase(s),
    kpi: {
      pitches: deals.length, qualified: deals.filter((d) => d.qualified).length,
      qualifyRate: deals.length ? Math.round((deals.filter((d) => d.qualified).length / deals.length) * 100) : 0,
      teams: active.length, members: active.reduce((a, t) => a + (t.members || []).length, 0),
      submissions: subs.length, avgScore: rows.length ? Math.round(rows.reduce((a, r) => a + r.best.ai_total, 0) / rows.length) : 0,
    },
    hours,
    tracks: s.hackathon.tracks.map((t) => ({ title: t.title, icon: t.icon, teams: active.filter((x) => x.track === t.id).length })),
    pitchHist: bucket(deals.map((d) => d.score || 0)),
    projHist: bucket(rows.map((r) => r.best.ai_total)),
    events,
  };
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    const scope = new URL(req.url, "http://x").searchParams.get("scope");
    return res.status(200).json(scope === "dashboard" ? await dashboard() : await getFeed());
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "feed failed" });
  }
}
