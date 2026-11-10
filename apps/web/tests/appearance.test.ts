import assert from "node:assert/strict";
import { createElement } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
process.env.NEXT_PUBLIC_API_URL ??= "https://api.example.test";

test("public appearance is non-blocking and leaves server-rendered content unchanged", async () => {
  const { AppearanceProvider } = await import("../src/components/appearance/provider");
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("offline"); };
  try {
    const html = renderToStaticMarkup(jsx(AppearanceProvider, { children: createElement("div", null, "Existing branding") }));
    assert.equal(html, "<div>Existing branding</div>"); assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("public appearance rejects arbitrary URLs and CSS tokens while accepting approved static fallbacks", async () => {
  const { appearanceResponse } = await import("../src/components/appearance/provider");
  const colors = { background: "#090D0B", surface: "#152B20", raised: "#203D2C", text: "#F0EDE5", muted: "#A9C9B2", border: "#6F8B78", accent: "#A9C9B2", onAccent: "#090D0B", hover: "#C4E4CE", focus: "#C4E4CE", disabled: "#82988A", disabledText: "#090D0B" };
  const value = { revision: 0, themePreset: "emerald-lab", tokens: colors, assets: { logo: null, favicon: "/icon.png", hero: null, men: null, women: null, unisex: null } };
  assert.ok(appearanceResponse.safeParse(value).success);
  const legacy = appearanceResponse.parse({ ...value, assets: { ...value.assets, logo: "/Berfumes%20Black_logo.png", hero: "/Berfumes%20Black_Hero.jpg", men: "/Berfumes%20Black_Men.png", women: "/Berfumes%20Black_Women.png" } });
  for (const slot of ["logo", "hero", "men", "women"] as const) assert.equal(legacy.assets[slot], null);
  assert.equal(appearanceResponse.safeParse({ ...value, assets: { ...value.assets, logo: "https://evil.test/logo.png" } }).success, false);
  assert.equal(appearanceResponse.safeParse({ ...value, tokens: { ...colors, background: 'url("https://evil.test")' } }).success, false);
});
