"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Droplets, RefreshCw } from "lucide-react";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { whatsappInquiryUrl } from "@/lib/contact";
import { BrandedPlaceholder } from "@/components/branded-placeholder";
import { FragranceImage } from "@/components/fragrance-image";
import { productName, productDescription, type PublicProduct } from "@/lib/catalog";

export function CatalogNotice({ missing = false }: { missing?: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  return <section className="home-section"><div className="collection-message"><Droplets size={35} strokeWidth={1} /><h1>{t(missing ? "productMissing" : "errorTitle")}</h1><p>{t(missing ? "productMissingText" : "errorText")}</p>{!missing && <button className="home-cta" type="button" onClick={() => router.refresh()}>{t("retry")}<RefreshCw size={16} /></button>}<Link className="text-link" href="/collection"><ArrowLeft size={16} />{t("backCollection")}</Link></div></section>;
}

export function ProductSkeleton() {
  const t = useTranslations();
  return <div className="home-section product-details product-skeleton" role="status" aria-label={t("productLoading")}><span className="sr-only">{t("productLoading")}</span><div className="skeleton-art" /><div aria-hidden="true"><div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line short" /></div></div>;
}

export function ProductDetails({ product }: { product: PublicProduct }) {
  const t = useTranslations();
  const locale = useLocale();
  const [selected, setSelected] = useState(0);
  const image = product.images[selected];
  const normalizedCategory = product.category.name.toLowerCase();
  const categoryLabel = normalizedCategory === "men" ? t("men") : normalizedCategory === "women" ? t("women") : product.category.name;
  const back = "/collection?category=" + encodeURIComponent(product.category.id);
  return <section className="home-section product-section"><Link className="text-link back-link" href={back}><ArrowLeft size={16} />{t("backCollection")}</Link><div className="product-details">
    <div className="product-gallery" role="group" aria-label={t("gallery")}><div className="product-primary">{image ? <FragranceImage category={product.category.name} key={image.url} hero url={image.url} alt={image.altText || productName(product, locale)} /> : <BrandedPlaceholder label={t("imageMissing")} category={product.category.name} />}</div>
      {product.images.length > 1 && <><div className="gallery-controls"><button className="icon-button" type="button" aria-label={t("previousImage")} onClick={() => setSelected((selected + product.images.length - 1) % product.images.length)}><ChevronLeft size={20} /></button><span aria-live="polite">{selected + 1} / {product.images.length}</span><button className="icon-button" type="button" aria-label={t("nextImage")} onClick={() => setSelected((selected + 1) % product.images.length)}><ChevronRight size={20} /></button></div><div className="product-thumbnails">{product.images.map((item, index) => <button key={item.url} type="button" aria-label={t("chooseImage", { number: index + 1 })} aria-pressed={selected === index} onClick={() => setSelected(index)}><FragranceImage category={product.category.name} url={item.url} alt="" /></button>)}</div></>}
    </div>
    <div className="product-copy"><Link className="eyebrow product-category" href={back} dir="auto">{categoryLabel}</Link><h1 dir="auto">{productName(product, locale)}</h1><p className="detail-price">{product.priceJod === null ? t("priceUnknown") : new Intl.NumberFormat(locale === "ar" ? "ar-JO" : "en-JO", { style: "currency", currency: "JOD" }).format(Number(product.priceJod))}</p><p className="product-identity-label">{t("referenceLabel")}</p><p className="product-identity-label">{t("identityLabel")}: {t(product.productType)}</p><p className="product-identity-label">{product.availability ? t(product.availability) : t("availabilityUnknown")}</p>{product.inspirationFragrance && <p className="detail-description">{t("inspiration")}: <bdi>{product.inspirationBrand} — {product.inspirationFragrance}</bdi></p>}<p className="identity-notice">{(locale === "ar" ? product.disclosureAr : product.disclosureText) || t("identityNotice")}</p>{product.sizeMl && <p>{t("sizeLabel")}: {product.sizeMl}</p>}{product.concentration && <p>{t("concentrationLabel")}: {product.concentration}</p>}{(locale === "ar" ? product.fragranceNotesAr || product.fragranceNotes : product.fragranceNotes) && <p className="detail-description">{t("notesLabel")}: {locale === "ar" ? product.fragranceNotesAr || product.fragranceNotes : product.fragranceNotes}</p>}<h2>{t("description")}</h2><p className="detail-description" dir="auto">{productDescription(product, locale) || t("noDescription")}</p><div className="product-contact-actions"><a className="home-cta" href={whatsappInquiryUrl(t("whatsappMessage", { name: productName(product, locale) }))} target="_blank" rel="noopener noreferrer"><WhatsAppIcon />{t("whatsappInquiry")}</a><a className="text-link" href="https://www.instagram.com/black_perfumes99/" target="_blank" rel="noopener noreferrer">{t("inquiry")}<ArrowUpRight size={18} /></a></div></div>
  </div></section>;
}
