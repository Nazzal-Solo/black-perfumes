import assert from "node:assert/strict";
import { createElement } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { test } from "node:test";
import { createRequire } from "node:module";
import { messages } from "../src/i18n/messages";
process.env.NEXT_PUBLIC_API_URL ??= "https://api.example.test";

test("EN/AR initial loading reserves real card grids and keeps both collection links usable without API data", async () => {
  const requireModule = createRequire(process.cwd() + "/package.json");
  const pngLoader = requireModule.extensions[".png"];
  requireModule.extensions[".png"] = module => { module.exports = { src: "/brand.png", width: 180, height: 90 }; };
  const { PublicCollection, CollectionSkeleton } = await import("../src/components/public-collection");
  if (pngLoader) requireModule.extensions[".png"] = pngLoader; else delete requireModule.extensions[".png"];
  for (const locale of ["en", "ar"] as const) {
    const render = (element: React.ReactNode) => renderToStaticMarkup(jsx(NextIntlClientProvider, { locale, messages: messages[locale], timeZone: "Asia/Amman", children: element }));
    const home = render(createElement(PublicCollection));
    assert.equal((home.match(/class="skeleton-card"/g) ?? []).length, 6);
    assert.ok(home.includes(messages[locale].loading)); assert.ok(!home.includes(messages[locale].errorTitle));
    assert.ok(home.includes('/collection?collection=men')); assert.ok(home.includes('/collection?collection=women'));
    assert.ok(!home.includes('aria-disabled="true"')); assert.ok(!home.includes('tabindex="-1"'));
    const collection = render(createElement(CollectionSkeleton, { section: true, full: true }));
    assert.equal((collection.match(/class="skeleton-card"/g) ?? []).length, 24); assert.ok(collection.includes('<h1'));
    assert.ok(messages[locale].retry.length > 0); assert.ok(messages[locale].errorText.length > 0);
  }
});
