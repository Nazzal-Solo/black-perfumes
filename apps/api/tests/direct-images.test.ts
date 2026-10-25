import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import type { Prisma, ProductImage } from "../src/generated/prisma/client.js";
import type { AuthStore } from "../src/auth/store.js";
import { createImageRouter } from "../src/images/routes.js";
import { ASSET_PREFIX, ImageService, MAX_IMAGE_BYTES, type CloudAsset, type ImageAssets } from "../src/images/service.js";

test("direct Cloudinary grants and attachments retain session/origin, ownership, limits and idempotency without database writes", async () => {
  const id: string = randomUUID(); const otherId: string = randomUUID(); const token = "a".repeat(64); const otherToken = "b".repeat(64);
  const sessionKey = createHash("sha256").update(token).digest("hex"); const origin = "https://shop.example.test";
  let now = Date.now(); let failDatabase = false; let expiredSession = false;
  const images: ProductImage[] = []; const cloud = new Map<string, CloudAsset>();
  const client = {
    product: { findUnique: async ({ where }: { where: { id: string } }) => [id, otherId].includes(where.id) ? { id: where.id } : null },
    productImage: {
      findMany: async ({ where }: { where: { productId: string } }) => images.filter(image => image.productId === where.productId),
      create: async ({ data }: { data: Omit<ProductImage, "id" | "altText" | "createdAt"> }) => {
        if (failDatabase) throw Error("private database detail");
        const image = { ...data, id: randomUUID(), altText: "", createdAt: new Date() }; images.push(image); return image;
      },
    },
    $queryRaw: async () => [{ id }],
  } as unknown as Prisma.TransactionClient;
  const assets: ImageAssets = {
    sign(publicId) { return { url: "https://api.cloudinary.com/v1_1/fixture/image/upload", fields: { public_id: publicId, signature: "fixture" } }; },
    async upload() { throw Error("Binary upload must not be used"); }, async get(publicId) { return cloud.get(publicId) ?? null; }, async list() { return { resources: [] }; }, async destroy() {},
  };
  const service = new ImageService({ client, transaction: async work => work(client) }, assets, "fixture-secret", () => now);
  const store: AuthStore = {
    async attemptLogin() { throw Error("not used"); }, async createSession() {}, async revokeSession() {},
    async findSession(hash) { return [token, otherToken].some(value => createHash("sha256").update(value).digest("hex") === hash) ? { admin: { id: 1, email: "fixture@example.test" }, expiresAt: new Date(Date.now() + (expiredSession ? -1000 : 60_000)) } : null; },
  };
  const app = express(); app.set("trust proxy", 1); app.use(express.json());
  app.use("/api/admin", createImageRouter(service, store, { production: true, origins: [origin] }));
  const errors: ErrorRequestHandler = (_error, _request, response, _next) => { void _next; response.status(500).json({ error: "Internal server error" }); }; app.use(errors);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); const port = address.port;
  async function call(path: string, body: unknown, product = id, extra: Record<string, string> = {}) {
    return fetch(`http://127.0.0.1:${port}/api/admin/products/${product}/images/${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: `__Host-bp_admin=${token}`, "X-Forwarded-Proto": "https", ...extra }, body: JSON.stringify(body) });
  }
  function asset(publicId: string, changes: Partial<CloudAsset> = {}): CloudAsset {
    return { public_id: publicId, secure_url: `https://res.cloudinary.com/fixture/image/upload/${publicId}.png`, resource_type: "image", type: "upload", format: "png", bytes: 100, width: 800, height: 800, created_at: new Date(now).toISOString(), ...changes };
  }
  try {
    const issued = await call("signature", { size: 100, contentType: "image/png" }); assert.equal(issued.status, 200);
    const { ticket } = await issued.json() as { ticket: string }; const claim = service.authorize(id, sessionKey, ticket);
    assert.ok(claim.publicId.startsWith(ASSET_PREFIX + id));
    for (const path of ["direct-upload", "attach"]) {
      assert.equal((await call(path, { ticket }, id, { Cookie: "" })).status, 401);
      assert.equal((await call(path, { ticket }, id, { Origin: "https://evil.test" })).status, 403);
      assert.equal((await call(path, { ticket }, otherId)).status, 403);
      assert.equal((await call(path, { ticket }, id, { Cookie: `__Host-bp_admin=${otherToken}` })).status, 403);
    }
    const prepared = await call("direct-upload", { ticket }); assert.equal(prepared.status, 200); assert.equal(((await prepared.json()) as { uploaded: boolean }).uploaded, false);
    assert.equal((await call("attach", { ticket, url: "https://evil.test/image.png" })).status, 400);
    assert.equal((await call("attach", { ticket })).status, 409);
    for (const invalid of [{ bytes: MAX_IMAGE_BYTES + 1 }, { resource_type: "raw" }, { public_id: "unowned" }, { secure_url: "https://evil.test/image.png" }, { width: 2500 }]) {
      cloud.set(claim.publicId, asset(claim.publicId, invalid)); assert.equal((await call("attach", { ticket })).status, 400);
    }
    cloud.set(claim.publicId, asset(claim.publicId)); failDatabase = true;
    const failed = await call("attach", { ticket }); assert.equal(failed.status, 503); const error = await failed.json() as { stage: string; error: string }; assert.equal(error.stage, "attachment"); assert.ok(!error.error.includes("private database detail"));
    assert.equal(images.length, 0); assert.equal(cloud.size, 1); failDatabase = false;
    assert.equal(((await call("direct-upload", { ticket }).then(r => r.json())) as { uploaded: boolean }).uploaded, true);
    for (let retry = 0; retry < 2; retry++) assert.equal((await call("attach", { ticket })).status, 200);
    assert.equal(images.length, 1); assert.equal(images[0]!.cloudinaryPublicId, claim.publicId);
    expiredSession = true; assert.equal((await call("attach", { ticket })).status, 401); expiredSession = false;
    now += 5 * 60_000; assert.equal((await call("attach", { ticket })).status, 410);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
