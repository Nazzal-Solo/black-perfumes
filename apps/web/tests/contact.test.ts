import { test } from "node:test";
import assert from "node:assert/strict";
import { createTranslator } from "next-intl";
import { WHATSAPP_NUMBER, WHATSAPP_URL, whatsappInquiryUrl } from "../src/lib/contact";
import { messages } from "../src/i18n/messages";

test("official WhatsApp destination and display number stay consistent", () => {
  assert.equal(WHATSAPP_URL, "https://wa.me/962786012133");
  assert.equal(WHATSAPP_NUMBER.replace(/\D/g, ""), new URL(WHATSAPP_URL).pathname.slice(1));
});
test("English and Arabic inquiries preserve product names without changing destination or query parameters", () => {
  const name = "عطر & Scent + Noir #1?";
  for (const locale of ["en", "ar"] as const) {
    const t = createTranslator({ locale, messages: messages[locale] });
    const message = t("whatsappMessage", { name });
    const url = new URL(whatsappInquiryUrl(message));
    assert.equal(url.origin + url.pathname, WHATSAPP_URL);
    assert.deepEqual([...url.searchParams.keys()], ["text"]);
    assert.equal(url.searchParams.get("text"), message);
    assert.ok(message.includes(name));
    assert.equal(url.hash, "");
  }
});
