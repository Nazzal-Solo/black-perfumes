import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import type { Prisma } from "../src/generated/prisma/client.js";
import type { AuthStore } from "../src/auth/store.js";
import { ImageService, type ImageAssets } from "../src/images/service.js";
import { createImageUploadRouter } from "../src/images/routes.js";
import { cloudinaryStatus, cloudinaryUploadFailure } from "../src/images/upload-error.js";

test("upload errors preserve safe provider diagnostics and distinguish database attachment failures", async () => {
  const productId = randomUUID();
  let mode: "provider" | "database" | "success" = "provider";
  let attachmentAttempts = 0;
  const stored: { id: string; productId: string; cloudinaryPublicId: string; url: string; position: number }[] = [];
  const client = {
    product: { async findUnique() { return { id: productId }; } },
    productImage: {
      async findMany() { return stored; },
      async create({ data }: { data: typeof stored[number] }) { stored.push({ ...data, id: randomUUID() }); },
    },
    async $queryRaw() { return [{ id: productId }]; },
  } as unknown as Prisma.TransactionClient;
  const privateValue = "never-return-private-provider-data";
  const assets: ImageAssets = {
    async upload(_buffer, publicId) {
      if (mode === "provider") throw cloudinaryUploadFailure({ error: { http_code: 401, message: `cloud_name mismatch ${privateValue}` } });
      return { public_id: publicId, secure_url: `https://res.cloudinary.com/test/image/upload/v1/${publicId}.jpg`, resource_type: "image", type: "upload", format: "jpg", bytes: 10, width: 1, height: 1, created_at: new Date().toISOString() };
    },
    async get() { return null; }, async list() { return { resources: [] }; }, async destroy() {},
  };
  const service = new ImageService({ client, async transaction(work) {
    attachmentAttempts++;
    if (mode === "database") throw new Error(`database connection ${privateValue}`);
    return work(client);
  } }, assets, "test-only-ticket-secret");
  const store: AuthStore = {
    async attemptLogin() { return null; }, async createSession() {}, async revokeSession() {},
    async findSession() { return { admin: { id: 1, email: "fixture@example.test" }, expiresAt: new Date(Date.now() + 60_000) }; },
  };
  const app = express();
  app.use("/api/admin", createImageUploadRouter(service, store, { production: false, origins: ["https://admin.example.test"] }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5]);
  const { createHash } = await import("node:crypto");
  const token = "a".repeat(64);
  const grant = await service.issue(productId, createHash("sha256").update(token).digest("hex"), buffer.length, "image/jpeg");
  const upload = () => fetch(`http://127.0.0.1:${address.port}/api/admin/products/${productId}/images/upload`, { method: "POST", headers: {
    Cookie: `bp_admin=${token}`, Origin: "https://admin.example.test", "Content-Type": "image/jpeg", "X-Upload-Signature": grant.ticket,
  }, body: buffer });
  try {
    const failedUpload = await upload();
    assert.equal(failedUpload.status, 502);
    const uploadBody = await failedUpload.json() as { stage: string; code: string; providerStatus: number };
    assert.equal(uploadBody.stage, "upload");
    assert.equal(uploadBody.code, "CLOUDINARY_CLOUD_MISMATCH");
    assert.equal(uploadBody.providerStatus, 401);
    assert.equal(attachmentAttempts, 0);
    assert.ok(!JSON.stringify(uploadBody).includes(privateValue));
    mode = "database";
    const failedAttachment = await upload();
    assert.equal(failedAttachment.status, 503);
    const attachmentBody = await failedAttachment.json() as { stage: string; code: string; error: string };
    assert.equal(attachmentBody.stage, "attachment");
    assert.equal(attachmentBody.code, "IMAGE_ATTACHMENT_FAILED");
    assert.match(attachmentBody.error, /reached Cloudinary/);
    assert.ok(!JSON.stringify(attachmentBody).includes(privateValue));
    mode = "success";
    const success = await upload();
    assert.equal(success.status, 201);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.productId, productId);
    for (const [status, message, code] of [[401, `Invalid Signature ${privateValue}`, "CLOUDINARY_AUTH_FAILED"], [400, `Invalid image file ${privateValue}`, "CLOUDINARY_INVALID_IMAGE"], [429, privateValue, "CLOUDINARY_RATE_LIMITED"], [499, privateValue, "CLOUDINARY_TIMEOUT"]] as const) {
      const error = cloudinaryUploadFailure({ http_code: status, message });
      assert.equal(error.code, code);
      assert.ok(!error.message.includes(privateValue));
    }
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("Cloudinary API status handles nested SDK 404s without treating authentication failures as missing assets", () => {
  assert.equal(cloudinaryStatus({ error: { http_code: 404 } }), 404);
  assert.equal(cloudinaryStatus({ http_code: 404 }), 404);
  assert.equal(cloudinaryStatus({ cause: { http_code: 401 } }), 401);
  assert.equal(cloudinaryStatus({ error: { http_code: "404" } }), undefined);
  assert.equal(cloudinaryStatus(null), undefined);
});
