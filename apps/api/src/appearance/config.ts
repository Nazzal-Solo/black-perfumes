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
export const staticAssets: Record<AssetSlot, string | null> = { logo: null, favicon: "/icon.png", hero: null, men: null, women: null, unisex: null };
const tokens = (background: string, surface: string, raised: string, text: string, muted: string, border: string, accent: string, onAccent: string, hover: string, focus: string, disabled: string, disabledText: string) => ({ background, surface, raised, text, muted, border, accent, onAccent, hover, focus, disabled, disabledText });
export const themes = {
  "emerald-lab": tokens("#090D0B", "#111A15", "#1A2921", "#F0EDE5", "#A9BBAF", "#647B6C", "#24563E", "#F0EDE5", "#2E654A", "#A9C9B2", "#26372F", "#ADBCB2"),
  "retro-vice": tokens("#15101D", "#211928", "#302438", "#F6F1F5", "#C8B6CE", "#78657F", "#A96F93", "#130E18", "#BE8AAA", "#D8B8D0", "#49394D", "#D9C9DB"),
  "midnight-luxury": tokens("#0D1015", "#171C24", "#242C37", "#F3F5F7", "#B3BDC9", "#68788A", "#46617E", "#FFFFFF", "#56718D", "#B2C4D8", "#344252", "#D3DCE6"),
  "light-elegance": tokens("#FFFFFF", "#FFFFFF", "#F7F7F7", "#171717", "#737373", "#E5E5E5", "#171717", "#FFFFFF", "#333333", "#525252", "#E5E5E5", "#525252"),
};
