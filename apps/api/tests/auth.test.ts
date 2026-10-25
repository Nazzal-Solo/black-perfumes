import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { test, before } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { createAuthRouter, requireAdmin } from "../src/auth/routes.js";
import type { ActiveSession, AuthStore } from "../src/auth/store.js";

const password = "test-only-strong-password";
const origin = "https://admin.example.test";
let passwordHash: string;
before(async () => { passwordHash = await hashPassword(password); });

class MemoryStore implements AuthStore {
  attempts = 0;
  sessions = new Map<string, ActiveSession & { revoked?: boolean }>();
  async attemptLogin() {
    this.attempts++;
    return { id: 1, email: "admin@example.test", passwordHash, loginAttempts: this.attempts, retryAfter: 900 };
  }
  async createSession(hash: string, expiresAt: Date) {
    this.sessions.set(hash, { admin: { id: 1, email: "admin@example.test" }, expiresAt });
  }
  async findSession(hash: string) {
    const session = this.sessions.get(hash);
    return session && !session.revoked && session.expiresAt > new Date() ? session : null;
  }
  async revokeSession(hash: string) {
    const session = this.sessions.get(hash);
    if (session) session.revoked = true;
  }
}

async function withServer(run: (base: string, store: MemoryStore) => Promise<void>, production = false) {
  const store = new MemoryStore();
  const options = { production, origins: [origin] };
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "4kb" }));
  app.use("/api/admin", createAuthRouter(store, options));
  app.get("/protected", requireAdmin(store, options), (_request, response) => response.json({ allowed: true }));
  app.post("/protected", requireAdmin(store, options), (_request, response) => response.json({ allowed: true }));
  const errors: ErrorRequestHandler = (_error, _request, response, _next) => { response.status(500).json({ error: "Internal server error" }); };
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`, store); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

function login(base: string, options: { email?: string; password?: string; cookie?: string; origin?: string; secure?: boolean } = {}) {
  return fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: options.origin ?? origin, ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.secure ? { "X-Forwarded-Proto": "https" } : {}) },
    body: JSON.stringify({ email: options.email ?? "admin@example.test", password: options.password ?? password }),
  });
}

function sessionCookie(response: Response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";")[0]!;
}

test("scrypt uses unique salts, rejects wrong passwords, and handles unknown/corrupt hashes", async () => {
  const second = await hashPassword(password);
  assert.notEqual(passwordHash, second);
  assert.ok(await verifyPassword(password, passwordHash));
  assert.equal(await verifyPassword("wrong", passwordHash), false);
  assert.equal(await verifyPassword(password, undefined), false);
  assert.equal(await verifyPassword(password, "scrypt$999999999$8$3$bad$hash"), false);
});

test("login stores only a token hash, authenticates middleware, then revokes on logout", async () => withServer(async (base, store) => {
  const response = await login(base, { email: "ADMIN@example.test" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const cookie = sessionCookie(response);
  assert.match(response.headers.get("set-cookie")!, /HttpOnly/);
  assert.match(response.headers.get("set-cookie")!, /SameSite=Lax/);
  assert.doesNotMatch(response.headers.get("set-cookie")!, /Domain=/);
  const token = cookie.split("=")[1]!;
  assert.match(token, /^[a-f0-9]{64}$/);
  const hash = createHash("sha256").update(token).digest("hex");
  assert.ok(store.sessions.has(hash));
  assert.ok(!store.sessions.has(token));
  const body = await response.text();
  assert.ok(!body.includes(token) && !body.includes(passwordHash) && !body.includes(password));
  const session = await fetch(`${base}/api/admin/session`, { headers: { Cookie: cookie } });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { admin: { id: 1, email: "admin@example.test" }, expiresAt: [...store.sessions.values()][0]!.expiresAt.toISOString() });
  assert.equal((await fetch(`${base}/protected`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(`${base}/protected`, { method: "POST", headers: { Cookie: cookie, Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await fetch(`${base}/protected`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: "{}" })).status, 200);
  const logout = await fetch(`${base}/api/admin/logout`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie }, body: "{}" });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await fetch(`${base}/protected`, { headers: { Cookie: cookie } })).status, 401);
}));

test("production cookies are host-only, Secure, HttpOnly, and cross-site compatible; HTTP is rejected", async () => withServer(async (base) => {
  assert.equal((await login(base)).status, 403);
  const response = await login(base, { secure: true });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /^__Host-bp_admin=/);
  for (const attribute of [/Secure/, /HttpOnly/, /SameSite=None/, /Path=\//, /Max-Age=28800/]) assert.match(cookie, attribute);
  assert.doesNotMatch(cookie, /Domain=/);
}, true));

test("unknown email and wrong password share generic failure without setting cookies", async () => withServer(async (base) => {
  const unknown = await login(base, { email: "unknown@example.test" });
  const wrong = await login(base, { password: "wrong" });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(await unknown.json(), await wrong.json());
  assert.equal(unknown.headers.get("set-cookie"), null);
}));

test("login and logout reject missing/untrusted origins and simple-form CSRF", async () => withServer(async (base, store) => {
  for (const path of ["login", "logout"]) {
    const variants: Record<string, string>[] = [{}, { Origin: "https://evil.example", "Content-Type": "application/json" }, { Origin: origin, "Content-Type": "text/plain" }];
    for (const headers of variants) {
      assert.equal((await fetch(`${base}/api/admin/${path}`, { method: "POST", headers, body: "{}" })).status, 403);
    }
  }
  assert.equal(store.attempts, 0);
}));

test("rate limit applies across supplied emails, including malformed attempts, before password hashing", async () => withServer(async (base, store) => {
  store.attempts = 4;
  assert.equal((await login(base, { email: "not-an-email" })).status, 400);
  const blocked = await login(base);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "900");
  assert.equal(store.sessions.size, 0);
}));

test("expired, absent, malformed, and duplicate cookies cannot access protected routes", async () => withServer(async (base, store) => {
  const response = await login(base);
  const cookie = sessionCookie(response);
  for (const value of store.sessions.values()) value.expiresAt = new Date(Date.now() - 1);
  for (const candidate of ["", "bp_admin=malformed", `${cookie}; ${cookie}`, cookie]) {
    const denied = await fetch(`${base}/protected`, { headers: { Cookie: candidate } });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("cache-control"), "no-store");
  }
}));

test("successful reauthentication rotates the token and revokes the presented session", async () => withServer(async (base) => {
  const first = sessionCookie(await login(base));
  const second = sessionCookie(await login(base, { cookie: first }));
  assert.notEqual(first, second);
  assert.equal((await fetch(`${base}/protected`, { headers: { Cookie: first } })).status, 401);
  assert.equal((await fetch(`${base}/protected`, { headers: { Cookie: second } })).status, 200);
}));

test("database failures do not disclose internals or issue a session cookie", async () => withServer(async (base, store) => {
  store.createSession = async () => { throw new Error("private database credentials"); };
  const response = await login(base);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error" });
  assert.equal(response.headers.get("set-cookie"), null);
}));

test("bootstrap refuses missing explicit confirmation and never prints supplied secrets", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/create-admin.ts"], {
    env: { ...process.env, INITIAL_ADMIN_EMAIL: "admin@example.test", INITIAL_ADMIN_PASSWORD: password, INITIAL_ADMIN_CONFIRM: "" }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes(password) && !result.stderr.includes(password));
  assert.ok(result.stderr.includes("INITIAL_ADMIN_CONFIRM"));
});
