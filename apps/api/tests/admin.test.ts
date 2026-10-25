import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import { db } from "../src/db.js";
import { ADMIN_JSON_LIMIT, createAdminRouter } from "../src/admin/routes.js";
import type { AuthStore } from "../src/auth/store.js";

test("admin catalog CRUD, validation, authorization, and image preservation (all database changes rolled back)", async (t) => {
  const rollback = new Error("Rollback test fixtures");
  const prefix = `test-${randomUUID()}`;
  const origin = "https://admin.example.test";
  const cookie = `bp_admin=${"a".repeat(64)}`;
  let sessionExpired = false;
  const store: AuthStore = {
    async attemptLogin() { throw new Error("Not used by management routes"); },
    async createSession() {}, async revokeSession() {},
    async findSession() { return { admin: { id: 1, email: "test@example.test" }, expiresAt: new Date(Date.now() + (sessionExpired ? -60_000 : 60_000)) }; },
  };
  try {
    await db.$transaction(async (tx) => {
      const app = express();
      app.use(express.json({ limit: ADMIN_JSON_LIMIT }));
      app.use("/api/admin", createAdminRouter(tx, store, { production: false, origins: [origin] }));
      const errors: ErrorRequestHandler = (error: { status?: number }, _request, response, _next) => { response.status(error.status === 413 ? 413 : 500).json({ error: "Request failed" }); };
      app.use(errors);
      const server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}/api/admin`;
      async function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
        return fetch(`${base}${path}`, { method, headers: { Cookie: cookie, ...(method !== "GET" ? { Origin: origin, "Content-Type": "application/json" } : {}), ...headers }, ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}) });
      }
      async function expectDatabaseError(path: string, method: string, body?: unknown) {
        await tx.$executeRawUnsafe("SAVEPOINT expected_error");
        const response = await request(path, method, body);
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT expected_error");
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT expected_error");
        return response;
      }
      const unknownId = randomUUID();
      let categoryId = "";
      let productId = "";
      const product = { name: `${prefix} Amber`, description: "A warm, woody fragrance.", priceJod: "12.345", referenceVerified: true, categoryId: unknownId, isVisible: false };
      try {
        await t.test("every management mutation and read requires a session; unsafe origins fail", async () => {
          for (const [method, path] of [["POST", "/products"], ["PUT", `/products/${unknownId}`], ["DELETE", `/products/${unknownId}`], ["POST", "/categories"], ["PUT", `/categories/${unknownId}`], ["DELETE", `/categories/${unknownId}`]]) {
            assert.equal((await request(path!, method!, product, { Cookie: "" })).status, 401);
            for (const source of ["", "https://untrusted.example"]) assert.equal((await request(path!, method!, product, { Origin: source })).status, 403);
            assert.equal((await request(path!, method!, product, { "Content-Type": "text/plain" })).status, 403);
          }
          for (const path of ["/products", `/products/${unknownId}`, "/categories"]) assert.equal((await request(path, "GET", undefined, { Cookie: "" })).status, 401);
          sessionExpired = true;
          assert.equal((await request("/products")).status, 401);
          assert.equal((await request("/categories", "POST", { name: prefix })).status, 401);
          sessionExpired = false;
        });
        await t.test("category create/read/update and duplicate name conflicts", async () => {
          const created = await request("/categories", "POST", { name: ` ${prefix} ` });
          assert.equal(created.status, 201);
          categoryId = (await created.json() as { category: { id: string } }).category.id;
          assert.equal((await request(`/categories/${categoryId}`, "PUT", { name: `${prefix} Woods` })).status, 200);
          assert.equal((await expectDatabaseError("/categories", "POST", { name: `${prefix} Woods` })).status, 409);
          const response = await request("/categories");
          assert.equal(response.status, 200);
          const body = await response.json() as { categories: { id: string; name: string; _count: { products: number } }[] };
          const category = body.categories.find((item) => item.id === categoryId);
          assert.equal(category?.name, `${prefix} Woods`);
          assert.equal(category?._count.products, 0);
        });
        await t.test("product validation rejects invalid money, fields, and identifiers", async () => {
          for (const patch of [{ priceJod: "-1" }, { priceJod: "1.1234" }, { priceJod: "1e3" }, { priceJod: "10000000" }, { priceJod: 10 }, { name: " " }, { description: "x".repeat(5001) }, { isVisible: "true" }, { categoryId: "invalid" }, { images: [] }]) {
            assert.equal((await request("/products", "POST", { ...product, categoryId, ...patch })).status, 400);
          }
          assert.equal((await request("/categories", "POST", { name: " " })).status, 400);
          assert.equal((await request("/products/not-a-uuid")).status, 400);
          assert.equal((await request("/products?page=0")).status, 400);
          assert.equal((await request("/products?visibility=invalid")).status, 400);
        });
        await t.test("product create/edit retains ordered image relations and exact JOD amounts", async () => {
          assert.equal((await request("/products", "POST", { ...product, categoryId, isVisible: true, referenceVerified: false })).status, 400);
          const created = await request("/products", "POST", { ...product, categoryId });
          assert.equal(created.status, 201);
          const body = await created.json() as { product: { id: string; priceJod: string; isVisible: boolean } };
          productId = body.product.id;
          assert.equal((await request(`/products/${productId}`, "PUT", { ...product, categoryId, isVisible: true, referenceVerified: false })).status, 400);
          assert.equal(body.product.priceJod, "12.345");
          assert.equal(body.product.isVisible, false);
          await tx.productImage.create({ data: { productId, position: 0, url: "https://example.test/fixture", cloudinaryPublicId: prefix } });
          const updated = await request(`/products/${productId}`, "PUT", { ...product, categoryId, name: `${prefix} Oud`, priceJod: "99.999", isVisible: true });
          assert.equal(updated.status, 200);
          const saved = await updated.json() as { product: { name: string; priceJod: string; isVisible: boolean; _count: { images: number } } };
          assert.equal(saved.product.name, `${prefix} Oud`);
          assert.equal(saved.product.priceJod, "99.999");
          assert.equal(saved.product.isVisible, true);
          assert.equal(saved.product._count.images, 1);
          const localized = { ...product, categoryId, name: `${prefix} Oud`, priceJod: "99.999", isVisible: true, description: "ع".repeat(5000), descriptionAr: "ع".repeat(5000), fragranceNotesAr: "ع".repeat(5000), fragranceNotes: "ع".repeat(5000) };
          assert.ok(Buffer.byteLength(JSON.stringify(localized)) > 32 * 1024);
          const multilingual = await request(`/products/${productId}`, "PUT", localized);
          assert.equal(multilingual.status, 200, "Valid multilingual fields must fit the bounded parser limit");
          assert.equal((await multilingual.json() as { product: { descriptionAr: string } }).product.descriptionAr.length, 5000);
          assert.equal((await request(`/products/${productId}`, "PUT", { ...localized, extra: "x".repeat(300000) })).status, 413);
          assert.equal((await tx.productImage.findFirstOrThrow({ where: { productId } })).position, 0);
          assert.equal((await request(`/products/${productId}`)).status, 200);
          assert.equal((await request(`/products/${unknownId}`)).status, 404);
          assert.equal((await expectDatabaseError(`/products/${unknownId}`, "PUT", { ...product, categoryId })).status, 404);
          assert.equal((await expectDatabaseError("/products", "POST", product)).status, 409);
        });
        await t.test("search, category/visibility filtering, and pagination operate server-side", async () => {
          assert.equal((await request("/products", "POST", { ...product, name: `${prefix} Rose`, categoryId })).status, 201);
          const list = await request(`/products?search=${prefix.toUpperCase()}&categoryId=${categoryId}&pageSize=1&page=1`);
          const body = await list.json() as { products: { id: string }[]; total: number; pageSize: number };
          assert.equal(body.total, 2);
          assert.equal(body.products.length, 1);
          const next = await request(`/products?search=${prefix}&pageSize=1&page=2`);
          const nextBody = await next.json() as { products: { id: string }[] };
          assert.notEqual(body.products[0]!.id, nextBody.products[0]!.id);
          for (const visibility of ["visible", "hidden"]) {
            const filtered = await request(`/products?search=${prefix}&visibility=${visibility}`);
            assert.equal((await filtered.json() as { total: number }).total, 1);
          }
          assert.equal(list.headers.get("cache-control"), "no-store");
        });
        await t.test("product DELETE archives without removing data/images; assigned categories remain protected", async () => {
          assert.equal((await expectDatabaseError(`/categories/${categoryId}`, "DELETE")).status, 409);
          assert.equal((await request(`/products/${productId}`, "DELETE")).status, 204);
          assert.equal(await tx.productImage.count({ where: { productId } }), 1);
          const archived = await tx.product.findUniqueOrThrow({ where: { id: productId } });
          assert.equal(archived.isArchived, true); assert.equal(archived.isVisible, false);
          assert.equal((await expectDatabaseError(`/categories/${categoryId}`, "DELETE")).status, 409);
          const remaining = await tx.product.findMany({ where: { categoryId }, select: { id: true } });
          for (const item of remaining) assert.equal((await request(`/products/${item.id}`, "DELETE")).status, 204);
          // Remove only isolated test fixtures inside this rolled-back transaction.
          await tx.product.deleteMany({ where: { categoryId } });
          assert.equal((await request(`/categories/${categoryId}`, "DELETE")).status, 204);
          assert.equal((await expectDatabaseError(`/categories/${categoryId}`, "DELETE")).status, 404);
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      throw rollback;
    }, { maxWait: 20_000, timeout: 60_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});
