import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import logo from "../../../public/Berfumes Black_logo.png";
import { messages } from "@/i18n/messages";
import { LanguageSwitcher, PublicDocumentLanguage } from "@/components/public-locale";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { WHATSAPP_URL, WHATSAPP_NUMBER } from "@/lib/contact";
import "../home.css";
import "./store.css";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const locale = (await cookies()).get("bp_locale")?.value === "ar" ? "ar" : "en";
  const t = messages[locale];
  return <NextIntlClientProvider locale={locale} messages={t} timeZone="Asia/Amman"><PublicDocumentLanguage /><div className="home-shell storefront-shell" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
    <a className="public-skip" href="#main">{t.skip}</a>
    <header className="home-nav"><Link href="/" className="brand-logo" aria-label={t.brandHome}><Image src={logo} alt="Berfumes Black" width={180} height={90} priority /></Link><nav aria-label={t.navigation}><Link href="/">{t.home}</Link><Link className="nav-active" href="/collection">{t.collection}</Link><Link href="/#about">{t.about}</Link></nav><div className="nav-actions"><a className="icon-button nav-whatsapp" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" aria-label={t.whatsapp}><WhatsAppIcon /></a><LanguageSwitcher /></div></header>
    <main id="main" className="store-main">{children}</main>
    <footer className="home-footer"><div className="footer-brand"><Link href="/" aria-label={t.brandHome}><Image src={logo} alt="Berfumes Black" width={180} height={90} /></Link><p>{t.footerLine}</p></div><nav className="footer-links" aria-label={t.navigation}><Link href="/collection">{t.collection}</Link><a className="whatsapp-contact" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={17} /><span>{t.whatsapp}<bdi>{WHATSAPP_NUMBER}</bdi></span></a><a href="https://www.instagram.com/black_perfumes99/" target="_blank" rel="noopener noreferrer">{t.instagram} ↗</a></nav><div className="footer-bottom"><span>{t.copyright.replace("{year}", String(new Date().getFullYear()))}</span><Link className="admin-entry" href="/admin/login">{t.admin}</Link></div></footer>
  </div></NextIntlClientProvider>;
}
