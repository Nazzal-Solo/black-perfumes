import type { Prisma } from "../generated/prisma/client.js";
import type { CatalogRow } from "./import.js";

const resolved = new Set(["M4", "M5", "M11", "M13", "M17", "M19", "M37", "W27"]);
export const corrections: Record<string, { name: string; inspirationFragrance: string | null }> = {
  M58: { name: "Dunhill — catalog M58", inspirationFragrance: null },
  M71: { name: "Tom Ford Neroli Portofino", inspirationFragrance: "Neroli Portofino" },
  M105: { name: "Chanel Platinum Égoïste", inspirationFragrance: "Platinum Égoïste" },
};

export function releasePlan(rows: CatalogRow[]) {
  const hold = new Map<string, string>();
  for (const row of rows) {
    if (row.review && !resolved.has(row.canonical) && !["M71", "M105"].includes(row.canonical)) hold.set(row.canonical, row.review);
  }
  hold.set("M7", "Linked M7/M87 merge: different Aventus bottle presentations; owner confirmation required.");
  hold.set("W42", "Linked W42/W45 possible duplicate: W45 is unlabeled; owner confirmation required.");
  return rows.filter((row) => row.reference === row.canonical).map((row) => ({ row, holdReason: hold.get(row.reference) ?? null }));
}

export async function releaseCatalog(tx: Prisma.TransactionClient, rows: CatalogRow[], expectedIds: Record<string, string>, namespace = "initial-catalog") {
  const plan = releasePlan(rows);
  if (plan.length !== 180 || plan.filter((item) => item.holdReason).length !== 34) throw new Error("Unexpected audit release plan; manual review required.");
  const products = await tx.product.findMany({ where: { catalogImportKey: { startsWith: namespace + ":" } }, include: { category: true } });
  if (products.length !== 180) throw new Error("Expected the complete 180-record import.");
  const changes: { reference: string; id: string; references: string[]; before: { name: string; inspirationFragrance: string | null; published: boolean; referenceVerified: boolean }; after: { name: string; inspirationFragrance: string | null; published: boolean; referenceVerified: boolean }; holdReason: string | null; action: string }[] = [];
  for (const { row, holdReason } of plan) {
    const product = products.find((item) => item.catalogImportKey === namespace + ":" + row.reference);
    const refs = rows.filter((item) => item.canonical === row.reference).map((item) => item.reference).sort();
    if (!product || expectedIds[row.reference] !== product.id || product.category.name !== row.category || JSON.stringify([...product.catalogReferences].sort()) !== JSON.stringify(refs)) throw new Error("Imported identity, category, or references changed; release aborted.");
    const corrected = corrections[row.reference];
    const matchesSource = (product.name === row.name || product.name === corrected?.name) && product.inspirationBrand === row.brand && (product.inspirationFragrance === row.fragrance || (corrected && product.inspirationFragrance === corrected.inspirationFragrance));
    const before = { name: product.name, inspirationFragrance: product.inspirationFragrance, published: product.isVisible, referenceVerified: product.referenceVerified };
    const data: Prisma.ProductUpdateManyMutationInput = {};
    let reason = holdReason;
    if (!matchesSource) reason = "Manual reference identity changes detected; no automatic publication or name overwrite.";
    if (corrected && matchesSource) Object.assign(data, corrected);
    if (!product.referenceVerified) {
      data.referenceVerified = !reason && !product.isArchived;
      data.isVisible = !reason && !product.isArchived;
    }
    if (product.isArchived) data.isVisible = false;
    // An explicit later admin verification/unpublication is never reversed by a repeated release.
    const after = { name: typeof data.name === "string" ? data.name : product.name, inspirationFragrance: data.inspirationFragrance === null || typeof data.inspirationFragrance === "string" ? data.inspirationFragrance : product.inspirationFragrance, published: typeof data.isVisible === "boolean" ? data.isVisible : product.isVisible, referenceVerified: typeof data.referenceVerified === "boolean" ? data.referenceVerified : product.referenceVerified };
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    if (changed) {
      const result = await tx.product.updateMany({ where: { id: product.id, updatedAt: product.updatedAt }, data });
      if (result.count !== 1) throw new Error("Concurrent admin edit detected; release rolled back.");
    }
    changes.push({ reference: row.reference, id: product.id, references: product.catalogReferences, before, after, holdReason: reason, action: changed ? "updated" : "unchanged" });
  }
  return changes;
}
