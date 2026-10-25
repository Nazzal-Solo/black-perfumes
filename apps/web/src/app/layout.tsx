import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Berfumes Black | Find Your Signature Scent",
  description: "Explore fragrance references at Berfumes Black. Contact us for details, pricing and availability.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = (await cookies()).get("bp_locale")?.value === "ar" ? "ar" : "en";
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:p-4">Skip to content</a>
        <header className="border-b px-6 py-6 sm:px-10">
          <Link href="/" className="text-sm font-semibold tracking-[0.2em]">BLACK PERFUMES</Link>
        </header>
        {children}
        <footer className="border-t px-6 py-6 text-sm text-muted-foreground sm:px-10">Black Perfumes · Fine fragrance</footer>
      </body>
    </html>
  );
}
