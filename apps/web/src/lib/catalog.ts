import { z } from "zod";
import { env } from "@/config/env";

const category = z.object({ id: z.string(), name: z.string() });
const product = z.object({
  id: z.string(), name: z.string(), description: z.string(), priceJod: z.string().nullable(), category,
  nameAr: z.string().nullable(), customDisplayName: z.string().nullable(), descriptionAr: z.string().nullable(),
  inspirationBrand: z.string().nullable(), inspirationFragrance: z.string().nullable(), productType: z.enum(["UNCONFIRMED", "INSPIRED", "ORIGINAL", "OTHER"]),
  disclosureText: z.string().nullable(), disclosureAr: z.string().nullable(), availability: z.enum(["AVAILABLE", "UNAVAILABLE"]).nullable(),
  sizeMl: z.string().nullable(), concentration: z.string().nullable(), fragranceNotes: z.string().nullable(), fragranceNotesAr: z.string().nullable(),
  images: z.array(z.object({ url: z.string(), altText: z.string() })),
});
export type PublicProduct = z.infer<typeof product>;
export type PublicCategory = z.infer<typeof category>;

async function read(path: string, signal?: AbortSignal) {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL.replace(/\/$/, "")}/api/${path}`, {
    cache: "no-store", credentials: "omit", signal: signal ?? AbortSignal.timeout(5000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The collection is temporarily unavailable.");
  return response.json() as Promise<unknown>;
}
export async function getCatalogPage(categoryId?: string, signal?: AbortSignal, limit = 6, page = 1, search = "") {
  const params = new URLSearchParams({ limit: String(limit), page: String(page) });
  if (categoryId) params.set("categoryId", categoryId);
  if (search) params.set("search", search);
  return z.object({ products: z.array(product), total: z.number(), page: z.number(), pageSize: z.number() }).parse(await read("products?" + params, signal));
}
export async function getProducts(categoryId?: string, signal?: AbortSignal, limit = 6) {
  return (await getCatalogPage(categoryId, signal, limit)).products;
}
export async function getPublicProduct(id: string) {
  const result = await read("products/" + encodeURIComponent(id));
  return result === null ? null : z.object({ product }).parse(result).product;
}
export function productName(item: PublicProduct, locale: string) { return (locale === "ar" ? item.nameAr : null) || item.customDisplayName || item.name; }
export function productDescription(item: PublicProduct, locale: string) { return (locale === "ar" ? item.descriptionAr : null) || item.description; }
export async function getCategories() {
  return z.object({ categories: z.array(category) }).parse(await read("categories")).categories;
}
export function fragranceImage(url: string, width: number) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    if (parsed.hostname === "res.cloudinary.com" && parsed.pathname.includes("/image/upload/")) {
      parsed.pathname = parsed.pathname.replace("/image/upload/", `/image/upload/f_auto,q_auto,c_limit,w_${width}/`);
    }
    return parsed.toString();
  } catch { return ""; }
}
