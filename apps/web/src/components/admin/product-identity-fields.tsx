"use client";

import { useAdminText } from "@/i18n/admin-copy";
import type { Product } from "@/lib/admin-api";

export function ProductIdentityFields({ product }: { product: Product | null }) {
  const t = useAdminText();
  const fields = [["inspirationBrand", "Inspiration brand"], ["inspirationFragrance", "Inspiration fragrance name"]] as const;
  const textareas = [["disclosureText", "Disclosure (English)"], ["disclosureAr", "Disclosure (Arabic)"], ["fragranceNotes", "Fragrance notes"], ["fragranceNotesAr", "Arabic fragrance notes"], ["reviewNotes", "Internal review notes"]] as const;
  return <>
    <label>{t("Product identity")}<select name="productType" defaultValue={product?.productType ?? "UNCONFIRMED"}>{(["UNCONFIRMED", "INSPIRED", "ORIGINAL", "OTHER"] as const).map((value, index) => <option key={value} value={value}>{t(["Unconfirmed", "Inspired", "Original", "Other"][index]!)}</option>)}</select></label>
    <div className="form-columns">{fields.map(([name, label]) => <label key={name}>{t(label)}<input name={name} maxLength={200} defaultValue={product?.[name] ?? ""} /></label>)}</div>
    <div className="form-columns">{textareas.map(([name, label]) => <label key={name} className={name === "reviewNotes" ? "full-width" : ""}>{t(label)}<textarea name={name} rows={3} maxLength={name.startsWith("disclosure") ? 2000 : 5000} dir={name.endsWith("Ar") ? "rtl" : undefined} defaultValue={product?.[name] ?? ""} /></label>)}</div>
    <label>{t("Original catalog references")}<input name="catalogReferences" defaultValue={product?.catalogReferences.join(", ") ?? ""} /><small>{t("Separate references with commas.")}</small></label>
    <fieldset className="season-options"><legend>{t("Seasonal recommendations")}</legend>{["Summer", "Winter", "Spring", "Autumn"].map(season => <label key={season}><input type="checkbox" name="seasonalRecommendations" value={season} defaultChecked={product?.seasonalRecommendations.includes(season)} />{t(season)}</label>)}</fieldset>
    <label className="visibility-choice"><input type="checkbox" name="referenceVerified" defaultChecked={product?.referenceVerified ?? false} /><span>{t("Fragrance reference identity verified")}<small>{t("Resolve reference-name and merge concerns first. This does not confirm product authenticity or inventory.")}</small></span></label>
    <label className="visibility-choice"><input type="checkbox" name="isArchived" defaultChecked={product?.isArchived ?? false} /><span>{t("Keep archived")}<small>{t("Archived products are never shown publicly.")}</small></span></label>
  </>;
}
