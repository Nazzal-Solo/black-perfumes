import { z } from "zod";
import { getCategories, getCatalogPage } from "@/lib/catalog";
import { PublicCollection } from "@/components/public-collection";

export default async function CollectionPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const query = await searchParams;
  const category = z.uuid().safeParse(query.category);
  const selected = category.success ? category.data : undefined;
  const [products, categories] = await Promise.allSettled([getCatalogPage(selected, undefined, 24), getCategories()]);
  return <PublicCollection key={selected ?? "all"} full initialTotal={products.status === "fulfilled" ? products.value.total : 0} initialCategory={selected} initialProducts={products.status === "fulfilled" ? products.value.products : []} categories={categories.status === "fulfilled" ? categories.value : []} unavailable={products.status === "rejected"} categoriesUnavailable={categories.status === "rejected"} />;
}
