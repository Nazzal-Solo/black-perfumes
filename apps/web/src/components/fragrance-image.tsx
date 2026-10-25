"use client";

import { BrandedPlaceholder } from "@/components/branded-placeholder";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { fragranceImage } from "@/lib/catalog";

export function FragranceImage({ url, alt, hero = false, category }: { url: string; alt: string; hero?: boolean; category?: string }) {
  const t = useTranslations();
  const [failedUrl, setFailedUrl] = useState("");
  const width = hero ? 1000 : 640;
  const src = fragranceImage(url, width);
  if (failedUrl === url || !src) return <BrandedPlaceholder label={t("imageError")} category={category} />;
  // Cloudinary already supplies optimized responsive sources; avoid a second optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={hero ? "hero-product" : undefined} src={src}
    srcSet={`${fragranceImage(url, hero ? 600 : 320)} ${hero ? 600 : 320}w, ${src} ${width}w`}
    sizes={hero ? "(max-width: 760px) 90vw, 50vw" : "(max-width: 380px) 88vw, (max-width: 760px) 42vw, 29vw"}
    width={width} height={hero ? 1100 : 720} loading={hero ? "eager" : "lazy"}
    fetchPriority={hero ? "high" : "auto"} alt={alt} onError={() => setFailedUrl(url)} />;
}
