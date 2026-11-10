import { z } from "zod";

// Normalize retired bundled defaults during rolling web/API deployments.
const asset = z.preprocess(value => typeof value === "string" && /^\/Berfumes(?:%20| )Black_(?:logo\.png|Hero\.(?:jpg|png)|Men\.png|Women\.png)$/.test(value) ? null : value, z.string().refine(value => {
  if (["/favicon.ico", "/icon.png", "/apple-icon.png", "/brand/fragrance-fallback.svg"].includes(value)) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && url.hostname === "res.cloudinary.com"; } catch { return false; }
}).nullable());
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const appearanceResponse = z.object({
  revision: z.number().int().nonnegative(), themePreset: z.enum(["emerald-lab", "retro-vice", "midnight-luxury", "light-elegance"]),
  assets: z.object({ logo: asset, favicon: asset, hero: asset, men: asset, women: asset, unisex: asset }),
  tokens: z.object({ background: color, surface: color, raised: color, text: color, muted: color, border: color, accent: color, onAccent: color, hover: color, focus: color, disabled: color, disabledText: color }),
});
export type Appearance = z.infer<typeof appearanceResponse>;
