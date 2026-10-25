"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { FlaskConical, Mars, Venus } from "lucide-react";
import logo from "../../public/Berfumes Black_logo.png";

export function BrandedPlaceholder({ label, category = "" }: { label: string; category?: string }) {
  const t = useTranslations();
  const normalized = category.toLowerCase().trim();
  const variant = ["women", "نسائي", "نساء"].includes(normalized) ? "women" : ["men", "رجالي", "رجال"].includes(normalized) ? "men" : "neutral";
  const Icon = variant === "women" ? Venus : variant === "men" ? Mars : FlaskConical;
  return <span className={"branded-placeholder placeholder-" + variant}>
    <span className="placeholder-orbit" aria-hidden="true" />
    <span className="placeholder-collection">{variant === "neutral" ? t("collection") : t(variant)}</span>
    <span className="placeholder-mark" aria-hidden="true"><Icon size={30} strokeWidth={1.15} /></span>
    <Image src={logo} alt="Berfumes Black" width={300} height={150} />
    <span className="placeholder-reference">{t("referenceLabel")}</span><span className="placeholder-caption">{label}</span>
  </span>;
}
