import type { Product } from "./admin-api";
export type CatalogFilter = { search: string; categoryId: string; visibility: string; page: number };
export const needsReview = (item: Product) => !item.isArchived && !item.referenceVerified;
export const isPublished = (item: Product) => item.isVisible && item.referenceVerified && !item.isArchived;
export function catalogSummary(items: Product[]) {
 return { total: items.length, published: items.filter(isPublished).length, drafts: items.filter(item => !item.isArchived && !isPublished(item)).length, review: items.filter(needsReview).length };
}
export function filterCatalog(items: Product[], filter: CatalogFilter) {
 const search = filter.search.trim().toLocaleLowerCase();
 return items.filter(item => (!filter.categoryId || item.categoryId === filter.categoryId) &&
  (filter.visibility === "all" || (filter.visibility === "review" ? needsReview(item) : filter.visibility === "visible" ? isPublished(item) : filter.visibility === "hidden" ? !item.isArchived && !isPublished(item) : item.isArchived)) &&
  (!search || [item.name, item.nameAr, item.description, item.customDisplayName, item.inspirationBrand, item.inspirationFragrance, ...item.catalogReferences].some(value => value?.toLocaleLowerCase().includes(search))));
}
export const formFingerprint = (data: FormData) => JSON.stringify([...data.entries()].filter(([,value])=>typeof value === "string").sort(([a],[b])=>a.localeCompare(b)));
export function productPayload(data: FormData) {
 const nullable = ["inspirationBrand", "inspirationFragrance", "customDisplayName", "nameAr", "descriptionAr", "disclosureText", "disclosureAr", "sizeMl", "concentration", "fragranceNotes", "fragranceNotesAr", "reviewNotes", "availability"] as const;
 const optionalFields = Object.fromEntries(nullable.map(key=>[key,String(data.get(key)??"").trim()||null])) as Record<(typeof nullable)[number], string | null>;
 return { ...optionalFields,
 name:String(data.get("name")??"").trim(),description:String(data.get("description")??"").trim(),priceJod:String(data.get("priceJod")??"").trim()||null,categoryId:String(data.get("categoryId")??""),
 referenceVerified:data.get("referenceVerified")==="on",productType:String(data.get("productType")??"UNCONFIRMED"),isArchived:data.get("isArchived")==="on",isVisible:data.get("isVisible")==="on",
 catalogReferences:String(data.get("catalogReferences")??"").split(",").map(value=>value.trim()).filter(Boolean),seasonalRecommendations:data.getAll("seasonalRecommendations") };
}
