import type { Metadata } from "next";
import "./admin.css";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { messages } from "@/i18n/messages";
import { PublicDocumentLanguage } from "@/components/public-locale";
import { AdminUiProvider } from "@/components/admin/admin-ui";

export const metadata: Metadata = { title: "Admin · Black Perfumes", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const locale = (await cookies()).get("bp_locale")?.value === "ar" ? "ar" : "en";
  return <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Amman"><div className="admin-shell" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}><a href="#main" className="admin-skip">{locale === "ar" ? "انتقل إلى المحتوى" : "Skip to content"}</a><PublicDocumentLanguage /><AdminUiProvider>{children}</AdminUiProvider></div></NextIntlClientProvider>;
}
