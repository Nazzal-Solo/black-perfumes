import { z } from "zod";
import { adminApi, ApiError } from "./admin-api";
import { sendImage } from "./image-upload";
import { appearanceResponse, type Appearance } from "./appearance";

export const brandingSlots = ["logo", "hero", "men", "women", "unisex", "favicon"] as const;
export const themePresets = ["emerald-lab", "retro-vice", "midnight-luxury", "light-elegance"] as const;
export type BrandingSlot = typeof brandingSlots[number];
export const defaultBranding: Record<BrandingSlot, string | null> = { logo: "/Berfumes%20Black_logo.png", hero: "/Berfumes%20Black_Hero.jpg", men: "/Berfumes%20Black_Men.png", women: "/Berfumes%20Black_Women.png", unisex: null, favicon: "/favicon.ico" };
export const appearanceConfig = z.object({ themePreset: z.enum(themePresets), assets: z.object({ logo: z.uuid().nullable(), hero: z.uuid().nullable(), men: z.uuid().nullable(), women: z.uuid().nullable(), unisex: z.uuid().nullable(), favicon: z.uuid().nullable() }).strict() }).strict();
export type AppearanceConfig = z.infer<typeof appearanceConfig>;
export const appearanceState = z.object({ draft: appearanceConfig, published: appearanceConfig, version: z.number().int().nonnegative(), publishedRevision: z.number().int().nonnegative() });
export type AppearanceState = z.infer<typeof appearanceState>;
const ownedAsset = z.object({ id: z.uuid(), slot: z.enum(brandingSlots), url: z.string().refine(value => { try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && !url.username && !url.password; } catch { return false; } }) });
export type BrandingAsset = z.infer<typeof ownedAsset>;
export type ThemeTokens = Appearance["tokens"];
export type ThemePresets = Record<AppearanceConfig["themePreset"], ThemeTokens>;
export function sameAppearance(a: AppearanceConfig, b: AppearanceConfig) { return a.themePreset === b.themePreset && brandingSlots.every(slot => a.assets[slot] === b.assets[slot]); }
export function brandingUrl(config: AppearanceConfig, assets: BrandingAsset[], slot: BrandingSlot) { const id = config.assets[slot]; return id ? assets.find(asset => asset.id === id && asset.slot === slot)?.url ?? null : defaultBranding[slot]; }
export async function loadAppearance(signal?: AbortSignal) {
  const [state, themes, assets] = await Promise.all([adminApi("/appearance", { signal }), adminApi("/appearance/themes", { signal }), adminApi("/appearance/assets", { signal })]);
  const themeInput = z.object({ presets: z.object({ "emerald-lab": appearanceResponse.shape.tokens, "retro-vice": appearanceResponse.shape.tokens, "midnight-luxury": appearanceResponse.shape.tokens, "light-elegance": appearanceResponse.shape.tokens }) });
  return { state: appearanceState.parse(state), themes: themeInput.parse(themes).presets, assets: z.object({ assets: z.array(ownedAsset) }).parse(assets).assets };
}
export async function saveAppearance(config: AppearanceConfig, version: number, signal?: AbortSignal) {
  return z.object({ draft: appearanceConfig, version: z.number().int() }).parse(await adminApi("/appearance/draft", { method: "PUT", body: { config: appearanceConfig.parse(config), expectedVersion: version }, signal }));
}
export async function publishAppearance(version: number, signal?: AbortSignal) {
  return z.object({ published: appearanceResponse, version: z.number().int() }).parse(await adminApi("/appearance/publish", { method: "POST", body: { expectedVersion: version }, signal }));
}
export async function discardAppearance(version: number, signal?: AbortSignal) {
  return z.object({ draft: appearanceConfig, version: z.number().int() }).parse(await adminApi("/appearance/discard", { method: "POST", body: { expectedVersion: version }, signal }));
}
export async function previewAppearance(signal?: AbortSignal) { return appearanceResponse.parse(await adminApi("/appearance/preview", { signal })); }
export type BrandingUpload = { file: File; grant?: { ticket: string; expiresAt: number; url: string; fields: Record<string, string> }; uploaded?: boolean };
export function validBrandingFile(file: File, slot: BrandingSlot) { return file.size > 0 && file.size <= 10 * 1024 * 1024 && (slot === "favicon" ? file.type === "image/png" : ["image/jpeg", "image/png", "image/webp"].includes(file.type)); }
export async function uploadBranding(slot: BrandingSlot, task: BrandingUpload, progress: (value: number) => void, signal: AbortSignal) {
  if (!validBrandingFile(task.file, slot)) throw new ApiError(400, "Invalid branding image.");
  if (task.grant && task.grant.expiresAt <= Date.now()) throw new ApiError(410, "Upload ticket expired.");
  if (!task.grant) task.grant = z.object({ ticket: z.string(), expiresAt: z.number(), url: z.url(), fields: z.record(z.string(), z.string()) }).parse(await adminApi("/appearance/assets/signature", { method: "POST", body: { slot, size: task.file.size, contentType: task.file.type }, signal }));
  if (!task.uploaded) { await sendImage(task.grant, task.file, progress, signal); task.uploaded = true; }
  progress(100);
  const asset = z.object({ asset: ownedAsset }).parse(await adminApi("/appearance/assets/attach", { method: "POST", body: { ticket: task.grant.ticket }, signal })).asset;
  if (asset.slot !== slot) throw new ApiError(400, "Invalid branding image slot.");
  return asset;
}
