import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma, WebsiteAppearance } from "../generated/prisma/client.js";
import type { CloudAsset, ImageAssets } from "../images/service.js";
import { MAX_IMAGE_BYTES } from "../images/service.js";
import { appearanceInput, initialAppearance, slots, staticAssets, themes, type AppearanceConfig, type AssetSlot } from "./config.js";

type Database = { client: Prisma.TransactionClient; transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> };
const claimInput = z.object({ id: z.uuid(), slot: z.enum(slots), publicId: z.string().max(255), expiresAt: z.number().int() }).strict();
export class AppearanceError extends Error { constructor(public status: number, message: string, public fields: Record<string, string[]> = {}) { super(message); } }
export class AppearanceService {
  constructor(private database: Database, private images: ImageAssets, private secret: string, private prefix: string, private cloudName: string, private now = Date.now) {}
  private async lock(tx: Prisma.TransactionClient) {
    await tx.websiteAppearance.upsert({ where: { id: 1 }, create: { id: 1, draft: initialAppearance, published: initialAppearance }, update: {} });
    await tx.$queryRaw`SELECT "id" FROM "WebsiteAppearance" WHERE "id" = 1 FOR UPDATE`;
    return tx.websiteAppearance.findUniqueOrThrow({ where: { id: 1 } });
  }
  private version(row: WebsiteAppearance, expected: number) {
    if (row.version !== expected) throw new AppearanceError(409, "Appearance changed. Reload before saving.");
  }
  private async validate(config: AppearanceConfig, tx: Prisma.TransactionClient) {
    const ids = slots.flatMap(slot => config.assets[slot] ? [config.assets[slot]!] : []);
    const assets = await tx.appearanceAsset.findMany({ where: { id: { in: ids }, deleting: false } });
    for (const slot of slots) {
      const id = config.assets[slot]; if (!id) continue;
      const asset = assets.find(asset => asset.id === id);
      if (!asset || asset.slot !== slot || asset.cloudinaryPublicId !== `${this.prefix}${slot}/${id}`) throw new AppearanceError(400, "Choose an owned branding image uploaded for this slot.");
    }
    return assets;
  }
  private async resolve(config: AppearanceConfig, tx: Prisma.TransactionClient, revision: number) {
    const assets = await this.validate(config, tx);
    return { themePreset: config.themePreset, tokens: themes[config.themePreset], revision,
      assets: Object.fromEntries(slots.map(slot => [slot, assets.find(asset => asset.id === config.assets[slot])?.url ?? staticAssets[slot]])) };
  }
  async published() {
    try {
      const row = await this.database.client.websiteAppearance.findUnique({ where: { id: 1 }, select: { published: true, publishedRevision: true } });
      return { appearance: await this.resolve(row ? appearanceInput.parse(row.published) : initialAppearance, this.database.client, row?.publishedRevision ?? 0), fallback: false };
    } catch {
      return { appearance: { themePreset: initialAppearance.themePreset, tokens: themes[initialAppearance.themePreset], assets: staticAssets, revision: 0 }, fallback: true };
    }
  }
  async admin() {
    return this.database.transaction(async tx => {
      const row = await this.lock(tx);
      return { draft: appearanceInput.parse(row.draft), published: appearanceInput.parse(row.published), version: row.version, publishedRevision: row.publishedRevision };
    });
  }
  async preview() {
    return this.database.transaction(async tx => { const row = await this.lock(tx); return this.resolve(appearanceInput.parse(row.draft), tx, row.publishedRevision); });
  }
  async save(config: AppearanceConfig, expected: number) {
    return this.database.transaction(async tx => {
      const row = await this.lock(tx); this.version(row, expected); await this.validate(config, tx);
      const next = await tx.websiteAppearance.update({ where: { id: 1 }, data: { draft: config, version: { increment: 1 } } });
      return { draft: appearanceInput.parse(next.draft), version: next.version };
    });
  }
  async publish(expected: number) {
    return this.database.transaction(async tx => {
      const row = await this.lock(tx); this.version(row, expected);
      const config = appearanceInput.parse(row.draft); const assets = await this.validate(config, tx);
      await Promise.all(assets.map(async asset => {
        const remote = await this.images.get(asset.cloudinaryPublicId);
        this.checkImage(remote, asset.cloudinaryPublicId, asset.slot as AssetSlot);
        if (remote!.secure_url !== asset.url) throw new AppearanceError(409, "A branding image changed. Upload it again before publishing.");
      }));
      const next = await tx.websiteAppearance.update({ where: { id: 1 }, data: { published: config, publishedAt: new Date(this.now()), publishedRevision: { increment: 1 }, version: { increment: 1 } } });
      return { published: await this.resolve(config, tx, next.publishedRevision), version: next.version };
    });
  }
  async discard(expected: number) {
    return this.database.transaction(async tx => {
      const row = await this.lock(tx); this.version(row, expected);
      const config = appearanceInput.parse(row.published); await this.validate(config, tx);
      const next = await tx.websiteAppearance.update({ where: { id: 1 }, data: { draft: config, version: { increment: 1 } } });
      return { draft: config, version: next.version };
    });
  }
  private mac(payload: string, session: string) { return createHmac("sha256", this.secret).update("appearance-v1\0" + session + "\0" + payload).digest(); }
  issue(slot: AssetSlot, session: string) {
    if (!this.images.sign) throw new AppearanceError(503, "Signed image uploads are not configured.");
    const id = randomUUID(); const publicId = `${this.prefix}${slot}/${id}`;
    const expiresAt = this.now() + 5 * 60_000;
    const payload = Buffer.from(JSON.stringify({ id, slot, publicId, expiresAt })).toString("base64url");
    return { ticket: `${payload}.${this.mac(payload, session).toString("base64url")}`, expiresAt, maxBytes: MAX_IMAGE_BYTES, ...this.images.sign(publicId) };
  }
  private claim(ticket: string, session: string) {
    const [payload, signature, extra] = ticket.split(".");
    if (ticket.length > 2000 || !payload || !signature || extra) throw new AppearanceError(403, "Invalid branding upload ticket.");
    const expected = this.mac(payload, session); const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppearanceError(403, "Invalid branding upload ticket.");
    let claim;
    try { claim = claimInput.parse(JSON.parse(Buffer.from(payload, "base64url").toString())); } catch { throw new AppearanceError(403, "Invalid branding upload ticket."); }
    if (claim.publicId !== `${this.prefix}${claim.slot}/${claim.id}`) throw new AppearanceError(403, "Invalid branding image ownership.");
    if (claim.expiresAt <= this.now()) throw new AppearanceError(410, "Branding upload ticket expired.");
    return claim;
  }
  private checkImage(asset: CloudAsset | null, publicId: string, slot: AssetSlot) {
    let url: URL | undefined;
    try { url = new URL(asset?.secure_url ?? ""); } catch { /* Invalid provider response. */ }
    if (!asset || asset.public_id !== publicId || asset.resource_type !== "image" || asset.type !== "upload" ||
      url?.protocol !== "https:" || url.username || url.password || url.hostname !== "res.cloudinary.com" || !url.pathname.startsWith(`/${this.cloudName}/image/upload/`)) throw new AppearanceError(400, "The uploaded branding image could not be verified.", { reason: ["asset-verification"] });
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_IMAGE_BYTES) throw new AppearanceError(400, "Branding images must be no larger than 10 MiB.", { reason: ["image-size"] });
    if (slot === "favicon") {
      if (asset.format !== "png") throw new AppearanceError(400, "Favicons must use PNG format. Check that the Cloudinary preset does not convert the format.", { reason: ["favicon-format"] });
      if (![asset.width, asset.height].every(Number.isSafeInteger) || asset.width !== asset.height || asset.width < 32 || asset.width > 512) throw new AppearanceError(400, "Favicons must be square and between 32 and 512 pixels.", { reason: ["favicon-dimensions"], width: [String(asset.width)], height: [String(asset.height)] });
    }
    if (!["jpg", "jpeg", "png", "webp"].includes(asset.format)) throw new AppearanceError(400, "Choose a JPEG, PNG, or WebP image.", { reason: ["image-type"] });
    if (![asset.width, asset.height].every(size => Number.isSafeInteger(size) && size > 0 && size <= 2400)) throw new AppearanceError(400, "Branding images must be no larger than 2400 pixels per side.", { reason: ["image-dimensions"] });
  }
  async attach(ticket: string, session: string) {
    const claim = this.claim(ticket, session); const remote = await this.images.get(claim.publicId);
    this.checkImage(remote, claim.publicId, claim.slot);
    return this.database.transaction(async tx => {
      await this.lock(tx);
      const existing = await tx.appearanceAsset.findUnique({ where: { id: claim.id } });
      if (existing?.deleting) throw new AppearanceError(409, "This branding image is being deleted.");
      return tx.appearanceAsset.upsert({ where: { id: claim.id }, create: { id: claim.id, slot: claim.slot, cloudinaryPublicId: claim.publicId, url: remote!.secure_url }, update: {} });
    });
  }
  async listAssets() { return this.database.client.appearanceAsset.findMany({ where: { deleting: false }, orderBy: { createdAt: "desc" }, take: 100 }); }
  async remove(id: string) {
    const asset = await this.database.transaction(async tx => {
      const row = await this.lock(tx); const asset = await tx.appearanceAsset.findUnique({ where: { id } });
      if (!asset || asset.cloudinaryPublicId !== `${this.prefix}${asset.slot}/${id}`) throw new AppearanceError(404, "Branding image not found.");
      if ([row.draft, row.published].some(config => Object.values(appearanceInput.parse(config).assets).includes(id))) throw new AppearanceError(409, "This image is still used by draft or published settings.");
      return tx.appearanceAsset.update({ where: { id }, data: { deleting: true } });
    });
    try { await this.images.destroy(asset.cloudinaryPublicId); }
    catch { throw new AppearanceError(503, "Image deletion is pending. Retry this deletion safely."); }
    await this.database.client.appearanceAsset.deleteMany({ where: { id, deleting: true } });
  }
}
