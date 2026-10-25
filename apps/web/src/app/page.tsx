import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { ArrowDown, ArrowUpRight, FlaskConical, Mouse, Sparkles } from "lucide-react";
import officialLogo from "../../public/Berfumes Black_logo.png";
import { PublicCollection, CollectionSkeleton } from "@/components/public-collection";
import { LanguageSwitcher, PublicDocumentLanguage } from "@/components/public-locale";
import { getCategories, getProducts } from "@/lib/catalog";
import { messages } from "@/i18n/messages";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { WHATSAPP_URL, WHATSAPP_NUMBER } from "@/lib/contact";
import "./home.css";

export const metadata: Metadata = { title: "Black Perfumes — The Chemistry of an Unforgettable Scent", description: "One spray is all it takes. رشة وحدة بتكفي. Explore Black Perfumes." };
const instagram = "https://www.instagram.com/black_perfumes99/";
const logo = officialLogo;

function Instagram({ size = 19 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>;
}

async function Catalog() {
  const [productResult, categoryResult] = await Promise.allSettled([getProducts(), getCategories()]);
  return <PublicCollection initialProducts={productResult.status === "fulfilled" ? productResult.value : []}
    categories={categoryResult.status === "fulfilled" ? categoryResult.value : []}
    unavailable={productResult.status === "rejected"} categoriesUnavailable={categoryResult.status === "rejected"} />;
}

export default async function Home() {
  const locale = (await cookies()).get("bp_locale")?.value === "ar" ? "ar" : "en";
  const t = messages[locale];
  return <NextIntlClientProvider locale={locale} messages={t} timeZone="Asia/Amman">
    <PublicDocumentLanguage />
    <div className="home-shell" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <a className="public-skip" href="#main">{t.skip}</a>
      <div className="cinematic-stage" id="home">
        <div className="hero-visual" aria-hidden="true"><Image className="hero-backdrop" src="/Berfumes%20Black_Hero.jpg" alt="" fill priority sizes="100vw" quality={90} /></div>
        <header className="home-nav">
          <Link href="/" className="brand-logo" aria-label={t.brandHome}><Image src={logo} alt="Berfumes Black" width={180} height={90} priority /></Link>
          <nav aria-label={t.navigation}><a className="nav-active" href="#home">{t.home}</a><Link href="/collection">{t.collection}</Link><a href="#about">{t.about}</a></nav>
          <div className="nav-actions"><a className="icon-button nav-whatsapp" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" aria-label={t.whatsapp}><WhatsAppIcon /></a><a className="icon-button nav-instagram" href={instagram} target="_blank" rel="noopener noreferrer" aria-label={t.instagram}><Instagram /></a><LanguageSwitcher /></div>
        </header>
        <main id="main" className="hero-main">
          <section className="home-hero" aria-labelledby="hero-title">
            <div className="hero-copy"><p className="eyebrow">{t.eyebrow}</p><h1 id="hero-title">{t.headline}<br /> <em>{t.headlineAccent}</em></h1><p className="hero-tagline">{t.tagline}</p><p className="hero-description">{t.intro}</p><div className="hero-actions"><a className="home-cta" href="/collection">{t.explore}<ArrowUpRight size={21} strokeWidth={1.5} /></a><a className="icon-button story-button" href="#about" aria-label={t.storyLink}><FlaskConical size={23} strokeWidth={1.4} /></a></div></div>
            <a href="#collection" className="hero-scroll"><Mouse size={26} strokeWidth={1.1} /><span>{t.scroll}</span><ArrowDown size={15} /></a>
          </section>
        </main>
      </div>
      <div className="public-content">
        <Suspense fallback={<CollectionSkeleton section />}><Catalog /></Suspense>
        <section id="about" className="home-section brand-section" aria-labelledby="brand-title">
          <div className="brand-art" aria-hidden="true"><div className="chemistry-orbit orbit-one" /><div className="chemistry-orbit orbit-two" /><div className="chemistry-core"><FlaskConical size={54} strokeWidth={.8} /><span>{t.personal}</span></div><span className="chemistry-label label-scent">{t.scent}</span><span className="chemistry-label label-skin">{t.skin}</span><span className="chemistry-label label-memory">{t.memory}</span><Sparkles className="chemistry-spark" size={20} strokeWidth={1} /></div>
          <div className="brand-copy"><p className="eyebrow">{t.brandEyebrow}</p><h2 id="brand-title">{t.brandTitle}<br /><em>{t.brandAccent}</em></h2><p>{t.brandText}</p><p>{t.brandTextTwo}</p><a className="text-link" href="#collection">{t.explore}<ArrowUpRight size={17} /></a></div>
        </section>
      </div>
      <footer className="home-footer"><div className="footer-brand"><Link href="/" aria-label={t.brandHome}><Image src={logo} alt="Berfumes Black" width={180} height={90} /></Link><p>{t.footerLine}</p></div><nav className="footer-links" aria-label={t.navigation}><a href="#collection">{t.collection}</a><a href="#about">{t.about}</a><a className="whatsapp-contact" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={17} /><span>{t.whatsapp}<bdi>{WHATSAPP_NUMBER}</bdi></span></a><a href={instagram} target="_blank" rel="noopener noreferrer"><Instagram size={16} />{t.instagram}<ArrowUpRight size={14} /></a></nav><div className="footer-bottom"><span>{t.copyright.replace("{year}", String(new Date().getFullYear()))}</span><Link className="admin-entry" href="/admin/login">{t.admin}</Link><a href="#home">{t.top}<ArrowUpRight size={14} /></a></div></footer>
    </div>
  </NextIntlClientProvider>;
}
