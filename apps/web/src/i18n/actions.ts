"use server";

import { cookies } from "next/headers";

export async function setPublicLocale(locale: string) {
  if (locale !== "en" && locale !== "ar") return;
  (await cookies()).set("bp_locale", locale, {
    path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax",
    httpOnly: true, secure: process.env.NODE_ENV === "production",
  });
}
