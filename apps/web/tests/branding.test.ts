import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import test from "node:test";
import { messages } from "../src/i18n/messages";
import { publishedAssetSource } from "../src/lib/appearance-runtime";
process.env.NEXT_PUBLIC_API_URL ??= "https://api.example.test";

test("public/admin logo and product placeholders remain brand-safe in EN/AR and every preset", async () => {
  const { BrandLogo } = await import("../src/components/appearance/provider");
  const { BrandedPlaceholder } = await import("../src/components/branded-placeholder");
  for (const locale of ["en", "ar"] as const) for (const preset of ["emerald-lab", "retro-vice", "midnight-luxury", "light-elegance"]) {
    const content = createElement("div", { "data-appearance-theme": preset, dir: locale === "ar" ? "rtl" : "ltr" }, createElement(BrandLogo), createElement(BrandedPlaceholder, { label: messages[locale].imageMissing, category: "Unisex" }));
    const html = renderToStaticMarkup(jsx(NextIntlClientProvider, { locale, messages: messages[locale], timeZone: "Asia/Amman", children: content }));
    assert.ok(html.includes('aria-label="Black Perfumes"')); assert.ok(html.includes(messages[locale].imageMissing));
    assert.doesNotMatch(html, /<img|Flask|chemistry|Breaking|Berfumes|كيمياء/i);
    assert.equal(publishedAssetSource(null, "logo", null), null);
  }
});

test("marketing copy and shipped fallback assets contain no retired branding", () => {
  for (const locale of ["en", "ar"] as const) assert.doesNotMatch(JSON.stringify(messages[locale]), /chemistry|reaction|Breaking Bad|كيمياء|التفاعل/i);
  assert.ok(!readdirSync(new URL("../public/", import.meta.url)).some(name => /^Berfumes Black_(logo|Hero|Men|Women)/.test(name)));
  for (const [file, size] of [["icon.png", 512], ["apple-icon.png", 180]] as const) {
    const bytes = readFileSync(new URL("../src/app/" + file, import.meta.url));
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
  }
});
