import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";

const filters = z.object({ categoryId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(24).default(6), page: z.coerce.number().int().min(1).max(100000).default(1), search: z.string().trim().max(200).default("") }).strict();
const publicFields = {
  id: true, name: true, nameAr: true, customDisplayName: true, description: true, descriptionAr: true, priceJod: true,
  inspirationBrand: true, inspirationFragrance: true, productType: true, disclosureText: true, disclosureAr: true,
  availability: true, sizeMl: true, concentration: true, fragranceNotes: true, fragranceNotesAr: true,
  category: { select: { id: true, name: true } },
  images: { orderBy: { position: "asc" }, select: { url: true, altText: true } },
} as const satisfies Prisma.ProductSelect;

export function createCatalogRouter(client: Prisma.TransactionClient) {
  const router = Router();
  router.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.get("/products", async (request, response) => {
    const parsed = filters.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ error: "Invalid collection filters." }); return; }
    const { categoryId, limit, page, search } = parsed.data;
    const where: Prisma.ProductWhereInput = { isVisible: true, isArchived: false, referenceVerified: true, ...(categoryId ? { categoryId } : {}),
      ...(search ? { OR: ["name", "nameAr", "customDisplayName", "inspirationBrand", "inspirationFragrance"].map((field) => ({ [field]: { contains: search, mode: "insensitive" } })) } : {}) };
    const [products, total] = await Promise.all([
      client.product.findMany({ where, take: limit, skip: (page - 1) * limit, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: publicFields }),
      client.product.count({ where }),
    ]);
    response.json({ products, total, page, pageSize: limit });
  });
  router.get("/products/:id", async (request, response) => {
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success) { response.status(404).json({ error: "Product not found." }); return; }
    const product = await client.product.findFirst({ where: { id: id.data, isVisible: true, isArchived: false, referenceVerified: true }, select: publicFields });
    if (!product) { response.status(404).json({ error: "Product not found." }); return; }
    response.json({ product });
  });
  router.get("/categories", async (_request, response) => {
    const categories = await client.category.findMany({
      where: { products: { some: { isVisible: true, isArchived: false, referenceVerified: true } } }, orderBy: { name: "asc" }, select: { id: true, name: true },
    });
    response.json({ categories });
  });
  return router;
}
