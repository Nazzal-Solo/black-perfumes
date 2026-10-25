"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, Droplets, FlaskConical, Mars, RefreshCw, Venus } from "lucide-react";
import { getCatalogPage, productName, productDescription, type PublicCategory, type PublicProduct } from "@/lib/catalog";
import { BrandedPlaceholder } from "@/components/branded-placeholder";
import { FragranceImage } from "@/components/fragrance-image";

export function CollectionSkeleton({ section = false }: { section?: boolean }) {
  const t = useTranslations();
  const grid = <div className="fragrance-grid skeleton-grid" role="status" aria-label={t("loading")}><span className="sr-only">{t("loading")}</span>{[0, 1, 2].map((id) => <div className="skeleton-card" key={id} aria-hidden="true"><div className="skeleton-art" /><div className="skeleton-line" /><div className="skeleton-line short" /></div>)}</div>;
  return section ? <section id="collection" className="home-section collection-section"><CollectionHeading />{grid}</section> : grid;
}

function CollectionHeading({ page = false }: { page?: boolean }) {
  const t = useTranslations();
  const Heading = page ? "h1" : "h2";
  return <div className="section-heading"><div><p className="eyebrow">{t("collectionEyebrow")}</p><Heading id="collection-title">{t("collectionTitle")} <em>{t("collectionAccent")}</em></Heading></div><p>{t("collectionIntro")}</p></div>;
}

export function PublicCollection({ initialProducts, categories, unavailable, categoriesUnavailable, full = false, initialCategory = "", initialTotal = initialProducts.length }: {
  initialProducts: PublicProduct[]; categories: PublicCategory[]; unavailable: boolean; categoriesUnavailable: boolean; full?: boolean; initialCategory?: string; initialTotal?: number;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [products, setProducts] = useState(initialProducts);
  const [active, setActive] = useState(initialCategory);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialTotal);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(unavailable);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function select(id: string, nextPage = 1, query = search) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setActive(id); setPage(nextPage); setSearch(query); setLoading(true); setError(false); setProducts([]);
    try { const result = await getCatalogPage(id || undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]), full ? 24 : 6, nextPage, query); if (!controller.signal.aborted) { setProducts(result.products); setTotal(result.total); } }
    catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  const match = (names: string[]) => categories.find((item) => names.includes(item.name.toLowerCase().replace(/[’']/g, "").trim()));
  const entries = [
    { label: t("forHim"), title: t("men"), kind: "men", category: match(["men", "mens", "for men", "male", "رجال", "رجالي", "عطور رجالية", "عطور رجالي"]) },
    { label: t("forHer"), title: t("women"), kind: "women", category: match(["women", "womens", "for women", "female", "نساء", "نسائي", "عطور نسائية", "عطور نسائي"]) },
  ];
  const displayCategory = (item: PublicCategory) => {
    if (entries[0]?.category?.id === item.id) return t("men");
    if (entries[1]?.category?.id === item.id) return t("women");
    return item.name;
  };
  return <>
    <section id="collection" className="home-section collection-section" aria-labelledby="collection-title">
      <CollectionHeading page={full} />
      {full && <form className="public-search" onSubmit={(event) => { event.preventDefault(); void select(active, 1, draft.trim()); }}><label className="sr-only" htmlFor="catalog-search">{t("searchLabel")}</label><input id="catalog-search" type="search" maxLength={200} placeholder={t("searchLabel")} value={draft} onChange={(event) => setDraft(event.target.value)} /><button type="submit">{t("searchButton")}</button></form>}
      <div className="collection-filters" aria-label={t("filterLabel")}><button type="button" aria-pressed={!active} onClick={() => void select("")}>{t("all")}</button>{categories.map((item) => <button type="button" key={item.id} aria-pressed={active === item.id} onClick={() => void select(item.id)}>{displayCategory(item)}</button>)}</div>
      <div aria-live="polite" aria-busy={loading}>
        {loading ? <CollectionSkeleton /> : error ? <div className="collection-message"><FlaskConical size={35} strokeWidth={1} /><h3>{t("errorTitle")}</h3><p>{t("errorText")}</p><button type="button" className="home-cta" onClick={() => void select(active, page)}>{t("retry")}<RefreshCw size={16} /></button></div>
          : products.length === 0 ? <div className="collection-message"><Droplets size={35} strokeWidth={1} /><p className="eyebrow">{t("emptyEyebrow")}</p><h3>{t("emptyTitle")}</h3><p>{t("emptyText")}</p></div>
          : <div className="fragrance-grid">{products.map((item) => <article className="fragrance-card" key={item.id}><Link className="fragrance-card-link" href={"/products/" + encodeURIComponent(item.id) + "?category=" + encodeURIComponent(item.category.id)} aria-label={t("viewProduct", { name: productName(item, locale) })}><div className="fragrance-art">{item.images[0] ? <FragranceImage category={item.category.name} url={item.images[0].url} alt={item.images[0].altText || productName(item, locale)} /> : <BrandedPlaceholder label={t("imageMissing")} category={item.category.name} />}</div><div className="fragrance-info"><p className="eyebrow" dir="auto">{displayCategory(item.category)}</p><div className="fragrance-title"><h3 dir="auto">{productName(item, locale)}</h3><span>{item.priceJod === null ? t("priceUnknown") : <>{new Intl.NumberFormat(locale === "ar" ? "ar-JO" : "en-JO", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(item.priceJod))} <small>{t("currency")}</small></>}</span></div><p className="product-identity-label">{t("referenceLabel")} · {t(item.productType)}</p>{item.availability && <p className="product-identity-label">{t(item.availability)}</p>}{productDescription(item, locale) && <p className="fragrance-description" dir="auto">{productDescription(item, locale)}</p>}</div></Link></article>)}</div>}
      </div>
    </section>
    {full && !error && total > 24 && <nav className="public-pagination" aria-label={t("collection")}><button type="button" disabled={loading || page <= 1} onClick={() => void select(active, page - 1)}>{t("previousPage")}</button><span aria-live="polite">{t("pageLabel", { page, pages: Math.ceil(total / 24) })}</span><button type="button" disabled={loading || page * 24 >= total} onClick={() => void select(active, page + 1)}>{t("nextPage")}</button></nav>}
    {!full && <section className="home-section collection-entries" aria-label={t("collectionsLabel")}>{entries.map((entry) => <a key={entry.kind} className={"collection-entry entry-" + entry.kind} href="#collection" onClick={(event) => { if (!entry.category) { event.preventDefault(); return; } void select(entry.category.id); }} aria-disabled={!entry.category} tabIndex={entry.category ? 0 : -1}><span className="entry-background" aria-hidden="true" /><span className="entry-orbit" aria-hidden="true" /><span className="entry-symbol" aria-hidden="true">{entry.kind === "men" ? <Mars size={88} strokeWidth={1.1} /> : <Venus size={88} strokeWidth={1.1} />}</span><div className="entry-copy"><p className="eyebrow">{entry.label}</p><h2>{entry.title}</h2><p>{categoriesUnavailable ? t("categoriesError") : entry.category ? t("exploreCategory") : t("categoryPending")}</p></div><span className="entry-arrow" aria-hidden="true"><ArrowUpRight size={25} strokeWidth={1.2} /></span></a>)}</section>}
  </>;
}
