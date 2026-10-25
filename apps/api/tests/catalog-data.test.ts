import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { loadCatalog, validateCatalogData } from "../src/catalog/import.js";

const directory = new URL("../src/catalog/data/", import.meta.url);
async function fixture() {
  const bytes = await readFile(new URL("initial-catalog.json", directory));
  const manifest = JSON.parse(await readFile(new URL("extraction-report.json", directory), "utf8"));
  return { bytes, manifest };
}
test("catalog loads from frozen data and source provenance without screenshot files", async () => {
  const rows = await loadCatalog();
  assert.equal(rows.length, 189);
  assert.equal(rows.filter(row => row.reference === row.canonical).length, 180);
  assert.equal(new Set(rows.map(row => row.source)).size, 10);
  assert.equal(rows.filter(row => row.review).length, 42);
});
test("catalog data checksum detects changed or corrupted import records", async () => {
  const { bytes, manifest } = await fixture();
  const rows = JSON.parse(bytes.toString()); rows[0].name = "Changed reference";
  assert.throws(() => validateCatalogData(Buffer.from(JSON.stringify(rows)), manifest), /Catalog data changed/);
});
test("catalog manifest rejects duplicate provenance and incomplete or foreign source coverage", async () => {
  const { bytes, manifest } = await fixture();
  const duplicate = structuredClone(manifest); duplicate.sources[1] = duplicate.sources[0];
  assert.throws(() => validateCatalogData(bytes, duplicate), /Incomplete catalog coverage/);
  const rows = JSON.parse(bytes.toString()); rows[0].source = "Unknown.png";
  const foreign = Buffer.from(JSON.stringify(rows));
  assert.throws(() => validateCatalogData(foreign, { ...manifest, catalogSha256: createHash("sha256").update(foreign).digest("hex") }), /Incomplete catalog coverage/);
  rows.pop(); const short = Buffer.from(JSON.stringify(rows));
  assert.throws(() => validateCatalogData(short, { ...manifest, catalogSha256: createHash("sha256").update(short).digest("hex") }), /Incomplete catalog coverage/);
});
