import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { AuthStore } from "../auth/store.js";
import { requireAdmin } from "../auth/routes.js";

export const ADMIN_JSON_LIMIT = "256kb";
const id = z.uuid();
const categoryInput = z.object({ name: z.string().trim().min(1, "Enter a category name.").max(120) }).strict();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
export const productInput = z.object({
  name: z.string().trim().min(1, "Enter a product name.").max(200),
  description: z.string().trim().max(5000),
  priceJod: z.string().regex(/^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/, "Enter a nonnegative JOD amount with up to 3 decimal places.").nullable(),
  inspirationBrand: optionalText(200), inspirationFragrance: optionalText(200),
  productType: z.enum(["UNCONFIRMED", "INSPIRED", "ORIGINAL", "OTHER"]).optional(),
  customDisplayName: optionalText(200), nameAr: optionalText(200), descriptionAr: optionalText(5000),
  disclosureText: optionalText(2000), disclosureAr: optionalText(2000),
  availability: z.enum(["AVAILABLE", "UNAVAILABLE"]).nullable().optional(),
  sizeMl: z.string().regex(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/).nullable().optional(),
  concentration: optionalText(120), fragranceNotes: optionalText(5000), fragranceNotesAr: optionalText(5000),
  referenceVerified: z.boolean().optional(), isArchived: z.boolean().optional(), catalogReferences: z.array(z.string().trim().min(1).max(30)).max(200).optional(),
  seasonalRecommendations: z.array(z.enum(["Summer", "Winter", "Spring", "Autumn"])).max(4).optional(),
  reviewNotes: optionalText(5000),
  categoryId: id,
  isVisible: z.boolean(),
}).strict();
const listInput = z.object({
  search: z.string().trim().max(200).default(""),
  categoryId: id.optional(),
  visibility: z.enum(["all", "visible", "hidden", "archived"]).default("all"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
}).strict();
const productRelations = { category: true, images: { orderBy: { position: "asc" }, take: 1 }, _count: { select: { images: true } } } as const;

export function createAdminRouter(client: Prisma.TransactionClient, store: AuthStore, options: { production: boolean; origins: string[] }) {
  const router = Router();
  router.use(requireAdmin(store, options));
  router.param("id", (_request, response, next, value: string) => {
    if (!id.safeParse(value).success) { response.status(400).json({ error: "Invalid identifier." }); return; }
    next();
  });

  router.get("/products", async (request, response) => {
    const parsed = listInput.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ error: "Invalid product filters." }); return; }
    const { search, categoryId, visibility, page, pageSize } = parsed.data;
    const where: Prisma.ProductWhereInput = {
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(visibility === "archived" ? { isArchived: true } : visibility !== "all" ? { isArchived: false, isVisible: visibility === "visible" } : {}),
    };
    const [products, total] = await Promise.all([
      client.product.findMany({ where, include: productRelations, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      client.product.count({ where }),
    ]);
    response.json({ products, total, page, pageSize });
  });

  router.get("/products/:id", async (request, response) => {
    const product = await client.product.findUnique({ where: { id: String(request.params.id) }, include: productRelations });
    if (!product) { response.status(404).json({ error: "Product not found." }); return; }
    response.json({ product });
  });

  router.post("/products", async (request, response) => {
    const parsed = productInput.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Check the product details.", fields: parsed.error.flatten().fieldErrors }); return; }
    if (parsed.data.isVisible && !parsed.data.isArchived && !parsed.data.referenceVerified) { response.status(400).json({ error: "Verify the fragrance reference before publishing.", fields: { referenceVerified: ["Reference verification is required for publication; this does not confirm authenticity or inventory."] } }); return; }
    const product = await client.product.create({ data: { ...parsed.data, ...(parsed.data.isArchived ? { isVisible: false } : {}) }, include: productRelations });
    response.status(201).json({ product });
  });

  router.put("/products/:id", async (request, response) => {
    const parsed = productInput.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Check the product details.", fields: parsed.error.flatten().fieldErrors }); return; }
    const current = await client.product.findUnique({ where: { id: String(request.params.id) }, select: { referenceVerified: true, isArchived: true } });
    if (!current) { response.status(404).json({ error: "Product not found." }); return; }
    const visible = parsed.data.isVisible && !(parsed.data.isArchived ?? current.isArchived);
    if (visible && !(parsed.data.referenceVerified ?? current.referenceVerified)) { response.status(400).json({ error: "Verify the fragrance reference before publishing.", fields: { referenceVerified: ["Reference verification is required for publication."] } }); return; }
    const product = await client.product.update({ where: { id: String(request.params.id) }, data: { ...parsed.data, isVisible: visible }, include: productRelations });
    response.json({ product });
  });

  router.post("/products/:id/archive", async (request, response) => {
    const parsed = z.object({ archived: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Invalid archive status." }); return; }
    const product = await client.product.update({ where: { id: String(request.params.id) }, data: { isArchived: parsed.data.archived, isVisible: false }, include: productRelations });
    response.json({ product });
  });

  router.delete("/products/:id", async (request, response) => {
    await client.product.update({ where: { id: String(request.params.id) }, data: { isArchived: true, isVisible: false } });
    response.status(204).end();
  });

  router.get("/categories", async (_request, response) => {
    const categories = await client.category.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], include: { _count: { select: { products: true } } } });
    response.json({ categories });
  });

  router.post("/categories", async (request, response) => {
    const parsed = categoryInput.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Check the category name.", fields: parsed.error.flatten().fieldErrors }); return; }
    const category = await client.category.create({ data: parsed.data });
    response.status(201).json({ category });
  });

  router.put("/categories/:id", async (request, response) => {
    const parsed = categoryInput.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Check the category name.", fields: parsed.error.flatten().fieldErrors }); return; }
    const category = await client.category.update({ where: { id: String(request.params.id) }, data: parsed.data });
    response.json({ category });
  });

  router.delete("/categories/:id", async (request, response) => {
    await client.category.delete({ where: { id: String(request.params.id) } });
    response.status(204).end();
  });

  const errors: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "P2025") response.status(404).json({ error: "This item no longer exists. Refresh the list." });
    else if (code === "P2002") response.status(409).json({ error: "A category with this name already exists.", fields: { name: ["Choose a different category name."] } });
    else if (code === "P2003") response.status(409).json({ error: "The category is missing or still contains products. Move its products before deleting it." });
    else next(error);
  };
  router.use(errors);
  return router;
}
