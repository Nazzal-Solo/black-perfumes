"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { AdminSession, Category, Product } from "@/lib/admin-api";
import { fetchAdminCatalog } from "@/lib/admin-catalog";
type Catalog = { products: Product[]; categories: Category[]; loading: boolean; ready: boolean; setProducts: Dispatch<SetStateAction<Product[]>>; load: (session: AdminSession, force?: boolean) => Promise<void>; reset: () => void };
const Context = createContext<Catalog | null>(null);
export function AdminCatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]); const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true); const [ready, setReady] = useState(false);
  const identity = useRef(""); const loaded = useRef(false);
  const pending = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const reset = useCallback(() => {
    pending.current?.controller.abort(); pending.current = null; identity.current = ""; loaded.current = false;
    setProducts([]); setCategories([]); setReady(false); setLoading(true);
  }, []);
  const load = useCallback((session: AdminSession, force = false) => {
    const key = `${session.admin.id}:${session.expiresAt}`;
    if (identity.current !== key) { reset(); identity.current = key; }
    if (pending.current) return pending.current.promise;
    if (loaded.current && !force) return Promise.resolve();
    setLoading(true); const controller = new AbortController();
    const promise = fetchAdminCatalog(controller.signal).then(data => {
      if (controller.signal.aborted || identity.current !== key) return;
      setProducts(data.products); setCategories(data.categories); loaded.current = true; setReady(true);
    }).finally(() => {
      if (pending.current?.controller === controller) { pending.current = null; setLoading(false); }
    });
    pending.current = { controller, promise }; return promise;
  }, [reset]);
  useEffect(() => () => { pending.current?.controller.abort(); pending.current = null; }, []);
  return <Context.Provider value={{ products, categories, loading, ready, setProducts, load, reset }}>{children}</Context.Provider>;
}
export function useAdminCatalog() { const value = useContext(Context); if (!value) throw new Error("Admin catalog provider missing"); return value; }
