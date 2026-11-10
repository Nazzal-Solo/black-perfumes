import { appearanceResponse, type Appearance } from "./appearance";

export async function readPublishedAppearance(apiOrigin: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Appearance | null> {
  try {
    const response = await fetcher(`${apiOrigin.replace(/\/$/, "")}/api/appearance`, { cache: "no-store", credentials: "omit", signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]) });
    if (!response.ok) return null;
    return appearanceResponse.parse(await response.json());
  } catch { return null; }
}

export const APPEARANCE_PUBLISHED_EVENT = "appearance-published";
export function publishedAppearanceFromEvent(event: Event): Appearance | null {
  if (!(event instanceof CustomEvent)) return null;
  const parsed = appearanceResponse.safeParse(event.detail);
  return parsed.success ? parsed.data : null;
}
export function announcePublishedAppearance(appearance: Appearance) {
  window.dispatchEvent(new CustomEvent(APPEARANCE_PUBLISHED_EVENT, { detail: appearanceResponse.parse(appearance) }));
}

export function latestPublishedAppearance(previous: Appearance | null, incoming: Appearance | null) {
  if (!incoming || (previous && incoming.revision < previous.revision)) return previous;
  return previous && JSON.stringify(previous) === JSON.stringify(incoming) ? previous : incoming;
}

export function publishedAssetSource<T>(appearance: Appearance | null, slot: keyof Appearance["assets"], fallback: T, failed = ""): string | T {
  const custom = appearance?.assets[slot];
  return custom?.startsWith("https://") && custom !== failed ? custom : fallback;
}

export type BrandingAssetState = "loading" | "ready" | "removed" | "unavailable";
export function publishedAssetView(appearance: Appearance | null, slot: keyof Appearance["assets"], failed = "", loaded = "", unavailable = false): { state: BrandingAssetState; source: string | null } {
  if (!appearance) return { state: unavailable ? "unavailable" : "loading", source: null };
  const source = publishedAssetSource(appearance, slot, null);
  if (!source) return { state: "removed", source: null };
  if (source === failed) return { state: "unavailable", source: null };
  return { state: source === loaded ? "ready" : "loading", source };
}

export function applyPublishedAppearance(document: Document, appearance: Appearance) {
  const root = document.documentElement;
  const originalTheme = root.dataset.appearanceTheme;
  const variables = Object.entries(appearance.tokens).map(([key, value]) => [`--appearance-${key}`, value] as const);
  const original = variables.map(([name]) => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)] as const);
  for (const [name, value] of variables) root.style.setProperty(name, value);
  root.dataset.appearanceTheme = appearance.themePreset;
  const icons = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"],link[rel="apple-touch-icon"]')).map(link => {
    const saved = { link, href: link.getAttribute("href"), type: link.getAttribute("type"), sizes: link.getAttribute("sizes") };
    const apple = link.getAttribute("rel") === "apple-touch-icon";
    const fallback = `${apple ? "/apple-icon.png" : "/icon.png"}?v=black-perfumes-v3`;
    const onError = () => {
      if (link.getAttribute("href") !== fallback) link.href = fallback;
      link.type = "image/png"; link.setAttribute("sizes", apple ? "180x180" : "512x512");
    };
    link.addEventListener("error", onError);
    if (appearance.assets.favicon?.startsWith("https://")) { const url = new URL(appearance.assets.favicon); url.searchParams.set("bp_revision", String(appearance.revision)); link.href = url.toString(); link.type = "image/png"; link.removeAttribute("sizes"); }
    else onError();
    return { ...saved, onError };
  });
  return () => {
    if (originalTheme === undefined) delete root.dataset.appearanceTheme; else root.dataset.appearanceTheme = originalTheme;
    for (const [name, value, priority] of original) { if (value) root.style.setProperty(name, value, priority); else root.style.removeProperty(name); }
    for (const { link, href, type, sizes, onError } of icons) {
      link.removeEventListener("error", onError);
      for (const [name, value] of [["href", href], ["type", type], ["sizes", sizes]] as const) { if (value === null) link.removeAttribute(name); else link.setAttribute(name, value); }
    }
  };
}
