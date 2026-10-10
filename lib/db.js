// طبقة تخزين بسيطة: Supabase إذا توفرت المفاتيح، وإلا ذاكرة مؤقتة للتجربة المحلية
import { SB_URL as URL, SB_KEY as KEY, sbAuth } from "./supabase.js";
export const hasDb = Boolean(URL && KEY);

const mem = globalThis.__mem || (globalThis.__mem = {});
const seq = globalThis.__seq || (globalThis.__seq = { n: 0 });
const h = (x = {}) => ({ ...sbAuth(), "Content-Type": "application/json", ...x });

async function check(r, what) {
  if (!r.ok) throw new Error(`${what} ${r.status}: ${await r.text()}`);
  return r;
}

export async function insert(table, row) {
  row = { created_at: new Date().toISOString(), ...row };
  if (!hasDb) {
    const r = { id: ++seq.n, ...row };
    (mem[table] ||= []).push(r);
    return r;
  }
  const r = await fetch(`${URL}/rest/v1/${table}`, {
    method: "POST",
    headers: h({ Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  await check(r, `insert ${table}`);
  return (await r.json())[0];
}

// filters: مساواة فقط {column: value}
export async function select(table, filters = {}) {
  if (!hasDb) {
    return (mem[table] || []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
  }
  const qs = Object.entries(filters)
    .map(([k, v]) => `&${k}=eq.${encodeURIComponent(v)}`)
    .join("");
  const r = await fetch(`${URL}/rest/v1/${table}?select=*${qs}&order=created_at.asc`, { headers: h() });
  await check(r, `select ${table}`);
  return r.json();
}

// تعديل سجل واحد
export async function update(table, id, patch) {
  if (!hasDb) {
    const row = (mem[table] || []).find((r) => r.id === id);
    if (row) Object.assign(row, patch);
    return row || null;
  }
  const r = await fetch(`${URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: h({ Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  await check(r, `update ${table}`);
  return (await r.json())[0] || null;
}

// عدّ السجلات: eq مساواة، since = تاريخ ISO (created_at >= since)
export async function count(table, eq = {}, since = null) {
  if (!hasDb) {
    return (mem[table] || []).filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v) && (!since || r.created_at >= since)).length;
  }
  const qs = Object.entries(eq).map(([k, v]) => `&${k}=eq.${encodeURIComponent(v)}`).join("") + (since ? `&created_at=gte.${encodeURIComponent(since)}` : "");
  const r = await fetch(`${URL}/rest/v1/${table}?select=id${qs}&limit=1`, { headers: h({ Prefer: "count=exact" }) });
  await check(r, `count ${table}`);
  return Number((r.headers.get("content-range") || "").split("/")[1]) || 0;
}

// حذف سجل واحد
export async function removeOne(table, id) {
  if (!hasDb) {
    mem[table] = (mem[table] || []).filter((r) => r.id !== id);
    return;
  }
  await check(await fetch(`${URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: h() }), `delete ${table}`);
}

// حذف كل السجلات (لإعادة ضبط البيانات من لوحة التحكم)
export async function removeAll(table) {
  if (!hasDb) {
    mem[table] = [];
    return;
  }
  await check(await fetch(`${URL}/rest/v1/${table}?id=gt.0`, { method: "DELETE", headers: h() }), `delete ${table}`);
}

// ---------- الإعدادات (مفتاح ← قيمة JSON) ----------
export async function getSetting(key) {
  if (!hasDb) return mem.__settings?.[key] ?? null;
  const r = await fetch(`${URL}/rest/v1/app_settings?select=value&key=eq.${encodeURIComponent(key)}`, { headers: h() });
  await check(r, "get setting");
  const rows = await r.json();
  return rows[0]?.value ?? null;
}

export async function putSetting(key, value) {
  if (!hasDb) {
    (mem.__settings ||= {})[key] = value;
    return;
  }
  const r = await fetch(`${URL}/rest/v1/app_settings?on_conflict=key`, {
    method: "POST",
    headers: h({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
  await check(r, "put setting");
}
