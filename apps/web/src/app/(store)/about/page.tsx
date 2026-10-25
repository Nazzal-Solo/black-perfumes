import { cookies } from "next/headers";
import Link from "next/link";
import { messages } from "@/i18n/messages";
import { publicMetadata } from "@/lib/metadata";

export const generateMetadata = () => publicMetadata("about", "/about");

export default async function AboutPage() {
  const locale = (await cookies()).get("bp_locale")?.value === "ar" ? "ar" : "en";
  const t = messages[locale];
  return <section className="home-section brand-section" aria-labelledby="about-title"><div className="brand-copy"><p className="eyebrow">{t.brandEyebrow}</p><h1 id="about-title">{t.brandTitle} <em>{t.brandAccent}</em></h1><p>{t.brandText}</p><p>{t.brandTextTwo}</p><Link className="text-link" href="/collection">{t.explore}</Link></div></section>;
}
