import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { db } from "../src/db.js";
import { importCatalog, loadCatalog } from "../src/catalog/import.js";
import { createCatalogRouter } from "../src/catalog/routes.js";
import { createAdminRouter, productInput } from "../src/admin/routes.js";
import type { AuthStore } from "../src/auth/store.js";

test("all 10 catalog screenshots: complete numbered coverage, duplicate mapping, and uncertain defaults", async () => {
  const rows = await loadCatalog();
  assert.equal(rows.length, 189);
  assert.equal(new Set(rows.map((row) => row.source)).size, 10);
  for (const [prefix, count] of [["M", 107], ["W", 82]] as const) {
    for (let n = 1; n <= count; n++) assert.equal(rows.filter((row) => row.reference === prefix + n).length, 1);
  }
  assert.equal(rows.filter((row) => row.reference === row.canonical).length, 180);
  assert.equal(rows.filter((row) => row.reference !== row.canonical).length, 9);
  assert.equal(rows.filter((row) => row.review).length, 42);
  assert.equal(rows.find((row) => row.reference === "M48")?.canonical, "M10");
  assert.notEqual(rows.find((row) => row.reference === "M49")?.canonical, rows.find((row) => row.reference === "M50")?.canonical);
});

test("idempotent import, manual preservation, editable identity, archive/restore, and public catalog isolation (rolled back)", async () => {
  const rollback = new Error("Rollback catalog verification");
  const origin = "https://catalog.example.test";
  const store: AuthStore = {
    async attemptLogin() { throw new Error("unused"); }, async createSession() {}, async revokeSession() {},
    async findSession() { return { admin: { id: 1, email: "test@example.test" }, expiresAt: new Date(Date.now() + 60000) }; },
  };
  try {
    await db.$transaction(async (tx) => {
      const rows = await loadCatalog();
      const namespace = "catalog-test-" + randomUUID();
      const category = await tx.category.create({ data: { name: "verify-" + randomUUID() } });
      const manual = await tx.product.create({ data: { name: rows[0]!.name, categoryId: category.id, priceJod: "19.123", description: "Manual content" } });
      const first = await importCatalog(tx, rows, namespace);
      assert.equal(first.length, 180);
      assert.ok(first.some((item) => item.reference === "M1" && item.outcome === "manual-match-review-no-overwrite"));
      const imported = first.find((item) => item.outcome === "created-draft");
      assert.ok(imported?.id);
      const before = await tx.product.findUniqueOrThrow({ where: { id: imported.id } });
      assert.equal(before.productType, "UNCONFIRMED"); assert.equal(before.priceJod, null); assert.equal(before.isVisible, false); assert.equal(before.availability, null);
      await tx.product.update({ where: { id: imported.id }, data: { name: "Manually renamed", priceJod: "30.125", description: "Keep my edit" } });
      const again = await importCatalog(tx, rows, namespace);
      assert.equal(again.filter((item) => item.outcome === "created-draft").length, 0);
      const after = await tx.product.findUniqueOrThrow({ where: { id: imported.id } });
      assert.equal(after.name, "Manually renamed"); assert.equal(after.description, "Keep my edit"); assert.equal(after.priceJod?.toString(), "30.125");
      assert.equal((await tx.product.findUniqueOrThrow({ where: { id: manual.id } })).description, "Manual content");
      const app = express(); app.use(express.json()); app.use("/api", createCatalogRouter(tx)); app.use("/api/admin", createAdminRouter(tx, store, { production: false, origins: [origin] }));
      const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      const request = (path: string, method = "GET", body?: unknown, authenticated = true) => fetch(base + path, { method, headers: { ...(authenticated ? { Cookie: `bp_admin=${"a".repeat(64)}` } : {}), ...(method === "GET" ? {} : { Origin: origin, "Content-Type": "application/json" }) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      try {
        const name = "verify-" + randomUUID();
        const input = { name, description: "Confirmed description", priceJod: null, categoryId: category.id, isVisible: true, referenceVerified: true,
          inspirationBrand: "Reference brand", inspirationFragrance: "Reference fragrance", productType: "INSPIRED", customDisplayName: "House name", nameAr: "عطر تجريبي", descriptionAr: "وصف", disclosureText: "No affiliation", disclosureAr: "لا ارتباط", availability: null, sizeMl: null, concentration: null, fragranceNotes: null, fragranceNotesAr: null, isArchived: false, catalogReferences: ["M999"], seasonalRecommendations: ["Summer"], reviewNotes: "Internal only" };
        assert.ok(productInput.safeParse(input).success);
        const saved = await request(`/api/admin/products/${imported.id}`, "PUT", input);
        assert.equal(saved.status, 200);
        const savedBody = await saved.json() as { product: Record<string, unknown> };
        for (const [key, value] of Object.entries(input)) assert.deepEqual(savedBody.product[key], value);
        await tx.productImage.createMany({ data: [0, 1].map((position) => ({ productId: imported.id!, position, url: "https://example.test/image-" + position, cloudinaryPublicId: "test-" + randomUUID() })) });
        const publicDetail = await request(`/api/products/${imported.id}`); assert.equal(publicDetail.status, 200);
        const body = await publicDetail.json() as { product: Record<string, unknown> & { images: unknown[] } };
        assert.equal(body.product.images.length, 2); assert.equal(body.product.priceJod, null); assert.equal(body.product.availability, null);
        for (const field of ["reviewNotes", "catalogImportKey", "catalogReferences", "isArchived", "createdAt"]) assert.ok(!(field in body.product));
        assert.equal((await request(`/api/products/${manual.id}`)).status, 404);
        const unverified = await tx.product.create({ data: { name: "Unverified reference", categoryId: category.id, priceJod: null, isVisible: true, referenceVerified: false } });
        assert.equal((await request(`/api/products/${unverified.id}`)).status, 404);
        await tx.product.create({ data: { name: name + " second", categoryId: category.id, priceJod: null, isVisible: true, referenceVerified: true } });
        const list = await request(`/api/products?search=${name}&categoryId=${category.id}&limit=1&page=2`);
        const listing = await list.json() as { products: unknown[]; total: number; page: number }; assert.equal(listing.products.length, 1); assert.equal(listing.total, 2); assert.equal(listing.page, 2);
        const ar = await request(`/api/products?search=${encodeURIComponent("عطر تجريبي")}`); assert.equal((await ar.json() as { total: number }).total, 1);
        assert.equal((await request(`/api/admin/products/${imported.id}/archive`, "POST", { archived: true }, false)).status, 401);
        assert.equal((await request(`/api/admin/products/${imported.id}/archive`, "POST", { archived: true })).status, 200);
        assert.equal((await request(`/api/products/${imported.id}`)).status, 404);
        assert.equal(await tx.productImage.count({ where: { productId: imported.id } }), 2);
        assert.equal((await request(`/api/admin/products/${imported.id}/archive`, "POST", { archived: false })).status, 200);
        assert.equal((await request(`/api/products/${imported.id}`)).status, 404);
        assert.equal((await request(`/api/admin/products/${imported.id}`, "PUT", input)).status, 200);
        assert.equal((await request(`/api/products/${imported.id}`)).status, 200);
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
      throw rollback;
    }, { timeout: 120000, maxWait: 20000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});
