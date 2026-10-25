"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { Archive, ArrowUpRight, ChevronLeft, ChevronRight, CircleCheck, ClipboardList, FlaskConical, FolderOpen, LayoutDashboard, LogOut, Menu, Package, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, Search, ShieldCheck, TriangleAlert, X } from "lucide-react";
import logo from "../../../public/Berfumes Black_logo.png";
import { adminApi, ApiError, type AdminSession, type Category, type Product, type ProductList } from "@/lib/admin-api";
import { catalogSummary, filterCatalog, isPublished, needsReview } from "@/lib/admin-view";
import { useAdminText } from "@/i18n/admin-copy";
import { ProductForm, type ProductFormHandle } from "@/components/admin/product-form";
import { AdminDialog, useAdminUi } from "@/components/admin/admin-ui";
import { CloudinaryImage } from "@/components/admin/cloudinary-image";
import { CategoryManager } from "@/components/admin/category-manager";
import { LanguageSwitcher } from "@/components/public-locale";
import { Card } from "@/components/ui/card";

const initialFilters = { search: "", categoryId: "", visibility: "all", page: 1 };
const pageSize = 12;
export default function AdminDashboard() {
  const router = useRouter();
  const locale = useLocale();
  const t = useAdminText();
  const { toast, confirm } = useAdminUi();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [sessionRetry, setSessionRetry] = useState(0);
  const [tab, setTab] = useState<"products" | "categories">("products");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filters, setFilters] = useState(initialFilters);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Product | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const editorRef = useRef<ProductFormHandle>(null);
  const imagesChanged = useRef(false);
  const signedIn = session !== null;
  const expired = useCallback(() => {
    setSession(null); setProducts([]); setCategories([]); setEditor(null); setChecking(true);
    router.replace("/admin/login?expired=1");
  }, [router]);
  const report = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) { expired(); return; }
    setError(error instanceof Error ? error.message : "Unable to load your collection.");
  }, [expired]);
  useEffect(() => {
    const controller = new AbortController();
    adminApi<AdminSession>("/session", { signal: controller.signal }).then(value => { setSession(value); setChecking(false); }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) { expired(); return; }
      setSessionError(error instanceof Error ? error.message : "Unable to check your session."); setChecking(false);
    });
    return () => controller.abort();
  }, [expired, sessionRetry]);
  useEffect(() => {
    if (!session) return;
    const timeout = setTimeout(expired, Math.max(0, new Date(session.expiresAt).getTime() - Date.now()));
    const checkSession = () => { adminApi<AdminSession>("/session").then(setSession).catch((error: unknown) => { if (error instanceof ApiError && error.status === 401) expired(); }); };
    window.addEventListener("focus", checkSession);
    return () => { clearTimeout(timeout); window.removeEventListener("focus", checkSession); };
  }, [session, expired]);
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    async function load() {
      const [first, categoryData] = await Promise.all([
        adminApi<ProductList>("/products?visibility=all&pageSize=50&page=1", { signal: controller.signal }),
        adminApi<{ categories: Category[] }>("/categories", { signal: controller.signal }),
      ]);
      const pages = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / first.pageSize) - 1) }, (_, index) => adminApi<ProductList>(`/products?visibility=all&pageSize=50&page=${index + 2}`, { signal: controller.signal })));
      if (!controller.signal.aborted) { setProducts([...first.products, ...pages.flatMap(page => page.products)]); setCategories(categoryData.categories); }
    }
    load().catch(error => { if (!controller.signal.aborted) report(error); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [signedIn, refresh, report]);
  function reload() { setLoading(true); setError(""); setRefresh(value => value + 1); }
  function navigate(visibility = "all", section: "products" | "categories" = "products") { setTab(section); setFilters({ ...initialFilters, visibility }); setMobileNav(false); }
  function updateProduct(product: Product) { setProducts(previous => previous.some(item => item.id === product.id) ? previous.map(item => item.id === product.id ? product : item) : [product, ...previous]); }
  async function closeEditor() {
    const current = editor; setEditor(null);
    if (imagesChanged.current && current && current !== "new") {
      imagesChanged.current = false;
      try { const result = await adminApi<{ product: Product }>(`/products/${current.id}`); updateProduct(result.product); } catch (error) { report(error); }
    }
  }
  function openEditor(product: Product | "new") { imagesChanged.current = false; setEditor(product); }
  async function logout() {
    if (busy) return;
    setBusy(true); setError("");
    try { await adminApi("/logout", { method: "POST" }); expired(); }
    catch (error) { report(error); setBusy(false); }
  }
  async function archive(product: Product) {
    if (busy || !await confirm({ title: product.isArchived ? "Restore product?" : "Archive product?", body: `${product.name}\n${t("Product data and images will be preserved. Restored products remain unpublished.")}`, confirmText: product.isArchived ? "Restore" : "Archive", danger: !product.isArchived })) return;
    setBusy(true);
    try { const result = await adminApi<{ product: Product }>(`/products/${product.id}/archive`, { method: "POST", body: { archived: !product.isArchived } }); updateProduct(result.product); toast(product.isArchived ? "Product restored as draft." : "Product archived."); }
    catch (error) { report(error); toast(error instanceof Error ? error.message : "Unable to save product.", true); }
    finally { setBusy(false); }
  }
  if (checking || !session) return <main id="main" className="admin-session-screen"><ShieldCheck size={36} /><h1>{t("Private workspace")}</h1>{sessionError ? <><p className="admin-error" role="alert">{t(sessionError)}</p><button className="admin-button primary" onClick={() => { setChecking(true); setSessionError(""); setSessionRetry(value => value + 1); }}>{t("Retry")}</button><Link href="/admin/login" className="admin-button">{t("Go to sign in")}</Link></> : <p role="status" className="admin-muted">{t("Checking your session…")}</p>}</main>;
  const summary = catalogSummary(products);
  const matching = filterCatalog(products, filters);
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(filters.page, pages);
  const visible = matching.slice((page - 1) * pageSize, page * pageSize);
  const filtered = !!filters.search || !!filters.categoryId || filters.visibility !== "all";
  const jod = new Intl.NumberFormat(locale === "ar" ? "ar-JO" : "en-JO", { style: "currency", currency: "JOD", minimumFractionDigits: 3 });
  const navItems = [{ label: "Products", icon: Package, visibility: "all" }, { label: "Review queue", icon: TriangleAlert, visibility: "review" }, { label: "Categories", icon: FolderOpen, section: "categories" }, { label: "Archived", icon: Archive, visibility: "archived" }] as const;
  const sidebar = <><Link href="/" className="admin-brand" aria-label="Berfumes Black"><Image src={logo} alt="Berfumes Black" width={154} height={84} priority /></Link><div className="sidebar-label"><span>{t("Workspace")}</span><ShieldCheck size={14} /></div><nav aria-label={t("Workspace")}>{navItems.map(item => { const section = "section" in item ? item.section : "products"; const visibility = "visibility" in item ? item.visibility : "all"; const active = tab === section && (section === "categories" || filters.visibility === visibility); return <button key={item.label} type="button" title={t(item.label)} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => navigate(visibility, section)}><item.icon size={20} /><span>{t(item.label)}</span>{item.label === "Review queue" && !loading && <b>{summary.review}</b>}</button>; })}</nav><div className="sidebar-bottom"><div className="admin-account"><span className="account-avatar">{session.admin.email.slice(0, 1).toUpperCase()}</span><div><strong>{t("Administrator")}</strong><p title={session.admin.email}>{session.admin.email}</p></div></div><button className="admin-button quiet" title={t("Sign out")} disabled={busy} onClick={() => void logout()}><LogOut size={18} /><span>{t(busy ? "Working…" : "Sign out")}</span></button></div></>;
  return <main id="main" className={`admin-dashboard ${collapsed ? "sidebar-collapsed" : ""}`}>
    <aside className="admin-sidebar">{sidebar}</aside>
    <AdminDialog open={mobileNav} title={t("Workspace")} onClose={() => setMobileNav(false)} className="admin-mobile-nav"><button className="admin-icon-button mobile-nav-close" aria-label={t("Close navigation")} onClick={() => setMobileNav(false)}><X size={22} /></button>{sidebar}</AdminDialog>
    <div className="admin-content"><header className="admin-topbar"><div className="topbar-leading"><button className="admin-icon-button desktop-toggle" aria-label={t(collapsed ? "Expand sidebar" : "Collapse sidebar")} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</button><button className="admin-icon-button mobile-toggle" aria-label={t("Open navigation")} aria-expanded={mobileNav} onClick={() => setMobileNav(true)}><Menu size={22} /></button><p>{t("Workspace")}<span>/</span><strong>{t(tab === "categories" ? "Categories" : filters.visibility === "review" ? "Review queue" : filters.visibility === "archived" ? "Archived" : "Products")}</strong></p></div><div className="topbar-trailing"><LanguageSwitcher /><Link href="/" className="admin-button quiet"><span>{t("View site")}</span><ArrowUpRight size={17} /></Link></div></header>
      <div className="admin-content-inner"><div className="dashboard-heading"><div><p className="admin-eyebrow"><LayoutDashboard size={14} />{t("Catalog")}</p><h1>{t(tab === "products" ? "Your collection, considered." : "Organize your collection")}</h1><p className="admin-muted">{t(tab === "products" ? "Manage fragrances, imagery, and the details that matter." : "Create and refine the categories behind your fragrances.")}</p></div>{tab === "products" && <button className="admin-button primary" disabled={loading || busy} onClick={() => categories.length ? openEditor("new") : navigate("all", "categories")}><Plus size={18} />{t(categories.length ? "Add product" : "Create category")}</button>}</div>
      <section className="admin-stats" aria-label={t("Overview")}>{[{ label: "Total products", help: "All products", value: summary.total, visibility: "all", icon: Package }, { label: "Published", help: "Published references", value: summary.published, visibility: "visible", icon: CircleCheck }, { label: "Drafts", help: "Unpublished references", value: summary.drafts, visibility: "hidden", icon: ClipboardList }, { label: "Needs review", help: "Reference verification required", value: summary.review, visibility: "review", icon: TriangleAlert }].map(({ label, help, value, visibility, icon: Icon }) => <Card key={label} className={`admin-stat ${filters.visibility === visibility && tab === "products" ? "selected" : ""}`}><button onClick={() => navigate(visibility)} aria-pressed={filters.visibility === visibility && tab === "products"}><div><span>{t(label)}</span><Icon size={20} /></div><strong>{loading ? <span className="admin-skeleton stat-skeleton" /> : value.toLocaleString(locale)}</strong><small>{t(help)}</small></button></Card>)}</section>
      {error && <div className="admin-error" role="alert">{t(error)}<button className="admin-button" onClick={() => reload()}><RefreshCw size={16} />{t("Retry")}</button></div>}
      {tab === "categories" ? loading ? <div className="admin-skeleton category-skeleton" role="status" aria-label={t("Loading collection…")} /> : <CategoryManager categories={categories.map(category => ({ ...category, _count: { products: products.filter(product => product.categoryId === category.id).length } }))} onExpired={expired} onChanged={() => reload()} /> : <section className="collection-panel" aria-label={t("Products")}>
        <div className="section-heading"><div><h2>{t(filters.visibility === "review" ? "Review queue" : filters.visibility === "archived" ? "Archived" : "Products")}</h2><p className="admin-muted">{t(filters.visibility === "review" ? "Review reference identity before publishing." : "Leave unknown details blank. Publishing a reference does not confirm inventory.")}</p></div><button className="admin-icon-button" aria-label={t("Refresh")} disabled={loading} onClick={() => reload()}><RefreshCw size={18} /></button></div>
        <div className="collection-filters"><label className="search-field"><Search size={18} /><span className="sr-only">{t("Search products")}</span><input type="search" maxLength={200} placeholder={t("Search names, brands, or catalog references…")} value={filters.search} onChange={event => setFilters(previous => ({ ...previous, search: event.target.value, page: 1 }))} /></label><label><span className="sr-only">{t("Category")}</span><select value={filters.categoryId} onChange={event => setFilters(previous => ({ ...previous, categoryId: event.target.value, page: 1 }))}><option value="">{t("All categories")}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label><span className="sr-only">{t("Status")}</span><select value={filters.visibility} onChange={event => setFilters(previous => ({ ...previous, visibility: event.target.value, page: 1 }))}>{[["all", "All statuses"], ["visible", "Published"], ["hidden", "Drafts"], ["review", "Needs review"], ["archived", "Archived"]].map(([value, label]) => <option key={value} value={value}>{t(label!)}</option>)}</select></label>{filtered && <button className="admin-icon-button" aria-label={t("Clear filters")} onClick={() => setFilters(initialFilters)}><X size={18} /></button>}</div>
        <div aria-busy={loading}>{loading ? <div className="table-skeleton" role="status" aria-label={t("Loading collection…")}>{Array.from({ length: 6 }, (_, i) => <div key={i}><span className="admin-skeleton thumb-skeleton" /><span className="admin-skeleton line-skeleton" /><span className="admin-skeleton badge-skeleton" /></div>)}</div> : !visible.length ? <div className="admin-empty"><FlaskConical size={34} /><h3>{t(error ? "Collection unavailable" : filters.visibility === "review" ? "No review cases" : filtered ? "No products match" : "Your collection starts here")}</h3><p>{t(error ? "Try loading the collection again." : filters.visibility === "review" ? "Every active reference has been verified." : filtered ? "Try another search or clear your filters." : "Create a category, then add your first product.")}</p>{filtered && <button className="admin-button" onClick={() => setFilters(initialFilters)}>{t("Clear filters")}</button>}</div> : <div className="product-table-wrap"><table className="product-table"><thead><tr>{["Product", "Category", "Price", "Status", "Actions"].map(label => <th key={label} scope="col">{t(label)}</th>)}</tr></thead><tbody>{visible.map(product => <tr key={product.id}><td><div className="product-identity"><button className="thumbnail-button" aria-label={`${t("Edit")} ${product.name}`} onClick={() => openEditor(product)}>{product.images[0] ? <CloudinaryImage className="product-thumbnail" url={product.images[0].url} alt={product.images[0].altText || product.name} sizes="56px" /> : <span className="product-monogram"><FlaskConical size={23} /></span>}</button><div><button className="product-name" onClick={() => openEditor(product)}>{locale === "ar" && product.nameAr ? product.nameAr : product.customDisplayName || product.name}</button><p dir="auto">{product.catalogReferences.join(" · ") || product.inspirationBrand || t("No images")}</p></div></div></td><td data-label={t("Category")}><span className="category-tag">{product.category.name}</span></td><td data-label={t("Price")} className="product-price">{product.priceJod === null ? <span className="admin-muted">{t("Not set")}</span> : jod.format(Number(product.priceJod))}</td><td data-label={t("Status")}><div className="status-stack"><span className={`status-pill ${isPublished(product) ? "published" : product.isArchived ? "archived" : "draft"}`}><i />{t(product.isArchived ? "Archived" : isPublished(product) ? "Published" : "Draft")}</span>{needsReview(product) && <span className="review-label"><TriangleAlert size={13} />{t("Needs review")}</span>}</div></td><td className="product-actions"><button className="admin-icon-button" aria-label={`${t("Edit")} ${product.name}`} title={t("Edit")} disabled={busy} onClick={() => openEditor(product)}><Pencil size={17} /></button><button className="admin-icon-button" aria-label={`${t(product.isArchived ? "Restore" : "Archive")} ${product.name}`} title={t(product.isArchived ? "Restore" : "Archive")} disabled={busy} onClick={() => void archive(product)}>{product.isArchived ? <RefreshCw size={17} /> : <Archive size={17} />}</button></td></tr>)}</tbody></table></div>}</div>
        {!loading && !!matching.length && <div className="pagination"><p>{((page - 1) * pageSize + 1).toLocaleString(locale)}–{Math.min(page * pageSize, matching.length).toLocaleString(locale)} / {matching.length.toLocaleString(locale)}</p><div><button className="admin-button" disabled={page <= 1} onClick={() => setFilters(previous => ({ ...previous, page: page - 1 }))}><ChevronLeft size={16} className="directional-icon" />{t("Previous")}</button><span className="page-number">{page.toLocaleString(locale)} / {pages.toLocaleString(locale)}</span><button className="admin-button" disabled={page >= pages} onClick={() => setFilters(previous => ({ ...previous, page: page + 1 }))}>{t("Next")}<ChevronRight size={16} className="directional-icon" /></button></div></div>}
      </section>}
      <footer className="admin-content-footer"><span><ShieldCheck size={14} />{t("Private workspace")}</span><span>Berfumes Black</span></footer></div>
    </div>
    <AdminDialog open={!!editor} title={t(editor === "new" ? "New product" : "Edit product")} onClose={() => editorRef.current?.requestClose()} className="product-dialog">{editor && <ProductForm ref={editorRef} product={editor === "new" ? null : editor} categories={categories} onCancel={() => void closeEditor()} onExpired={expired} onImagesChanged={() => { imagesChanged.current = true; }} onSaved={saved => { updateProduct(saved); setEditor(saved); }} />}</AdminDialog>
  </main>;
}
