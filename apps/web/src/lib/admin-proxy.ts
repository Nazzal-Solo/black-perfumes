export type AdminProxyConfig = { apiOrigin: string; appOrigin: string; production: boolean };
const MAX_BODY = 256 * 1024;
const SESSION_NAMES = ["__Host-bp_admin", "bp_admin"];
const noStore = { "Cache-Control": "private, no-store", Pragma: "no-cache" };
const failure = (status: number, error: string) => Response.json({ error }, { status, headers: noStore });

function sessionCookies(cookie: string, production: boolean) {
  return cookie.split(";").map(value => value.trim()).filter(value => {
    const [name, token] = value.split("=");
    return (name === "__Host-bp_admin" || (!production && name === "bp_admin")) && /^[a-f0-9]{64}$/.test(token ?? "");
  }).join("; ");
}

function browserCookie(cookie: string, production: boolean) {
  const [pair, ...attributes] = cookie.split(";").map(value => value.trim());
  const name = pair?.split("=")[0];
  if (!name || !SESSION_NAMES.includes(name) || (production && name !== "__Host-bp_admin")) return null;
  const lifetime = attributes.filter(value => /^(expires|max-age)=/i.test(value));
  return [pair, ...lifetime, "Path=/", "HttpOnly", "SameSite=Lax", ...(production || name.startsWith("__Host-") ? ["Secure"] : [])].join("; ");
}

export async function proxyAdmin(request: Request, path: string[], config: AdminProxyConfig, upstreamFetch: typeof fetch = fetch): Promise<Response> {
  let api: URL;
  let app: URL;
  try {
    api = new URL(config.apiOrigin); app = new URL(config.appOrigin);
    if (api.origin !== config.apiOrigin || app.origin !== config.appOrigin || api.username || api.password || api.origin === app.origin ||
      ![api, app].every(url => config.production ? url.protocol === "https:" : ["http:", "https:"].includes(url.protocol))) throw new Error();
  } catch { return failure(503, "Admin connection is not configured correctly."); }
  if (!path.length || path.some(part => !/^[a-zA-Z0-9-]+$/.test(part))) return failure(400, "Invalid admin path.");
  const method = request.method;
  if (!["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method)) return failure(405, "Method not allowed.");
  const mutation = !["GET", "HEAD"].includes(method);
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== app.origin) || (mutation && origin !== app.origin)) return failure(403, "Forbidden");
  if (mutation && request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return failure(415, "Admin requests must use JSON. Upload image files directly to Cloudinary.");
  const headers = new Headers({ Accept: "application/json" });
  const cookie = sessionCookies(request.headers.get("cookie") ?? "", config.production);
  if (cookie) headers.set("Cookie", cookie);
  if (origin) headers.set("Origin", origin);
  let body: Uint8Array | undefined;
  if (mutation) {
    headers.set("Content-Type", "application/json");
    if (Number(request.headers.get("content-length")) > MAX_BODY) return failure(413, "Admin request is too large.");
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      if (reader) while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BODY) { await reader.cancel(); return failure(413, "Admin request is too large."); }
        chunks.push(chunk.value);
      }
    } catch { return failure(400, "Unable to read admin request."); }
    body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  }
  try {
    const target = new URL(`/api/admin/${path.join("/")}`, api);
    target.search = new URL(request.url).search;
    const upstream = await upstreamFetch(target, {
      method, headers, ...(body ? { body: body as BodyInit } : {}), cache: "no-store", redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
    });
    const responseHeaders = new Headers(noStore);
    for (const name of ["Content-Type", "Retry-After"]) { const value = upstream.headers.get(name); if (value) responseHeaders.set(name, value); }
    for (const value of upstream.headers.getSetCookie()) {
      const cookie = browserCookie(value, config.production);
      if (cookie) responseHeaders.append("Set-Cookie", cookie);
    }
    return new Response(method === "HEAD" || upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return failure(502, "Unable to reach the admin API. Please try again."); }
}
