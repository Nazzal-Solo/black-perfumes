import { z } from "zod";

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
export type Appearance = z.infer<typeof appearanceResponse>;
