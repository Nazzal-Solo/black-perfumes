import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "../src/db.js";
import { env } from "../src/config/env.js";
import { cloudinaryAssets } from "../src/images/cloudinary-assets.js";
import { ImageService } from "../src/images/service.js";

test("opt-in live Cloudinary upload, retry, primary order and removal; DB rollback and isolated asset cleanup", { skip: process.env.RUN_LIVE_CLOUDINARY_QA !== "1", timeout: 120000 }, async () => {
  const prefix = `black-perfumes/qa/${randomUUID()}/products/`;
  const createdAssets = new Set<string>();
  const rollback = new Error("Rollback isolated live QA fixtures");
  try {
    try {
      await db.$transaction(async tx => {
        const category = await tx.category.create({ data: { name: `cloudinary-qa-${randomUUID()}` } });
        const product = await tx.product.create({ data: { name: "Private Cloudinary QA fixture", categoryId: category.id } });
        const service = new ImageService({ client: tx, transaction: work => work(tx) }, cloudinaryAssets, env.CLOUDINARY_API_SECRET, Date.now, prefix);
        const bytes = await readFile(new URL("../../web/public/Berfumes Black_logo.png", import.meta.url));
        const issue = async () => {
          const grant = await service.issue(product.id, "isolated-test-session", bytes.length, "image/png");
          const claim = JSON.parse(Buffer.from(grant.ticket.split(".")[0]!, "base64url").toString()) as { publicId: string };
          assert.ok(claim.publicId.startsWith(prefix)); createdAssets.add(claim.publicId);
          return grant.ticket;
        };
        const first = await issue();
        const single = await service.upload(product.id, "isolated-test-session", first, "image/png", bytes);
        assert.equal(single.length, 1);
        assert.equal((await service.upload(product.id, "isolated-test-session", first, "image/png", bytes)).length, 1);
        const pair = await service.upload(product.id, "isolated-test-session", await issue(), "image/png", bytes);
        assert.equal(pair.length, 2);
        const reversed = await service.reorder(product.id, pair.map(image => image.id).reverse());
        assert.equal(reversed[0]!.id, pair[1]!.id);
        const remaining = await service.remove(product.id, reversed[0]!.id);
        assert.equal(remaining.length, 1); assert.equal(remaining[0]!.position, 0);
        assert.equal((await tx.product.findUniqueOrThrow({ where: { id: product.id } })).isVisible, false);
        throw rollback;
      }, { timeout: 110000, maxWait: 10000 });
    } catch (error) { if (error !== rollback) throw error; }
  } finally {
    await db.$disconnect();
    const cleanup = await Promise.allSettled([...createdAssets].map(async id => {
      assert.ok(id.startsWith(prefix));
      await cloudinaryAssets.destroy(id);
      assert.equal(await cloudinaryAssets.get(id), null);
    }));
    assert.ok(cleanup.every(result => result.status === "fulfilled"), "Every isolated QA asset must be removed; provider details are withheld");
  }
});
