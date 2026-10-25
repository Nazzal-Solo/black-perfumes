import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import { db } from "../src/db.js";
import type { AuthStore } from "../src/auth/store.js";
import { createImageRouter, createImageUploadRouter } from "../src/images/routes.js";
import { ASSET_PREFIX, ImageService, MAX_IMAGE_BYTES, type CloudAsset, type ImageAssets } from "../src/images/service.js";

test("product image security, ordering, limits, and cleanup (database rollback; Cloudinary stubbed)", async (t) => {
  const rollback = new Error("Rollback image fixtures");
  let now = Date.now();
  let inMutation = false;
  let expired = false;
  let uploadCount = 0;
  let failUpload = false;
  let nextAsset: Partial<CloudAsset> = {};
  const assets = new Map<string, CloudAsset>();
  const deleted: string[] = [];
  const gateway: ImageAssets = {
    async upload(_buffer, publicId) {
      uploadCount++;
      if (failUpload) throw new Error("private provider details");
      const asset: CloudAsset = { public_id: publicId, secure_url: `https://res.cloudinary.com/test/image/upload/v1/${publicId}.jpg`, resource_type: "image", type: "upload", format: "jpg", bytes: 100, width: 1200, height: 800, created_at: new Date(now).toISOString(), ...nextAsset };
      nextAsset = {};
      assets.set(publicId, asset);
      return asset;
    },
    async get(publicId) { return assets.get(publicId) ?? null; },
    async list() { return { resources: [...assets.values()] }; },
    async destroy(publicId) { assert.equal(inMutation, false, "Cloudinary deletion must happen after the mutation commits"); deleted.push(publicId); assets.delete(publicId); },
  };
  const origin = "https://admin.example.test";
  const token = "a".repeat(64);
  const alternate = "b".repeat(64);
  const sessionHash = createHash("sha256").update(token).digest("hex");
  const store: AuthStore = {
    async attemptLogin() { throw new Error("Not used"); }, async createSession() {}, async revokeSession() {},
    async findSession(hash) {
      if (![token, alternate].some((value) => createHash("sha256").update(value).digest("hex") === hash)) return null;
      return { admin: { id: 1, email: "fixture@example.test" }, expiresAt: new Date(Date.now() + (expired ? -1000 : 60_000)) };
    },
  };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5]);
  const productId = randomUUID();
  const otherId = randomUUID();
  const secret = "test-only-upload-secret";
  try {
    await db.$transaction(async (tx) => {
      const category = await tx.category.create({ data: { name: `images-test-${randomUUID()}` } });
      for (const id of [productId, otherId]) await tx.product.create({ data: { id, name: "Image test perfume", priceJod: "1.234", categoryId: category.id } });
      const service = new ImageService({
        client: tx,
        async transaction(work) { inMutation = true; try { return await work(tx); } finally { inMutation = false; } },
      }, gateway, secret, () => now);
      const app = express();
      const options = { production: false, origins: [origin] };
      app.use("/api/admin", createImageUploadRouter(service, store, options));
      app.use("/api/admin", express.json({ limit: "32kb" }), createImageRouter(service, store, options));
      const errors: ErrorRequestHandler = (_error, _request, response, _next) => { response.status(500).json({ error: "Internal server error" }); };
      app.use(errors);
      const server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}/api/admin/products`;
      async function json(id: string, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
        return fetch(`${base}/${id}/images${path}`, { method, headers: { Cookie: `bp_admin=${token}`, ...(method !== "GET" ? { Origin: origin, "Content-Type": "application/json" } : {}), ...headers }, ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}) });
      }
      async function grant(id: string = productId) {
        const response = await json(id, "/signature", "POST", { size: jpeg.length, contentType: "image/jpeg" });
        assert.equal(response.status, 200);
        return await response.json() as { ticket: string; expiresAt: string; maxBytes: number };
      }
      function upload(ticket: string, buffer = jpeg, id = productId, headers: Record<string, string> = {}) {
        return fetch(`${base}/${id}/images/upload`, { method: "POST", headers: { Cookie: `bp_admin=${token}`, Origin: origin, "Content-Type": "image/jpeg", "X-Upload-Signature": ticket, ...headers }, body: buffer });
      }
      let firstTicket = "";
      try {
        await t.test("all signatures, uploads, reads, orders, and removals require sessions and trusted origins", async () => {
          const issued = await grant(); firstTicket = issued.ticket;
          const uppercase = await grant(productId.toUpperCase());
          assert.equal(service.authorize(productId, sessionHash, uppercase.ticket).productId, productId);
          assert.equal(new Date(issued.expiresAt).getTime() - now, 5 * 60_000);
          const text = JSON.stringify(issued);
          assert.ok(!text.includes(secret) && !text.includes(sessionHash) && !text.includes(token));
          for (const [path, method, body] of [["/signature", "POST", { size: 10, contentType: "image/jpeg" }], ["/order", "PUT", { imageIds: [] }], [`/${randomUUID()}`, "DELETE", {}]] as const) {
            assert.equal((await json(productId, path, method, body, { Cookie: "" })).status, 401);
            assert.equal((await json(productId, path, method, body, { Origin: "https://evil.example" })).status, 403);
            assert.equal((await json(productId, path, method, body, { Origin: "" })).status, 403);
          }
          assert.equal((await json(productId, "", "GET", undefined, { Cookie: "" })).status, 401);
          assert.equal((await upload(firstTicket, jpeg, productId, { Cookie: "" })).status, 401);
          assert.equal((await upload(firstTicket, jpeg, productId, { Origin: "https://evil.example" })).status, 403);
          expired = true;
          assert.equal((await upload(firstTicket)).status, 401);
          expired = false;
          assert.equal(uploadCount, 0);
        });
        await t.test("tickets are scoped to the session/product, tamper-resistant, and expire", async () => {
          assert.equal((await upload(firstTicket, jpeg, otherId)).status, 403);
          assert.equal((await upload(firstTicket, jpeg, productId, { Cookie: `bp_admin=${alternate}` })).status, 403);
          assert.equal((await upload(`x${firstTicket.slice(1)}`)).status, 403);
          const previous = now; now += 5 * 60_000;
          assert.equal((await upload(firstTicket)).status, 410);
          now = previous;
          assert.equal(uploadCount, 0);
        });
        await t.test("size, MIME type, magic bytes, and actual request limits are enforced before Cloudinary", async () => {
          for (const body of [{ size: MAX_IMAGE_BYTES + 1, contentType: "image/jpeg" }, { size: 10, contentType: "image/svg+xml" }, { size: 0, contentType: "image/png" }]) assert.equal((await json(productId, "/signature", "POST", body)).status, 400);
          assert.equal((await upload(firstTicket, Buffer.from("not-an-img"))).status, 400);
          assert.equal((await upload(firstTicket, jpeg, productId, { "Content-Type": "image/png" })).status, 400);
          assert.equal((await upload(firstTicket, Buffer.concat([jpeg, Buffer.from([0])]))).status, 400);
          const large = await json(productId, "/signature", "POST", { size: MAX_IMAGE_BYTES, contentType: "image/jpeg" });
          const largeTicket = (await large.json() as { ticket: string }).ticket;
          assert.equal((await upload(largeTicket, Buffer.alloc(MAX_IMAGE_BYTES + 1))).status, 413);
          assert.equal(uploadCount, 0);
        });
        await t.test("upload persists only server-owned metadata and is idempotent for retry", async () => {
          const response = await upload(firstTicket);
          assert.equal(response.status, 201);
          const images = await tx.productImage.findMany({ where: { productId } });
          assert.equal(images.length, 1);
          assert.equal(images[0]!.position, 0);
          assert.ok(images[0]!.cloudinaryPublicId.startsWith(`${ASSET_PREFIX}${productId}/`));
          assert.equal((await upload(firstTicket)).status, 201);
          assert.equal(uploadCount, 1);
          const injected = await json(productId, "/signature", "POST", { size: 10, contentType: "image/jpeg", publicId: "another-account-asset", url: "https://evil.example" });
          assert.equal(injected.status, 400);
        });
        await t.test("provider failures and invalid metadata cannot attach images or expose internals", async () => {
          const before = await tx.productImage.count({ where: { productId } });
          failUpload = true;
          const failure = await upload((await grant()).ticket);
          assert.equal(failure.status, 502);
          assert.ok(!(await failure.text()).includes("private provider details"));
          failUpload = false;
          for (const override of [{ bytes: MAX_IMAGE_BYTES + 1 }, { format: "svg" }, { width: 50000 }, { resource_type: "video" }, { secure_url: "https://evil.example/image" }]) {
            nextAsset = override;
            assert.equal((await upload((await grant()).ticket)).status, 400);
          }
          assert.equal(await tx.productImage.count({ where: { productId } }), before);
        });
        await t.test("primary/reordering avoids unique-position collisions and rejects foreign or stale image IDs", async () => {
          assert.equal((await upload((await grant()).ticket)).status, 201);
          assert.equal((await upload((await grant(otherId)).ticket, jpeg, otherId)).status, 201);
          const own = await service.list(productId);
          const other = (await service.list(otherId))[0]!;
          const order = own.map((image) => image.id).reverse();
          assert.equal((await json(productId, "/order", "PUT", { imageIds: order })).status, 200);
          const reordered = await service.list(productId);
          assert.deepEqual(reordered.map((image) => image.id), order);
          assert.deepEqual(reordered.map((image) => image.position), [0, 1]);
          for (const imageIds of [[other.id], [order[0], order[0]], [order[0]]]) assert.equal((await json(productId, "/order", "PUT", { imageIds })).status, 409);
          assert.equal((await json(productId, `/${other.id}`, "DELETE")).status, 404);
          assert.ok(!deleted.includes(other.cloudinaryPublicId));
        });
        await t.test("removal compacts order after DB mutation; fresh assets wait for ticket expiry; orphan cleanup is ownership-safe", async () => {
          const own = await service.list(productId);
          const removed = own[0]!;
          assert.equal((await json(productId, `/${removed.id}`, "DELETE")).status, 200);
          assert.deepEqual((await service.list(productId)).map((image) => image.position), [0]);
          assert.ok(assets.has(removed.cloudinaryPublicId));
          now += 16 * 60_000;
          const differentDatabase = new ImageService({ client: tx, transaction: (work) => work(tx) }, gateway, secret, () => now, "black-perfumes/another-database/products/");
          assert.equal(await differentDatabase.cleanupOne(removed.cloudinaryPublicId), false);
          assert.ok(assets.has(removed.cloudinaryPublicId));
          const remaining = (await service.list(productId))[0]!;
          assert.equal(await service.cleanupOne(remaining.cloudinaryPublicId), false);
          const unrelated = { ...assets.get(removed.cloudinaryPublicId)!, public_id: "unrelated-account-photo" };
          assets.set(unrelated.public_id, unrelated);
          const malformed = { ...unrelated, public_id: `${ASSET_PREFIX}${productId}/${"-".repeat(36)}` };
          assets.set(malformed.public_id, malformed);
          await service.cleanupUnused();
          assert.ok(deleted.includes(removed.cloudinaryPublicId));
          assert.ok(assets.has(remaining.cloudinaryPublicId));
          assert.ok(assets.has(unrelated.public_id));
          assert.ok(assets.has(malformed.public_id));
          assert.equal((await json(productId, `/${remaining.id}`, "DELETE")).status, 200);
          assert.ok(deleted.includes(remaining.cloudinaryPublicId));
          assert.equal(await tx.productImage.count({ where: { productId } }), 0);
        });
        await t.test("per-product image cap is enforced independently of client checks", async () => {
          const other = (await service.list(otherId))[0]!;
          for (let index = 0; index < 10; index++) await tx.productImage.create({ data: { productId, cloudinaryPublicId: `${ASSET_PREFIX}${productId}/${randomUUID()}`, url: other.url, position: index } });
          const before = uploadCount;
          assert.equal((await json(productId, "/signature", "POST", { size: 10, contentType: "image/jpeg" })).status, 409);
          assert.equal(uploadCount, before);
        });
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
      throw rollback;
    }, { maxWait: 20_000, timeout: 120_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});
