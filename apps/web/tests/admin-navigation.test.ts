import assert from "node:assert/strict";
import test from "node:test";
import { activeAdminItem, adminSectionForPath } from "../src/lib/admin-view";
import { fetchAdminCatalog } from "../src/lib/admin-catalog";

test("sidebar state covers filtered products, review/archive and nested route boundaries", () => {
  for (const visibility of ["all", "visible", "hidden"]) assert.equal(activeAdminItem("products", visibility), "products");
  assert.equal(activeAdminItem("products", "review"), "review");
  assert.equal(activeAdminItem("products", "archived"), "archived");
  for (const section of ["appearance", "categories", "products"] as const) {
    assert.equal(adminSectionForPath(`/admin/${section}`, "products"), section);
    assert.equal(adminSectionForPath(`/admin/${section}/nested`, "products"), section);
    assert.equal(activeAdminItem(section, "hidden"), section);
  }
  assert.equal(adminSectionForPath("/admin/appearance-old", "categories"), "categories");
  assert.equal(adminSectionForPath(null, "categories"), "categories");
});

test("shared catalog fetch includes every page and categories without caching authenticated responses", async () => {
  const original = globalThis.fetch; const requests: string[] = []; const controller = new AbortController();
  globalThis.fetch = async (input, init) => {
    const url = String(input); requests.push(url);
    assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store"); assert.equal(init?.signal, controller.signal);
    if (url.endsWith("/categories")) return Response.json({ categories: [{ id: "men", name: "Men", _count: { products: 51 } }] });
    const page = Number(new URL(url, "https://example.test").searchParams.get("page"));
    return Response.json({ products: [{ id: String(page) }], total: 51, pageSize: 50, page });
  };
  try { const result = await fetchAdminCatalog(controller.signal); assert.deepEqual(result.products.map(p => p.id), ["1", "2"]); assert.equal(result.categories.length, 1); assert.equal(requests.length, 3); }
  finally { globalThis.fetch = original; }
});
