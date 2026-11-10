"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, Droplets, Mars, RefreshCw, Venus } from "lucide-react";
import { getCatalogPage, getCategories, productName, productDescription, type PublicCategory, type PublicProduct } from "@/lib/catalog";
import { BrandedPlaceholder } from "@/components/branded-placeholder";
import { FragranceImage } from "@/components/fragrance-image";
import { AppearanceCover } from "@/components/appearance/provider";

export function CollectionSkeleton({ section = false, full = false }: { section?: boolean; full?: boolean }) {
  const t = useTranslations();
  const grid = <div className="fragrance-grid skeleton-grid" role="status" aria-label={t("loading")}><span className="sr-only">{t("loading")}</span>{Array.from({ length: full ? 24 : 6 }, (_, id) => id).map((id) => <div className="skeleton-card" key={id} aria-hidden="true"><div className="skeleton-art" /><div className="skeleton-info"><div className="skeleton-line short" /><div className="skeleton-line" /><div className="skeleton-line short" /></div></div>)}</div>;
  return section ? <section id="collection" className="home-section collection-section"><CollectionHeading page={full} />{grid}</section> : grid;
}

function CollectionHeading({ page = false }: { page?: boolean }) {
  const t = useTranslations();
  const Heading = page ? "h1" : "h2";
  return <div className="section-heading"><div><p className="eyebrow">{t("collectionEyebrow")}</p><Heading id="collection-title">{t("collectionTitle")} <em>{t("collectionAccent")}</em></Heading></div><p>{t("collectionIntro")}</p></div>;
}

export function PublicCollection({ full = false, initialCategory = "", initialCollection }: {
  full?: boolean; initialCategory?: string; initialCollection?: "men" | "women" | "unisex";
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [query, setQuery] = useState({ category: initialCategory, collection: initialCollection, page: 1, search: "", retry: 0 });
  const [draft, setDraft] = useState("");
  const [categoryAttempt, setCategoryAttempt] = useState(0);
  const [categoryState, setCategoryState] = useState<{ attempt: number; items: PublicCategory[]; error: boolean }>({ attempt: -1, items: [], error: false });
  const [result, setResult] = useState<{ key: string; products: PublicProduct[]; total: number; error: boolean }>({ key: "", products: [], total: 0, error: false });
  const [skeletonKey, setSkeletonKey] = useState("");
  const categories = categoryState.items;
  const categoriesLoading = categoryState.attempt !== categoryAttempt;
  const categoriesUnavailable = !categoriesLoading && categoryState.error;
  const match = (names: string[]) => categories.find((item) => names.includes(item.name.toLowerCase().replace(/[’']/g, "").trim()));
  const entries = [
    { label: t("forHim"), title: t("men"), kind: "men", category: match(["men", "mens", "for men", "male", "رجال", "رجالي", "عطور رجالية", "عطور رجالي"]) },
    { label: t("forHer"), title: t("women"), kind: "women", category: match(["women", "womens", "for women", "female", "نساء", "نسائي", "عطور نسائية", "عطور نسائي"]) },
    { label: t("forEveryone"), title: t("unisex"), kind: "unisex", category: match(["unisex", "for everyone", "للجنسين", "مشترك", "عطور مشتركة"]) },
  ] as const;
  const resolvedCategory = entries.find(entry => entry.kind === query.collection)?.category;
  const active = query.collection ? resolvedCategory?.id ?? "" : query.category;
  const missingCollection = !!query.collection && !categoriesLoading && !categoriesUnavailable && !resolvedCategory;
  const blocked = !!query.collection && (categoriesLoading || categoriesUnavailable || !resolvedCategory);
  const key = JSON.stringify([active, query.page, query.search, query.retry]);
  const loading = !missingCollection && !(query.collection && categoriesUnavailable) && (blocked || result.key !== key);
  const error = !!(query.collection && categoriesUnavailable) || (!loading && !missingCollection && result.error);
  const products = missingCollection ? [] : result.products;
  const total = missingCollection ? 0 : result.total;
  const page = query.page;
  const showSkeleton = loading && (!products.length || skeletonKey === key);

  useEffect(() => {
    const controller = new AbortController();
    getCategories(controller.signal).then(items => {
      if (!controller.signal.aborted) setCategoryState({ attempt: categoryAttempt, items, error: false });
    }).catch(() => { if (!controller.signal.aborted) setCategoryState({ attempt: categoryAttempt, items: [], error: true }); });
    return () => controller.abort();
  }, [categoryAttempt]);
  useEffect(() => {
    if (blocked) return;
    const controller = new AbortController();
    getCatalogPage(active || undefined, controller.signal, full ? 24 : 6, query.page, query.search).then(data => {
      if (!controller.signal.aborted) setResult({ key, ...data, error: false });
    }).catch(() => { if (!controller.signal.aborted) setResult({ key, products: [], total: 0, error: true }); });
    return () => controller.abort();
  }, [active, blocked, full, key, query.page, query.search]);
  useEffect(() => {
    if (!loading || !products.length) return;
    const timer = setTimeout(() => setSkeletonKey(key), 150);
    return () => clearTimeout(timer);
  }, [key, loading, products.length]);
  function select(id: string, nextPage = 1) {
    if (id === active && nextPage === page && !query.collection && !error) return;
    setQuery(previous => ({ ...previous, category: id, collection: undefined, page: nextPage, retry: previous.retry + 1 }));
  }
  function retry() {
    setQuery(previous => ({ ...previous, retry: previous.retry + 1 }));
    if (categoriesUnavailable) setCategoryAttempt(previous => previous + 1);
  }
  const displayCategory = (item: PublicCategory) => {
    if (entries[0]?.category?.id === item.id) return t("men");
    if (entries[1]?.category?.id === item.id) return t("women");
    if (entries[2]?.category?.id === item.id) return t("unisex");
    return item.name;
  };
  return <>
    <section id="collection" className="home-section collection-section" aria-labelledby="collection-title">
      <CollectionHeading page={full} />
      {full && <form className="public-search" onSubmit={(event) => { event.preventDefault(); if (draft.trim() !== query.search || error) setQuery(previous => ({ ...previous, page: 1, search: draft.trim(), retry: previous.retry + 1 })); }}><label className="sr-only" htmlFor="catalog-search">{t("searchLabel")}</label><input id="catalog-search" type="search" maxLength={200} placeholder={t("searchLabel")} value={draft} onChange={(event) => setDraft(event.target.value)} /><button type="submit">{t("searchButton")}</button></form>}
      <div className="collection-filters" aria-label={t("filterLabel")}><button type="button" aria-pressed={!active} onClick={() => void select("")}>{t("all")}</button>{categories.map((item) => <button type="button" key={item.id} aria-pressed={active === item.id} onClick={() => void select(item.id)}>{displayCategory(item)}</button>)}</div>
      {categoriesLoading && <span className="sr-only" role="status">{t("loading")}</span>}
      {categoriesUnavailable && !query.collection && <div className="catalog-filter-status" role="status"><p>{t("categoriesError")}</p><button type="button" className="text-link" onClick={() => setCategoryAttempt(previous => previous + 1)}>{t("retry")}<RefreshCw size={16} /></button></div>}
      <div className="catalog-results" aria-live="polite" aria-busy={loading}>
        {loading && !showSkeleton && <span className="sr-only" role="status">{t("loading")}</span>}
        {showSkeleton ? <CollectionSkeleton full={full} /> : error ? <div className="collection-message"><Droplets size={35} strokeWidth={1} /><h3>{t("errorTitle")}</h3><p>{t("errorText")}</p><button type="button" className="home-cta" onClick={retry}>{t("retry")}<RefreshCw size={16} /></button></div>
          : products.length === 0 ? <div className="collection-message"><Droplets size={35} strokeWidth={1} /><p className="eyebrow">{t("emptyEyebrow")}</p><h3>{t("emptyTitle")}</h3><p>{t("emptyText")}</p></div>
          : <div className="fragrance-grid">{products.map((item) => <article className="fragrance-card" key={item.id}><Link className="fragrance-card-link" href={"/products/" + encodeURIComponent(item.id) + "?category=" + encodeURIComponent(item.category.id)} aria-label={t("viewProduct", { name: productName(item, locale) })}><div className="fragrance-art">{item.images[0] ? <FragranceImage category={item.category.name} url={item.images[0].url} alt={item.images[0].altText || productName(item, locale)} /> : <BrandedPlaceholder label={t("imageMissing")} category={item.category.name} />}</div><div className="fragrance-info"><p className="eyebrow" dir="auto">{displayCategory(item.category)}</p><div className="fragrance-title"><h3 dir="auto">{productName(item, locale)}</h3><span>{item.priceJod === null ? t("priceUnknown") : <>{new Intl.NumberFormat(locale === "ar" ? "ar-JO" : "en-JO", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(item.priceJod))} <small>{t("currency")}</small></>}</span></div><p className="product-identity-label">{t("referenceLabel")} · {t(item.productType)}</p>{item.availability && <p className="product-identity-label">{t(item.availability)}</p>}{productDescription(item, locale) && <p className="fragrance-description" dir="auto">{productDescription(item, locale)}</p>}</div></Link></article>)}</div>}
      </div>
    </section>
    {full && !error && total > 24 && <nav className="public-pagination" aria-label={t("collection")}><button type="button" disabled={loading || page <= 1} onClick={() => void select(active, page - 1)}>{t("previousPage")}</button><span aria-live="polite">{t("pageLabel", { page, pages: Math.ceil(total / 24) })}</span><button type="button" disabled={loading || page * 24 >= total} onClick={() => void select(active, page + 1)}>{t("nextPage")}</button></nav>}
    {!full && <section className="home-section collection-entries" aria-label={t("collectionsLabel")}>{entries.filter(entry => entry.kind !== "unisex" || !!entry.category).map((entry) => <Link key={entry.kind} className={"collection-entry entry-" + entry.kind} href={entry.category ? "/collection?category=" + encodeURIComponent(entry.category.id) : "/collection?collection=" + entry.kind}><AppearanceCover slot={entry.kind} /><span className="entry-symbol" aria-hidden="true">{entry.kind === "men" ? <Mars size={88} strokeWidth={1.1} /> : entry.kind === "women" ? <Venus size={88} strokeWidth={1.1} /> : <Droplets size={88} strokeWidth={1.1} />}</span><div className="entry-copy"><p className="eyebrow">{entry.label}</p><h2>{entry.title}</h2><p>{t("exploreCategory")}</p></div><span className="entry-arrow" aria-hidden="true"><ArrowUpRight size={25} strokeWidth={1.2} /></span></Link>)}</section>}
  </>;
}
