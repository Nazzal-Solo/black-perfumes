import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { createAuthRouter, requireAdmin } from "../src/auth/routes.js";
import { hashPassword } from "../src/auth/password.js";
import type { ActiveSession, AuthStore } from "../src/auth/store.js";

const config = { apiOrigin: "https://api.example.test", appOrigin: "https://shop.example.test", production: true };
// Load the web handler at runtime so frontend builds never require generated Prisma files.
const proxyModule = new URL("../../web/src/lib/admin-proxy.ts", import.meta.url).href;
const { proxyAdmin } = await import(proxyModule) as {
  proxyAdmin(request: Request, path: string[], options: typeof config, upstreamFetch?: typeof fetch): Promise<Response>;
};
function request(path: string, method = "GET", body?: unknown, cookie?: string, extra: Record<string, string> = {}) {
  return new Request(`${config.appOrigin}/api/admin/${path}`, {
    method, headers: { ...(method !== "GET" ? { Origin: config.appOrigin, "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}

test("BFF login, refresh/session, protected requests, expiration and logout against Express auth (memory store)", async () => {
  const password = "fixture-only-password";
  const passwordHash = await hashPassword(password);
  const sessions = new Map<string, ActiveSession>();
  const store: AuthStore = {
    async attemptLogin() { return { id: 1, email: "admin@example.test", passwordHash, loginAttempts: 1, retryAfter: 900 }; },
    async createSession(hash, expiresAt) { sessions.set(hash, { admin: { id: 1, email: "admin@example.test" }, expiresAt }); },
    async findSession(hash) { return sessions.get(hash) ?? null; },
    async revokeSession(hash) { sessions.delete(hash); },
  };
  const app = express(); app.set("trust proxy", 1); app.use(express.json());
  const options = { production: true, origins: [config.appOrigin] };
  app.use("/api/admin", createAuthRouter(store, options));
  app.all("/api/admin/products", requireAdmin(store, options), (req, res) => res.json({ method: req.method, body: req.body, page: req.query.page }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let forwardedCookie = "";
  const gateway: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const headers = new Headers(init?.headers);
    forwardedCookie = headers.get("cookie") ?? "";
    assert.equal(headers.has("authorization"), false);
    headers.set("X-Forwarded-Proto", "https");
    return fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, { ...init, headers });
  };
  const send = (path: string, req: Request) => proxyAdmin(req, path.split("?")[0]!.split("/"), config, gateway);
  try {
    assert.equal((await send("session", request("session"))).status, 401);
    assert.equal((await send("login", request("login", "POST", { email: "admin@example.test", password: "wrong" }))).status, 401);
    const login = await send("login", request("login", "POST", { email: "admin@example.test", password }));
    assert.equal(login.status, 200);
    const setCookie = login.headers.getSetCookie()[0]!;
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(setCookie.includes(flag));
    assert.ok(setCookie.startsWith("__Host-bp_admin=")); assert.ok(!setCookie.includes("Domain=")); assert.ok(!setCookie.includes("SameSite=None"));
    const cookie = setCookie.split(";")[0]!;
    assert.ok(!(await login.text()).includes(cookie.split("=")[1]!));
    for (let refresh = 0; refresh < 2; refresh++) assert.equal((await send("session", request("session", "GET", undefined, cookie))).status, 200);
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const result = await send("products?page=2", request("products?page=2", method, { name: "test" }, cookie + "; bp_locale=ar; unrelated=private"));
      assert.equal(result.status, 200); const body = await result.json() as { method: string; page: string; body: unknown }; assert.equal(body.method, method); assert.equal(body.page, "2");
      if (method !== "GET") assert.deepEqual(body.body, { name: "test" });
      assert.equal(forwardedCookie, cookie);
      assert.match(result.headers.get("cache-control")!, /no-store/);
    }
    assert.equal((await send("logout", request("logout", "POST", {}, cookie))).status, 204);
    assert.equal(sessions.size, 0);
    assert.equal((await send("session", request("session", "GET", undefined, cookie))).status, 401);
    assert.equal((await send("products", request("products", "POST", {}, cookie))).status, 401);
    const second = await send("login", request("login", "POST", { email: "admin@example.test", password }));
    const secondCookie = second.headers.getSetCookie()[0]!.split(";")[0]!;
    for (const session of sessions.values()) session.expiresAt = new Date(0);
    const expired = await send("session", request("session", "GET", undefined, secondCookie));
    assert.equal(expired.status, 401); assert.match(expired.headers.getSetCookie()[0]!, /Expires=Thu, 01 Jan 1970/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("BFF rejects cross-site/missing origins, binary uploads, traversal and oversized JSON before forwarding", async () => {
  let calls = 0; const gateway: typeof fetch = async () => { calls++; return Response.json({}); };
  for (const [req, path, status] of [
    [request("login", "POST", {}, undefined, { Origin: "https://evil.test" }), ["login"], 403],
    [new Request(config.appOrigin + "/api/admin/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), ["logout"], 403],
    [request("session", "GET", undefined, undefined, { "Sec-Fetch-Site": "cross-site" }), ["session"], 403],
    [request("products", "POST", {}, undefined, { "Content-Type": "image/png" }), ["products"], 415],
    [request("products", "POST", { value: "x".repeat(256 * 1024) }), ["products"], 413],
    [request("products"), ["..", "session"], 400],
    [request("products"), ["products%2fsession"], 400],
  ] as const) assert.equal((await proxyAdmin(req, [...path], config, gateway)).status, status);
  assert.equal(calls, 0);
  const badConfig = await proxyAdmin(request("session"), ["session"], { ...config, apiOrigin: "http://api.example.test" }, gateway);
  assert.equal(badConfig.status, 503);
  const offline = await proxyAdmin(request("session"), ["session"], config, async () => { throw new Error("secret upstream detail"); });
  assert.equal(offline.status, 502); assert.ok(!(await offline.text()).includes("secret upstream detail"));
});

test("BFF preserves cookie expiration, retry headers and multiple Set-Cookie boundaries without forwarding unrelated cookies", async () => {
  const upstream: typeof fetch = async (_input, init) => {
    assert.equal(init?.redirect, "error"); assert.equal((init as { cache?: string })?.cache, "no-store");
    const headers = new Headers({ "Retry-After": "30" });
    headers.append("Set-Cookie", "unrelated=private; Path=/");
    headers.append("Set-Cookie", "__Host-bp_admin=; Domain=api.example.test; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=None; Path=/");
    return new Response(null, { status: 429, headers });
  };
  const result = await proxyAdmin(request("logout", "POST"), ["logout"], config, upstream);
  assert.equal(result.status, 429); assert.equal(result.headers.get("retry-after"), "30");
  const cookies = result.headers.getSetCookie(); assert.equal(cookies.length, 1);
  assert.match(cookies[0]!, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  assert.match(cookies[0]!, /Max-Age=0/); assert.ok(!cookies[0]!.includes("Domain="));
});

test("production BFF fails closed instead of returning login success when Render emits a development or missing cookie", async () => {
  for (const value of [undefined, `bp_admin=${"a".repeat(64)}; HttpOnly; SameSite=Lax; Path=/`]) {
    const upstream: typeof fetch = async () => Response.json({ admin: { id: 1 }, expiresAt: "fixture" }, { headers: value ? { "Set-Cookie": value } : {} });
    const result = await proxyAdmin(request("login", "POST", { email: "fixture@example.test", password: "fixture" }), ["login"], config, upstream);
    assert.equal(result.status, 502); assert.equal(result.headers.get("set-cookie"), null);
    const body = await result.text(); assert.match(body, /secure session/); assert.ok(!body.includes("a".repeat(64)));
    assert.match(result.headers.get("cache-control")!, /no-store/);
  }
});
