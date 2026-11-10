import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import "./globals.css";
import { AppearanceProvider, BrandLogo } from "@/components/appearance/provider";

export const metadata: Metadata = {
  title: "Black Perfumes | Find Your Signature Scent",
  icons: { icon: { url: "/icon.png?v=black-perfumes-v2", type: "image/png", sizes: "512x512" }, apple: "/apple-icon.png?v=black-perfumes-v2" },
  description: "Explore fragrance references at Black Perfumes. Contact us for details, pricing and availability.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = (await cookies()).get("bp_locale")?.value === "ar" ? "ar" : "en";
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body className="flex min-h-dvh flex-col"><AppearanceProvider>
        <a href="#main" className="sr-only focus:not-sr-only focus:p-4">Skip to content</a>
        <header className="border-b px-6 py-6 sm:px-10">
          <Link href="/" aria-label="Black Perfumes"><BrandLogo width={160} height={80} /></Link>
        </header>
        {children}
        <footer className="border-t px-6 py-6 text-sm text-muted-foreground sm:px-10">Black Perfumes · Fine fragrance</footer>
      </AppearanceProvider></body>
    </html>
  );
}
