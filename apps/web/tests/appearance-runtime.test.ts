import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPublishedAppearance, readPublishedAppearance, latestPublishedAppearance, publishedAssetSource } from "../src/lib/appearance-runtime";
import type { Appearance } from "../src/lib/appearance";
const tokens = { background: "#090D0B", surface: "#152B20", raised: "#203D2C", text: "#F0EDE5", muted: "#A9C9B2", border: "#6F8B78", accent: "#A9C9B2", onAccent: "#090D0B", hover: "#C4E4CE", focus: "#C4E4CE", disabled: "#82988A", disabledText: "#090D0B" };
const appearance: Appearance = { revision: 0, themePreset: "emerald-lab", tokens, assets: { logo: null, favicon: "/icon.png", hero: null, men: null, women: null, unisex: null } };
function documentFixture() {
  const values = new Map<string, [string, string]>();
  const style = { getPropertyValue(name: string) { return values.get(name)?.[0] ?? ""; }, getPropertyPriority(name: string) { return values.get(name)?.[1] ?? ""; }, setProperty(name: string, value: string, priority = "") { values.set(name, [value, priority]); }, removeProperty(name: string) { values.delete(name); } };
  const icon = (rel: string, href: string) => {
    const attributes = new Map([["href", href], ["type", "image/x-icon"], ["sizes", "32x32"], ["rel", rel]]);
    const listeners = new Map<string, () => void>();
    return { addEventListener(name: string, listener: () => void) { listeners.set(name, listener); }, removeEventListener(name: string) { listeners.delete(name); }, fail() { listeners.get("error")?.(); }, getAttribute(name: string) { return attributes.get(name) ?? null; }, setAttribute(name: string, value: string) { attributes.set(name, value); }, removeAttribute(name: string) { attributes.delete(name); }, set href(value: string) { attributes.set("href", value); }, set type(value: string) { attributes.set("type", value); } };
  };
  const icons = [icon("icon", "/favicon.ico"), icon("apple-touch-icon", "/apple-icon.png")];
  const root = { style, dataset: {} as Record<string, string> };
  const document = { documentElement: root, querySelectorAll() { return icons; } } as unknown as Document;
  return { document, root, values, icons };
}

test("published reads always bypass browser cache, omit credentials and use only the published endpoint", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls++; assert.equal(String(input), "https://api.example.test/api/appearance"); assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "omit"); assert.ok(init?.signal);
    return Response.json({ ...appearance, draft: { themePreset: "light-elegance" } });
  };
  for (let refresh = 0; refresh < 2; refresh++) { const result = await readPublishedAppearance("https://api.example.test/", new AbortController().signal, fetcher); assert.deepEqual(result, appearance); assert.ok(!("draft" in result!)); }
  assert.equal(calls, 2);
});

test("temporary failures, malformed settings and aborts are non-throwing and preserve last valid branding", async () => {
  for (const fetcher of [async () => new Response(null, { status: 503 }), async () => Response.json({ themePreset: "draft-only" }), async () => { throw new TypeError("offline"); }, async () => { throw new DOMException("cancelled", "AbortError"); }]) {
    assert.equal(await readPublishedAppearance("https://api.example.test", new AbortController().signal, fetcher), null);
  }
  const current = { ...appearance, revision: 2, themePreset: "light-elegance" as const };
  assert.equal(latestPublishedAppearance(current, null), current); assert.equal(latestPublishedAppearance(current, appearance), current);
  assert.equal(latestPublishedAppearance(null, appearance), appearance, "Revision zero must apply");
  const next = { ...current, revision: 3, themePreset: "emerald-lab" as const };
  assert.equal(latestPublishedAppearance(current, next), next); assert.equal(latestPublishedAppearance(current, { ...current }), current);
});

test("all four presets, including Emerald and Light Mode, apply shared semantic variables and preserve application-specific aliases", () => {
  for (const preset of ["emerald-lab", "retro-vice", "midnight-luxury", "light-elegance"] as const) {
    const h = documentFixture(); h.root.style.setProperty("--admin-bg", "#101312"); h.root.style.setProperty("--appearance-text", "#ffffff", "important");
    const undo = applyPublishedAppearance(h.document, { ...appearance, themePreset: preset });
    assert.equal(h.root.dataset.appearanceTheme, preset);
    for (const [key, value] of Object.entries(tokens)) assert.equal(h.root.style.getPropertyValue("--appearance-" + key), value);
    assert.equal(h.root.style.getPropertyValue("--admin-bg"), "#101312"); undo();
    assert.equal(h.root.dataset.appearanceTheme, undefined); assert.equal(h.root.style.getPropertyValue("--appearance-text"), "#ffffff"); assert.equal(h.root.style.getPropertyPriority("--appearance-text"), "important"); assert.equal(h.root.style.getPropertyValue("--appearance-surface"), "");
  }
});

test("custom favicons revert to original browser/mobile metadata on navigation or reset", () => {
  const h = documentFixture(); const before = h.icons.map(icon => [icon.getAttribute("href"), icon.getAttribute("type"), icon.getAttribute("sizes")]);
  const undo = applyPublishedAppearance(h.document, { ...appearance, assets: { ...appearance.assets, favicon: "https://res.cloudinary.com/fixture/image/upload/favicon.png" } });
  for (const icon of h.icons) { assert.match(icon.getAttribute("href")!, /favicon.png/); assert.equal(icon.getAttribute("type"), "image/png"); assert.equal(icon.getAttribute("sizes"), null); }
  undo(); assert.deepEqual(h.icons.map(icon => [icon.getAttribute("href"), icon.getAttribute("type"), icon.getAttribute("sizes")]), before);
  applyPublishedAppearance(h.document, appearance)(); assert.deepEqual(h.icons.map(icon => [icon.getAttribute("href"), icon.getAttribute("type"), icon.getAttribute("sizes")]), before);
});


test("published branding controls every image slot, with neutral fallbacks on missing or failed images", () => {
  for (const slot of ["logo", "hero", "men", "women", "unisex"] as const) {
    const url = `https://res.cloudinary.com/fixture/image/upload/${slot}.png`;
    const published = { ...appearance, assets: { ...appearance.assets, [slot]: url } };
    const fallback = appearance.assets[slot];
    assert.equal(publishedAssetSource(null, slot, fallback), fallback);
    assert.equal(publishedAssetSource(published, slot, fallback), url);
    assert.equal(publishedAssetSource(published, slot, fallback, url), fallback);
    assert.equal(publishedAssetSource({ ...published, assets: { ...published.assets, [slot]: url + "?updated=1" } }, slot, fallback, url), url + "?updated=1");
  }
});

test("published light and dark palettes replace each other without retaining stale variables", () => {
  const h = documentFixture();
  const light = { ...appearance, revision: 2, themePreset: "light-elegance" as const, tokens: { ...tokens, background: "#FFFFFF", surface: "#FFFFFF", text: "#171717", accent: "#171717", onAccent: "#FFFFFF" } };
  let undo = applyPublishedAppearance(h.document, light);
  assert.equal(h.root.style.getPropertyValue("--appearance-background"), "#FFFFFF");
  // The same document/variables are inherited by both the storefront and admin shell.
  undo(); undo = applyPublishedAppearance(h.document, { ...appearance, revision: 3 });
  assert.equal(h.root.dataset.appearanceTheme, "emerald-lab");
  assert.equal(h.root.style.getPropertyValue("--appearance-background"), tokens.background);
  assert.equal(h.root.style.getPropertyValue("--appearance-onAccent"), tokens.onAccent);
  undo();
});

test("unavailable or missing published favicons use neutral browser/mobile fallbacks", () => {
  const h = documentFixture();
  const undo = applyPublishedAppearance(h.document, { ...appearance, assets: { ...appearance.assets, favicon: "https://res.cloudinary.com/fixture/image/upload/new-favicon.png" } });
  for (const icon of h.icons) icon.fail();
  assert.equal(h.icons[0]!.getAttribute("href"), "/icon.png?v=black-perfumes-v2");
  assert.equal(h.icons[1]!.getAttribute("href"), "/apple-icon.png?v=black-perfumes-v2");
  undo();
  assert.equal(h.icons[0]!.getAttribute("href"), "/favicon.ico");
  h.icons[0]!.fail(); assert.equal(h.icons[0]!.getAttribute("href"), "/favicon.ico", "cleanup removes the listener");
  applyPublishedAppearance(h.document, { ...appearance, assets: { ...appearance.assets, favicon: null } });
  assert.match(h.icons[0]!.getAttribute("href")!, /icon.png\?v=black-perfumes/);
});
