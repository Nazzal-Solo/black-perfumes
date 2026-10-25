import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { messages } from "./messages";

export default getRequestConfig(async () => {
  const locale = (await cookies()).get("bp_locale")?.value === "ar" ? "ar" : "en";
  return { locale, messages: messages[locale], timeZone: "Asia/Amman" };
});
