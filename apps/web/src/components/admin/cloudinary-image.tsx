"use client";

import { useState } from "react";
import { useAdminText } from "@/i18n/admin-copy";

export function optimizedImage(url: string, width: number) {
  if (!URL.canParse(url)) return "";
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com" || !parsed.pathname.includes("/image/upload/")) return "";
  parsed.pathname = parsed.pathname.replace("/image/upload/", `/image/upload/f_auto,q_auto,c_limit,w_${width}/`);
  return parsed.toString();
}

export function CloudinaryImage({ url, alt, sizes, className }: { url: string; alt: string; sizes: string; className?: string }) {
  const t = useAdminText();
  const [failedUrl, setFailedUrl] = useState("");
  const src = optimizedImage(url, 640);
  if (!src || failedUrl === url) return <span className={`image-unavailable ${className ?? ""}`} role="img" aria-label={alt}>{t("Image unavailable")}</span>;
  // Cloudinary already supplies optimized responsive sources; avoid a second optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} srcSet={[160, 320, 640, 960].map((width) => `${optimizedImage(url, width)} ${width}w`).join(", ")} sizes={sizes} alt={alt} width={640} height={640} loading="lazy" decoding="async" onError={() => setFailedUrl(url)} />;
}
