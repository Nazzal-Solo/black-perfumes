import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "../src/db.js";
import { loadCatalog, importCatalog } from "../src/catalog/import.js";
import { corrections, releaseCatalog, releasePlan } from "../src/catalog/release.js";

test("audit publication excludes every disputed canonical record and linked counterpart", async () => {
  const rows = await loadCatalog();
  const plan = releasePlan(rows);
  assert.equal(plan.filter((item) => !item.holdReason).length, 146);
  assert.equal(plan.filter((item) => item.holdReason).length, 34);
  for (const ref of ["M7", "M8", "M60", "M49", "M50", "M58", "M62", "W13", "W25", "W26", "W42", "W45", "W79"]) assert.ok(plan.find((item) => item.row.reference === ref)?.holdReason);
  for (const ref of ["M4", "M5", "M11", "M13", "M17", "M19", "M37", "W27", "M71", "M105"]) assert.equal(plan.find((item) => item.row.reference === ref)?.holdReason, null);
  assert.deepEqual(Object.keys(corrections), ["M58", "M71", "M105"]);
});

test("release corrects only audited names, retains unknowns/images/IDs/references, and respects repeat/manual unpublication (rollback)", async () => {
  const rollback = new Error("Rollback release verification");
  try {
    await db.$transaction(async (tx) => {
      const rows = await loadCatalog();
      const namespace = "release-test-" + randomUUID();
      const imported = await importCatalog(tx, rows, namespace);
      assert.equal(imported.filter((item) => item.outcome === "created-draft").length, 180);
      const ids = Object.fromEntries(imported.map((item) => [item.reference, item.id!]));
      const image = await tx.productImage.create({ data: { productId: ids.M71!, position: 0, cloudinaryPublicId: "release-test-" + randomUUID(), url: "https://example.test/approved.jpg" } });
      const first = await releaseCatalog(tx, rows, ids, namespace);
      assert.equal(first.filter((item) => item.after.published).length, 146);
      assert.equal(first.filter((item) => item.holdReason).length, 34);
      for (const [ref, correction] of Object.entries(corrections)) {
        const item = await tx.product.findUniqueOrThrow({ where: { id: ids[ref] } });
        assert.equal(item.name, correction.name); assert.equal(item.inspirationFragrance, correction.inspirationFragrance);
      }
      assert.equal((await tx.product.findUniqueOrThrow({ where: { id: ids.M58 } })).isVisible, false);
      const products = await tx.product.findMany({ where: { catalogImportKey: { startsWith: namespace + ":" } } });
      for (const item of products) {
        assert.equal(item.productType, "UNCONFIRMED"); assert.equal(item.priceJod, null); assert.equal(item.availability, null); assert.equal(item.sizeMl, null); assert.equal(item.concentration, null);
        const ref = item.catalogImportKey!.slice(namespace.length + 1);
        assert.equal(item.id, ids[ref]);
        assert.deepEqual(item.catalogReferences.sort(), rows.filter((row) => row.canonical === ref).map((row) => row.reference).sort());
      }
      assert.equal((await tx.productImage.findUniqueOrThrow({ where: { id: image.id } })).productId, ids.M71);
      const repeated = await releaseCatalog(tx, rows, ids, namespace);
      assert.ok(repeated.every((item) => item.action === "unchanged"));
      await tx.product.update({ where: { id: ids.M71 }, data: { isVisible: false, description: "Manual description preserved", priceJod: "22.500" } });
      await releaseCatalog(tx, rows, ids, namespace);
      const manual = await tx.product.findUniqueOrThrow({ where: { id: ids.M71 } });
      assert.equal(manual.isVisible, false); assert.equal(manual.description, "Manual description preserved"); assert.equal(manual.priceJod?.toString(), "22.5");
      throw rollback;
    }, { timeout: 120000, maxWait: 20000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
});
