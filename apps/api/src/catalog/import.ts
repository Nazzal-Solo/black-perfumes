import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";

const rowSchema = z.object({ reference: z.string(), number: z.number().int(), category: z.enum(["Men", "Women"]), brand: z.string(), fragrance: z.string().nullable(), name: z.string(), source: z.string(), review: z.string().nullable(), canonical: z.string(), season: z.string().nullable() });
const manifestSchema = z.object({
  sourceFiles: z.literal(10), sourceEntries: z.literal(189), uniqueProducts: z.literal(180),
  catalogSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sources: z.array(z.object({ filename: z.string().regex(/^Screenshot_33(?:0[1-9]|10)\.png$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).length(10),
});
export function validateCatalogData(bytes: Buffer, metadata: unknown) {
  const manifest = manifestSchema.parse(metadata);
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.catalogSha256) throw new Error("Catalog data changed; review extraction before importing.");
  const sources = new Set(manifest.sources.map(source => source.filename));
  const rows = z.array(rowSchema).parse(JSON.parse(bytes.toString("utf8")));
  if (sources.size !== 10 || rows.length !== manifest.sourceEntries || new Set(rows.map(row => row.source)).size !== 10 || rows.some(row => !sources.has(row.source)) || rows.filter(row => row.reference === row.canonical).length !== manifest.uniqueProducts) throw new Error("Incomplete catalog coverage; review extraction before importing.");
  return rows;
}
export const loadCatalog = async () => {
  const [bytes, metadata] = await Promise.all([
    readFile(new URL("./data/initial-catalog.json", import.meta.url)),
    readFile(new URL("./data/extraction-report.json", import.meta.url), "utf8"),
  ]);
  return validateCatalogData(bytes, JSON.parse(metadata));
};
export type CatalogRow = z.infer<typeof rowSchema>;
const normalized = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export async function importCatalog(tx: Prisma.TransactionClient, rows: CatalogRow[], namespace = "initial-catalog") {
  if (rows.length !== 189 || new Set(rows.map((row) => row.reference)).size !== 189) throw new Error("Expected all 189 distinct source references.");
  const canonical = rows.filter((row) => row.reference === row.canonical);
  if (canonical.length !== 180 || rows.some((row) => !canonical.some((item) => item.reference === row.canonical))) throw new Error("Invalid source deduplication map.");
  const categories = await tx.category.findMany();
  const existing = await tx.product.findMany({ select: { id: true, name: true, categoryId: true, inspirationBrand: true, inspirationFragrance: true, catalogImportKey: true } });
  const report: { reference: string; name: string; outcome: string; id?: string }[] = [];
  for (const row of canonical) {
    const key = namespace + ":" + row.reference;
    const previous = existing.find((item) => item.catalogImportKey === key);
    if (previous) { report.push({ reference: row.reference, name: row.name, outcome: "already-imported", id: previous.id }); continue; }
    let category = categories.find((item) => (row.category === "Men" ? ["men", "mens", "رجالي", "رجال", "عطوررجالية"] : ["women", "womens", "نسائي", "نساء", "عطورنسائية"]).includes(normalized(item.name)));
    if (!category) { category = await tx.category.create({ data: { name: row.category } }); categories.push(category); }
    const collision = existing.find((item) => !item.catalogImportKey && (normalized(item.name) === normalized(row.name) || (row.fragrance && normalized(item.inspirationBrand ?? "") === normalized(row.brand) && normalized(item.inspirationFragrance ?? "") === normalized(row.fragrance))));
    if (collision) { report.push({ reference: row.reference, name: row.name, outcome: "manual-match-review-no-overwrite", id: collision.id }); continue; }
    const sources = rows.filter((item) => item.canonical === row.reference);
    const product = await tx.product.create({ data: {
      name: row.name, categoryId: category.id, priceJod: null, isVisible: false,
      inspirationBrand: row.brand, inspirationFragrance: row.fragrance,
      productType: "UNCONFIRMED", catalogImportKey: key,
      catalogReferences: sources.map((item) => item.reference),
      seasonalRecommendations: [...new Set(sources.flatMap((item) => item.season ? [item.season] : []))],
      reviewNotes: sources.flatMap((item) => item.review ? [`${item.reference}: ${item.review}`] : []).join("\n") || null,
    } });
    report.push({ reference: row.reference, name: row.name, outcome: "created-draft", id: product.id });
  }
  return report;
}
