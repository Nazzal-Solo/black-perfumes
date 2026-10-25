import { createHash, randomBytes } from "node:crypto";
import { Router, type CookieOptions, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { verifyPassword } from "./password.js";
import type { AuthStore } from "./store.js";

type AuthOptions = { production: boolean; origins: string[]; binaryImageUpload?: boolean };
const credentials = z.object({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const cookieName = (production: boolean) => production ? "__Host-bp_admin" : "bp_admin";
const cookieOptions = (production: boolean): CookieOptions => ({
  httpOnly: true, secure: production, sameSite: production ? "none" : "lax", path: "/",
});

function allowedRequest(request: Request, options: AuthOptions) {
  return (!options.production || request.secure) &&
    (["GET", "HEAD", "OPTIONS"].includes(request.method) ||
      (options.origins.includes(request.get("origin") ?? "") &&
        (Boolean(request.is("application/json")) || (options.binaryImageUpload === true &&
          Boolean(request.get("X-Upload-Signature")) && Boolean(request.is(["image/jpeg", "image/png", "image/webp"]))))));
}

function readToken(request: Request, production: boolean) {
  const cookies = (request.headers.cookie ?? "").split(";").map((item) => item.trim());
  const values = cookies.filter((item) => item.startsWith(`${cookieName(production)}=`));
  if (values.length !== 1) return null;
  const token = values[0]!.slice(cookieName(production).length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function requireAdmin(store: AuthStore, options: AuthOptions): RequestHandler {
  return async (request, response, next) => {
    response.set("Cache-Control", "no-store");
    if (!allowedRequest(request, options)) { response.status(403).json({ error: "Forbidden" }); return; }
    const token = readToken(request, options.production);
    const session = token ? await store.findSession(tokenHash(token)) : null;
    if (!session || session.expiresAt <= new Date()) {
      response.clearCookie(cookieName(options.production), cookieOptions(options.production));
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    response.locals.admin = session.admin;
    response.locals.sessionExpiresAt = session.expiresAt;
    response.locals.sessionKey = tokenHash(token!);
    next();
  };
}

export function createAuthRouter(store: AuthStore, options: AuthOptions) {
  const router = Router();
  router.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.use((request, response, next) => {
    if (!allowedRequest(request, options)) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });

  router.post("/login", async (request, response) => {
    const parsed = credentials.safeParse(request.body);
    // Malformed attempts also consume the same persistent rate limit.
    const admin = await store.attemptLogin();
    if (admin && admin.loginAttempts > 5) {
      response.set("Retry-After", String(admin.retryAfter)).status(429).json({ error: "Too many login attempts" });
      return;
    }
    if (!parsed.success) { response.status(400).json({ error: "Invalid login request" }); return; }
    const verified = await verifyPassword(parsed.data.password, admin?.passwordHash);
    if (!admin || !verified || parsed.data.email !== admin.email) {
      response.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const previous = readToken(request, options.production);
    if (previous) await store.revokeSession(tokenHash(previous));
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await store.createSession(tokenHash(token), expiresAt);
    response.cookie(cookieName(options.production), token, { ...cookieOptions(options.production), expires: expiresAt, maxAge: 8 * 60 * 60 * 1000 });
    response.json({ admin: { id: admin.id, email: admin.email }, expiresAt });
  });

  router.get("/session", requireAdmin(store, options), (_request, response) => {
    response.json({ admin: response.locals.admin, expiresAt: response.locals.sessionExpiresAt });
  });

  router.post("/logout", async (request, response) => {
    const token = readToken(request, options.production);
    if (token) await store.revokeSession(tokenHash(token));
    response.clearCookie(cookieName(options.production), cookieOptions(options.production));
    response.status(204).end();
  });
  return router;
}
