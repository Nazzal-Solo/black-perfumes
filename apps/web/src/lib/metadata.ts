import type { Metadata } from "next";
import { cookies } from "next/headers";

export async function publicMetadata(page: "home" | "collection" | "about" | "product", path: string, name?: string): Promise<Metadata> {
  const ar = (await cookies()).get("bp_locale")?.value === "ar";
  const title = name ? `${name} | Berfumes Black` : page === "collection" ? (ar ? "مجموعة العطور | Berfumes Black" : "Fragrance Collection | Berfumes Black") : page === "about" ? (ar ? "عن Berfumes Black | كيمياء العطر" : "About Berfumes Black | The Chemistry of Scent") : "Berfumes Black | Find Your Signature Scent";
  const description = name ? (ar ? `تعرّف على المرجع العطري ${name} في كتالوج Berfumes Black. استفسر عن التفاصيل والسعر والتوفر عبر واتساب أو إنستغرام.` : `Explore the ${name} fragrance reference in the Berfumes Black catalog. Inquire about details, pricing and availability on WhatsApp or Instagram.`) : ar ? "اكتشف مراجع العطور الرجالية والنسائية في Berfumes Black، واستفسر عن التفاصيل والسعر والتوفر عبر واتساب أو إنستغرام." : "Explore men's and women's fragrance references at Berfumes Black. Inquire about details, pricing and availability on WhatsApp or Instagram.";
  const origin = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || "https://black-perfumes.netlify.app";
  const metadataBase = origin ? new URL(origin) : undefined;
  const image = "/Berfumes%20Black_Hero.jpg";
  return {
    title: { absolute: title }, description, ...(metadataBase ? { metadataBase, alternates: { canonical: path } } : {}),
    openGraph: { title, description, siteName: "Berfumes Black", type: "website", locale: ar ? "ar_JO" : "en_JO", alternateLocale: ar ? "en_JO" : "ar_JO", ...(metadataBase ? { url: path, images: [{ url: image, alt: "Berfumes Black — cinematic emerald perfume laboratory" }] } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(metadataBase ? { images: [image] } : {}) },
  };
}
