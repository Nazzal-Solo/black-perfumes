import { z } from "zod";
import { notFound } from "next/navigation";
import { getPublicProduct } from "@/lib/catalog";
import { CatalogNotice, ProductDetails } from "@/components/product-details";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  let product;
  try { product = await getPublicProduct(id); }
  catch { return <CatalogNotice />; }
  if (!product) notFound();
  return <ProductDetails key={product.id} product={product} />;
}
