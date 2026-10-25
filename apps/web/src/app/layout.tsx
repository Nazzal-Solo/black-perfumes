import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Black Perfumes",
  description: "The future home of Black Perfumes. A considered collection of fine fragrances.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
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
