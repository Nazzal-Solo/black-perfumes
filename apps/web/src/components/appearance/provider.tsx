"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Image, { type ImageProps } from "next/image";
import { usePathname } from "next/navigation";
import { env } from "@/config/env";
import { appearanceResponse, type Appearance } from "@/lib/appearance";
import { applyPublishedAppearance, readPublishedAppearance, latestPublishedAppearance, publishedAssetSource } from "@/lib/appearance-runtime";
export { appearanceResponse };
const Context = createContext<Appearance | null>(null);
export const usePublishedAppearance = () => useContext(Context);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  useEffect(() => {
    let active = true; let pending: AbortController | undefined;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || pending) return;
      const controller = new AbortController(); pending = controller;
      try {
        const value = await readPublishedAppearance(env.NEXT_PUBLIC_API_URL, controller.signal);
        if (active) setAppearance(previous => latestPublishedAppearance(previous, value));
      } catch { /* Branding is optional; retain the existing assets and design on failure. */ }
      finally { if (pending === controller) pending = undefined; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    const visible = () => { void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; pending?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [pathname]);
  useEffect(() => {
    if (!appearance) return;
    return applyPublishedAppearance(document, appearance);
  }, [appearance]);
  return <Context.Provider value={appearance}>{children}</Context.Provider>;
}

export function AppearanceImage({ slot, fallbackSrc, alt, onError, ...props }: Omit<ImageProps, "src"> & { slot: "logo" | "hero" | "men" | "women" | "unisex"; fallbackSrc: ImageProps["src"] }) {
  const appearance = usePublishedAppearance();
  const [failed, setFailed] = useState("");
  const custom = appearance?.assets[slot];
  const source = publishedAssetSource(appearance, slot, fallbackSrc, failed);
  const useCustom = !!custom?.startsWith("https://") && source === custom;
  return <Image {...props} alt={alt} src={source} unoptimized={useCustom || props.unoptimized} onError={event => { if (useCustom) setFailed(custom!); onError?.(event); }} />;
}

export function AppearanceCover({ slot }: { slot: "men" | "women" | "unisex" }) {
  const appearance = usePublishedAppearance();
  const fallback = slot === "men" ? "/Berfumes%20Black_Men.png" : slot === "women" ? "/Berfumes%20Black_Women.png" : null;
  const [failed, setFailed] = useState("");
  const custom = appearance?.assets[slot];
  const source = publishedAssetSource(appearance, slot, fallback, failed);
  return <span className="entry-background" aria-hidden="true">{source && <Image src={source} alt="" fill sizes="(max-width: 760px) 100vw, 50vw" unoptimized onError={() => { if (source === custom) setFailed(source); }} />}</span>;
}
