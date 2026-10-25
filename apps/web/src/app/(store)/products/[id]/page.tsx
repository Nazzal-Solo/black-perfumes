import { cache } from "react";
import { cookies } from "next/headers";
import { publicMetadata } from "@/lib/metadata";
import { productName } from "@/lib/catalog";
import { z } from "zod";
import { notFound } from "next/navigation";
import { getPublicProduct } from "@/lib/catalog";
import { CatalogNotice, ProductDetails } from "@/components/product-details";

const readProduct = cache(getPublicProduct);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let product;
  if (z.uuid().safeParse(id).success) {
    try { product = await readProduct(id); } catch { /* Render the existing unavailable state. */ }
  }
  if (!product) return { title: "Fragrance unavailable | Berfumes Black", robots: { index: false, follow: false } };
  const locale = (await cookies()).get("bp_locale")?.value === "ar" ? "ar" : "en";
  return publicMetadata("product", `/products/${id}`, productName(product, locale));
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  let product;
  try { product = await readProduct(id); }
  catch { return <CatalogNotice />; }
  if (!product) notFound();
  return <ProductDetails key={product.id} product={product} />;
}
