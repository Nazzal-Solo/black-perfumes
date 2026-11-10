"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Image, { type ImageProps } from "next/image";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { env } from "@/config/env";
import { appearanceResponse, type Appearance } from "@/lib/appearance";
import { APPEARANCE_PUBLISHED_EVENT, publishedAppearanceFromEvent, applyPublishedAppearance, readPublishedAppearance, latestPublishedAppearance, publishedAssetSource, publishedAssetView } from "@/lib/appearance-runtime";
export { appearanceResponse };
const Context = createContext<Appearance | null>(null);
const UnavailableContext = createContext(false);
export const usePublishedAppearance = () => useContext(Context);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true; let pending: AbortController | undefined;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || pending) return;
      const controller = new AbortController(); pending = controller;
      try {
        const value = await readPublishedAppearance(env.NEXT_PUBLIC_API_URL, controller.signal);
        if (active) { setAppearance(previous => latestPublishedAppearance(previous, value)); setUnavailable(!value); }
      } catch { /* Branding is optional; retain the existing assets and design on failure. */ }
      finally { if (pending === controller) pending = undefined; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    const visible = () => { void refresh(); };
    document.addEventListener("visibilitychange", visible);
    const published = (event: Event) => {
      const value = publishedAppearanceFromEvent(event);
      if (active && value) setAppearance(previous => latestPublishedAppearance(previous, value));
    };
    window.addEventListener(APPEARANCE_PUBLISHED_EVENT, published);
    return () => { active = false; pending?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener(APPEARANCE_PUBLISHED_EVENT, published); };
  }, [pathname]);
  useEffect(() => {
    if (!appearance) return;
    return applyPublishedAppearance(document, appearance);
  }, [appearance]);
  return <Context.Provider value={appearance}><UnavailableContext.Provider value={unavailable}>{children}</UnavailableContext.Provider></Context.Provider>;
}

export function AppearanceImage({ slot, fallbackSrc, alt, onError, ...props }: Omit<ImageProps, "src"> & { slot: "logo" | "hero" | "men" | "women" | "unisex"; fallbackSrc: ImageProps["src"] }) {
  const appearance = usePublishedAppearance();
  const [failed, setFailed] = useState("");
  const custom = appearance?.assets[slot];
  const source = publishedAssetSource(appearance, slot, fallbackSrc, failed);
  const useCustom = !!custom?.startsWith("https://") && source === custom;
  return <Image {...props} alt={alt} src={source} unoptimized={useCustom || props.unoptimized} onError={event => { if (useCustom) setFailed(custom!); onError?.(event); }} />;
}

export function AppearanceHero() {
  const appearance = usePublishedAppearance(); const [failed, setFailed] = useState(""); const [loaded, setLoaded] = useState("");
  const view = publishedAssetView(appearance, "hero", failed, loaded, useContext(UnavailableContext));
  return view.source ? <Image className="hero-backdrop" data-branding-state={view.state} src={view.source} alt="" fill priority sizes="100vw" unoptimized onLoad={() => setLoaded(view.source!)} onError={() => setFailed(view.source!)} /> : <span className="hero-neutral" data-branding-state={view.state}><BrandMark width={300} height={150} /></span>;
}
export function AppearanceCover({ slot }: { slot: "men" | "women" | "unisex" }) {
  const appearance = usePublishedAppearance(); const [failed, setFailed] = useState(""); const [loaded, setLoaded] = useState("");
  const view = publishedAssetView(appearance, slot, failed, loaded, useContext(UnavailableContext));
  return <span className="entry-background" data-branding-state={view.state} aria-hidden="true">{view.source && <Image src={view.source} alt="" fill sizes="(max-width: 760px) 100vw, 50vw" unoptimized onLoad={() => setLoaded(view.source!)} onError={() => setFailed(view.source!)} />}</span>;
}
export function BrandLogo({ width = 180, height = 90, onError, onLoad, ...props }: Omit<ImageProps, "src" | "alt">) {
  const appearance = usePublishedAppearance(); const [failed, setFailed] = useState(""); const [loaded, setLoaded] = useState("");
  const view = publishedAssetView(appearance, "logo", failed, loaded, useContext(UnavailableContext));
  return view.source ? <Image {...props} data-branding-state={view.state} src={view.source} alt="Black Perfumes" width={width} height={height} unoptimized onLoad={event => { setLoaded(view.source!); onLoad?.(event); }} onError={event => { setFailed(view.source!); onError?.(event); }} /> : <BrandMark width={Number(width)} height={Number(height)} status={view.state} />;
}
