// الرابط الأساسي للموقع (لروابط البريد)
export function siteUrl(req) {
  const env = typeof window === "undefined" ? process.env.SITE_URL : null;
  if (env) return env.replace(/\/$/, "");
  const h = req?.headers || {};
  const host = h["x-forwarded-host"] || h.host;
  if (!host) return "";
  const proto = h["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
