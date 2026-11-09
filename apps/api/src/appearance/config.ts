import { z } from "zod";
export const slots = ["logo", "favicon", "hero", "men", "women", "unisex"] as const;
export type AssetSlot = typeof slots[number];
export const presets = ["emerald-lab", "retro-vice", "midnight-luxury", "light-elegance"] as const;
export const appearanceInput = z.object({
  themePreset: z.enum(presets),
  assets: z.object({ logo: z.uuid().nullable(), favicon: z.uuid().nullable(), hero: z.uuid().nullable(), men: z.uuid().nullable(), women: z.uuid().nullable(), unisex: z.uuid().nullable() }).strict(),
}).strict();
export type AppearanceConfig = z.infer<typeof appearanceInput>;
export const initialAppearance: AppearanceConfig = { themePreset: "emerald-lab", assets: { logo: null, favicon: null, hero: null, men: null, women: null, unisex: null } };
export const staticAssets: Record<AssetSlot, string | null> = { logo: "/Berfumes%20Black_logo.png", favicon: "/favicon.ico", hero: "/Berfumes%20Black_Hero.jpg", men: "/Berfumes%20Black_Men.png", women: "/Berfumes%20Black_Women.png", unisex: null };
const tokens = (background: string, surface: string, raised: string, text: string, muted: string, border: string, accent: string, onAccent: string, hover: string, focus: string, disabled: string, disabledText: string) => ({ background, surface, raised, text, muted, border, accent, onAccent, hover, focus, disabled, disabledText });
export const themes = {
  "emerald-lab": tokens("#090D0B", "#152B20", "#203D2C", "#F0EDE5", "#A9C9B2", "#6F8B78", "#A9C9B2", "#090D0B", "#C4E4CE", "#C4E4CE", "#82988A", "#090D0B"),
  "retro-vice": tokens("#151026", "#241C3A", "#35284D", "#FFF4E4", "#E2C2F3", "#A58AB8", "#F4A9D5", "#22112B", "#FFD0EA", "#6EE7E0", "#B6A0C4", "#22112B"),
  "midnight-luxury": tokens("#0B0D12", "#191C23", "#292D36", "#F1F2F5", "#BAC0CF", "#798397", "#CFD6E4", "#11141A", "#EEF1F7", "#D7E4FF", "#9198A6", "#11141A"),
  "light-elegance": tokens("#F5F2EB", "#FFFFFF", "#EAE4D8", "#171F1A", "#47594D", "#718476", "#214F37", "#FFFFFF", "#163D29", "#285C43", "#CDD7CD", "#324338"),
};
