"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Image, { type ImageProps } from "next/image";
import { usePathname } from "next/navigation";
import { z } from "zod";
import { env } from "@/config/env";

const asset = z.string().refine(value => {
  if (["/Berfumes%20Black_logo.png", "/favicon.ico", "/Berfumes%20Black_Hero.jpg", "/Berfumes%20Black_Men.png", "/Berfumes%20Black_Women.png"].includes(value)) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && url.hostname === "res.cloudinary.com"; } catch { return false; }
}).nullable();
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const appearanceResponse = z.object({
  revision: z.number().int().nonnegative(), themePreset: z.enum(["emerald-lab", "retro-vice", "midnight-luxury", "light-elegance"]),
  assets: z.object({ logo: asset, favicon: asset, hero: asset, men: asset, women: asset, unisex: asset }),
  tokens: z.object({ background: color, surface: color, raised: color, text: color, muted: color, border: color, accent: color, onAccent: color, hover: color, focus: color, disabled: color, disabledText: color }),
});
type Appearance = z.infer<typeof appearanceResponse>;
const Context = createContext<Appearance | null>(null);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const revision = useRef(0);
  const publicPage = !pathname?.startsWith("/admin");
  useEffect(() => {
    if (!publicPage) return;
    let active = true; let pending: AbortController | undefined;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || pending) return;
      const controller = new AbortController(); pending = controller;
      try {
        const response = await fetch(`${env.NEXT_PUBLIC_API_URL.replace(/\/$/, "")}/api/appearance`, { credentials: "omit", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]) });
        if (!response.ok) return;
        const value = appearanceResponse.parse(await response.json());
        if (active && value.revision > revision.current) { revision.current = value.revision; setAppearance(value); }
      } catch { /* Branding is optional; retain the existing assets and design on failure. */ }
      finally { if (pending === controller) pending = undefined; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    const visible = () => { void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; pending?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [publicPage]);
  useEffect(() => {
    if (!appearance) return;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(appearance.tokens)) root.style.setProperty(`--appearance-${key}`, value);
    if (appearance.themePreset === "emerald-lab") delete root.dataset.appearanceTheme;
    else root.dataset.appearanceTheme = appearance.themePreset;
    for (const slot of ["men", "women", "unisex"] as const) {
      const url = appearance.assets[slot];
      if (url?.startsWith("https://")) root.style.setProperty(`--appearance-${slot}-image`, `url(${JSON.stringify(url)})`);
      else root.style.removeProperty(`--appearance-${slot}-image`);
    }
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]'));
    for (const link of links) {
      link.dataset.originalIcon ??= link.href;
      link.dataset.originalIconType ??= link.getAttribute("type") ?? "";
      link.dataset.originalIconSizes ??= link.getAttribute("sizes") ?? "";
      link.href = appearance.assets.favicon?.startsWith("https://") ? appearance.assets.favicon : link.dataset.originalIcon;
      if (appearance.assets.favicon?.startsWith("https://")) { link.type = "image/png"; link.removeAttribute("sizes"); }
      else {
        if (link.dataset.originalIconType) link.type = link.dataset.originalIconType; else link.removeAttribute("type");
        if (link.dataset.originalIconSizes) link.setAttribute("sizes", link.dataset.originalIconSizes); else link.removeAttribute("sizes");
      }
    }
  }, [appearance, pathname]);
  return <Context.Provider value={appearance}>{children}</Context.Provider>;
}

export function AppearanceImage({ slot, fallbackSrc, alt, ...props }: Omit<ImageProps, "src"> & { slot: "logo" | "hero"; fallbackSrc: ImageProps["src"] }) {
  const appearance = useContext(Context);
  const custom = appearance?.assets[slot];
  return <Image {...props} alt={alt} src={custom?.startsWith("https://") ? custom : fallbackSrc} unoptimized={custom?.startsWith("https://") || props.unoptimized} />;
}
