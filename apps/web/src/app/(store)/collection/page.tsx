import { publicMetadata } from "@/lib/metadata";
import { z } from "zod";
import { PublicCollection } from "@/components/public-collection";

export const generateMetadata = () => publicMetadata("collection", "/collection");

export default async function CollectionPage({ searchParams }: { searchParams: Promise<{ category?: string; collection?: string }> }) {
  const query = await searchParams;
  const category = z.uuid().safeParse(query.category);
  const selected = category.success ? category.data : undefined;
  const collection = query.collection === "men" || query.collection === "women" ? query.collection : undefined;
  return <PublicCollection key={selected ?? collection ?? "all"} full initialCategory={selected} initialCollection={selected ? undefined : collection} />;
}
