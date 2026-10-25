"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { setPublicLocale } from "@/i18n/actions";

export function PublicDocumentLanguage() {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    return () => { document.documentElement.lang = "en"; document.documentElement.dir = "ltr"; };
  }, [locale]);
  return null;
}

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="language-switch" role="group" aria-label={t("language")} dir="ltr" aria-busy={pending}>
    {(["en", "ar"] as const).map((value) => <button key={value} type="button" lang={value} aria-label={value === "en" ? "English" : "العربية"} aria-pressed={value === locale} disabled={pending} onClick={() => startTransition(async () => { await setPublicLocale(value); router.refresh(); })}>{value.toUpperCase()}</button>)}
  </div>;
}
