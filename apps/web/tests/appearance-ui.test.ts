import assert from "node:assert/strict";
import { createElement } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { test } from "node:test";
import { ThemeCards, AppearancePreview } from "../src/components/admin/appearance-manager";
import type { ThemePresets } from "../src/lib/appearance-admin";
const tokens = { background: "#090D0B", surface: "#152B20", raised: "#203D2C", text: "#F0EDE5", muted: "#A9C9B2", border: "#6F8B78", accent: "#A9C9B2", onAccent: "#090D0B", hover: "#C4E4CE", focus: "#C4E4CE", disabled: "#82988A", disabledText: "#090D0B" };
const themes: ThemePresets = { "emerald-lab": tokens, "retro-vice": tokens, "midnight-luxury": tokens, "light-elegance": tokens };
test("EN/AR themes use native radios, explicit selected/live states and private preview content", () => {
  for (const locale of ["en", "ar"]) {
    const render = (children: React.ReactNode) => renderToStaticMarkup(jsx(NextIntlClientProvider, { locale, messages: {}, timeZone: "Asia/Amman", children }));
    const cards = render(createElement(ThemeCards, { value: "retro-vice", published: "emerald-lab", themes, disabled: false, onChange: () => {} }));
    assert.equal((cards.match(/type="radio"/g) ?? []).length, 4); assert.equal((cards.match(/checked=""/g) ?? []).length, 1);
    assert.ok(cards.includes(locale === "ar" ? "الوضع الفاتح" : "Light Mode")); assert.ok(cards.includes(locale === "ar" ? "منشور" : "Live"));
    const preview = render(createElement(AppearancePreview, { appearance: { themePreset: "retro-vice", tokens, revision: 0, assets: { logo: null, favicon: null, hero: null, men: null, women: null, unisex: null } } }));
    assert.ok(preview.includes(locale === "ar" ? "عطر يعبّر" : "Find a Fragrance")); assert.ok(!preview.includes("iframe"));
  }
});
