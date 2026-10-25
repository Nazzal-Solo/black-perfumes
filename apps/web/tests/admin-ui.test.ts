import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogSummary, filterCatalog, formFingerprint, productPayload } from "../src/lib/admin-view";
import type { Product } from "../src/lib/admin-api";

const base: Product = { id: "sample", name: "Reference", description: "", priceJod: null, categoryId: "men", category: { id: "men", name: "Men" }, isVisible: false, referenceVerified: false, isArchived: false, productType: "UNCONFIRMED", inspirationBrand: null, inspirationFragrance: null, customDisplayName: null, nameAr: null, descriptionAr: null, disclosureText: null, disclosureAr: null, availability: null, sizeMl: null, concentration: null, fragranceNotes: null, fragranceNotesAr: null, catalogReferences: ["M58"], seasonalRecommendations: [], reviewNotes: null, images: [], _count: { images: 0 } };
const filter = { search: "", categoryId: "", visibility: "all", page: 1 };
test("summary and review queue use verification flags rather than historical notes", () => {
  const items = [base, { ...base, id: "published", referenceVerified: true, isVisible: true, reviewNotes: "Historical review retained" }, { ...base, id: "verified-draft", referenceVerified: true }, { ...base, id: "archived", isArchived: true, isVisible: true }];
  assert.deepEqual(catalogSummary(items), { total: 4, published: 1, drafts: 2, review: 1 });
  assert.deepEqual(filterCatalog(items, { ...filter, visibility: "review" }).map(item => item.id), ["sample"]);
  assert.deepEqual(filterCatalog(items, { ...filter, visibility: "hidden" }).map(item => item.id), ["sample", "verified-draft"]);
  assert.deepEqual(filterCatalog(items, { ...filter, visibility: "archived" }).map(item => item.id), ["archived"]);
});
test("search supports Arabic, original references and combined category/status filters", () => {
  const items = [base, { ...base, id: "arabic", categoryId: "women", nameAr: "عطر", catalogReferences: ["W12"], inspirationBrand: "Brand" }];
  assert.equal(filterCatalog(items, { ...filter, search: " m58 " })[0]?.id, "sample");
  assert.equal(filterCatalog(items, { ...filter, search: "عطر", categoryId: "women", visibility: "review" })[0]?.id, "arabic");
  assert.equal(filterCatalog(items, { ...filter, search: "brand", categoryId: "men" }).length, 0);
});
test("publication never includes archived or unverified references", () => {
  assert.equal(filterCatalog([{ ...base, isVisible: true }, { ...base, isVisible: true, referenceVerified: true, isArchived: true }], { ...filter, visibility: "visible" }).length, 0);
});
test("form payload preserves unknown values and all identity fields without inventing inventory", () => {
  const data = new FormData();
  data.set("name", " Reference "); data.set("categoryId", "men"); data.set("referenceVerified", "on"); data.set("productType", "UNCONFIRMED");
  data.set("catalogReferences", "M58, M71, "); data.append("seasonalRecommendations", "Summer"); data.append("seasonalRecommendations", "Winter");
  const result = productPayload(data);
  assert.equal(result.name, "Reference"); assert.equal(result.priceJod, null); assert.equal(result.availability, null); assert.equal(result.sizeMl, null); assert.equal(result.concentration, null);
  assert.equal(result.referenceVerified, true); assert.equal(result.isVisible, false); assert.equal(result.isArchived, false);
  assert.deepEqual(result.catalogReferences, ["M58", "M71"]); assert.deepEqual(result.seasonalRecommendations, ["Summer", "Winter"]);
  for (const field of ["nameAr", "descriptionAr", "inspirationBrand", "inspirationFragrance", "customDisplayName", "disclosureText", "disclosureAr", "fragranceNotes", "fragranceNotesAr", "reviewNotes"]) assert.ok(field in result);
});
test("dirty detection ignores file input but detects checkbox changes and reversions", () => {
  const data = new FormData(); data.set("name", "Reference"); const baseline = formFingerprint(data);
  data.set("image", new Blob(["image"]), "test.png"); assert.equal(formFingerprint(data), baseline);
  data.set("referenceVerified", "on"); assert.notEqual(formFingerprint(data), baseline);
  data.delete("referenceVerified"); assert.equal(formFingerprint(data), baseline);
});
