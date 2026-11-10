import type { Metadata } from "next";
import { cookies } from "next/headers";

export async function publicMetadata(page: "home" | "collection" | "about" | "product", path: string, name?: string): Promise<Metadata> {
  const ar = (await cookies()).get("bp_locale")?.value === "ar";
  const title = name ? `${name} | Black Perfumes` : page === "collection" ? (ar ? "مجموعة العطور | Black Perfumes" : "Fragrance Collection | Black Perfumes") : page === "about" ? (ar ? "عن Black Perfumes | عطرك، بصمتك" : "About Black Perfumes | Your Scent, Your Signature") : "Black Perfumes | Find Your Signature Scent";
  const description = name ? (ar ? `تعرّف على المرجع العطري ${name} في كتالوج Black Perfumes. استفسر عن التفاصيل والسعر والتوفر عبر واتساب أو إنستغرام.` : `Explore the ${name} fragrance reference in the Black Perfumes catalog. Inquire about details, pricing and availability on WhatsApp or Instagram.`) : ar ? "اكتشف مراجع العطور الرجالية والنسائية في Black Perfumes، واستفسر عن التفاصيل والسعر والتوفر عبر واتساب أو إنستغرام." : "Explore men's and women's fragrance references at Black Perfumes. Inquire about details, pricing and availability on WhatsApp or Instagram.";
  const origin = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || "https://black-perfumes.netlify.app";
  const metadataBase = origin ? new URL(origin) : undefined;
  const image = "/brand/social.png";
  return {
    title: { absolute: title }, description, ...(metadataBase ? { metadataBase, alternates: { canonical: path } } : {}),
    openGraph: { title, description, siteName: "Black Perfumes", type: "website", locale: ar ? "ar_JO" : "en_JO", alternateLocale: ar ? "en_JO" : "ar_JO", ...(metadataBase ? { url: path, images: [{ url: image, alt: "Black Perfumes — fragrance and individuality" }] } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(metadataBase ? { images: [image] } : {}) },
  };
}
