import { adminApi, type Category, type ProductList } from "./admin-api";
export async function fetchAdminCatalog(signal: AbortSignal) {
  const [first, categoryData] = await Promise.all([
    adminApi<ProductList>("/products?visibility=all&pageSize=50&page=1", { signal }),
    adminApi<{ categories: Category[] }>("/categories", { signal }),
  ]);
  const pages = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / first.pageSize) - 1) }, (_, index) => adminApi<ProductList>(`/products?visibility=all&pageSize=50&page=${index + 2}`, { signal })));
  return { products: [...first.products, ...pages.flatMap(page => page.products)], categories: categoryData.categories };
}
