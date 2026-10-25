import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma, ProductImage } from "../generated/prisma/client.js";
import { CloudinaryUploadFailure } from "./upload-error.js";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PRODUCT_IMAGES = 10;
export const ASSET_PREFIX = "black-perfumes/products/";
const TICKET_TTL = 5 * 60 * 1000;
const CLEANUP_GRACE = 15 * 60 * 1000;
const uuidPattern = "[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}";
const managedSuffix = new RegExp(`^${uuidPattern}/${uuidPattern}$`);
const ticketSchema = z.object({ productId: z.uuid(), publicId: z.string().max(255), size: z.number().int().min(1).max(MAX_IMAGE_BYTES), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), expiresAt: z.number().int() }).strict();
type UploadTicket = z.infer<typeof ticketSchema>;

export type CloudAsset = { public_id: string; secure_url: string; resource_type: string; type: string; format: string; bytes: number; width: number; height: number; created_at: string };
export type DirectUpload = { url: string; fields: Record<string, string> };
export interface ImageAssets {
  sign?(publicId: string): DirectUpload;
  upload(buffer: Buffer, publicId: string): Promise<CloudAsset>;
  get(publicId: string): Promise<CloudAsset | null>;
  list(cursor?: string, prefix?: string): Promise<{ resources: CloudAsset[]; next_cursor?: string }>;
  destroy(publicId: string): Promise<void>;
}
type ImageDatabase = { client: Prisma.TransactionClient; transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> };

export class ImageError extends Error {
  constructor(public status: number, message: string, public stage?: "upload" | "attachment", public code?: string, public providerStatus?: number) { super(message); }
}

export class ImageService {
  private sweeping = false;
  private cursor: string | undefined;
  constructor(private database: ImageDatabase, private assets: ImageAssets, private secret: string, private now = Date.now, private prefix = ASSET_PREFIX) {}

  private owns(publicId: string) {
    return publicId.startsWith(this.prefix) && managedSuffix.test(publicId.slice(this.prefix.length));
  }

  private mac(payload: string, sessionKey: string) {
    return createHmac("sha256", this.secret).update("black-perfumes-image-v1\0").update(sessionKey).update("\0").update(payload).digest();
  }
  async issue(productId: string, sessionKey: string, size: number, contentType: UploadTicket["contentType"]) {
    const images = await this.list(productId);
    if (images.length >= MAX_PRODUCT_IMAGES) throw new ImageError(409, "A product can have up to 10 images.");
    const claim = ticketSchema.parse({ productId, publicId: `${this.prefix}${productId}/${randomUUID()}`, size, contentType, expiresAt: this.now() + TICKET_TTL });
    const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
    return { ticket: `${payload}.${this.mac(payload, sessionKey).toString("base64url")}`, expiresAt: new Date(claim.expiresAt).toISOString(), maxBytes: MAX_IMAGE_BYTES };
  }
  authorize(productId: string, sessionKey: string, ticket: string) {
    if (ticket.length > 2000) throw new ImageError(403, "Invalid upload signature.");
    const parts = ticket.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new ImageError(403, "Invalid upload signature.");
    const received = Buffer.from(parts[1], "base64url");
    const expected = this.mac(parts[0], sessionKey);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new ImageError(403, "Invalid upload signature.");
    let claim: UploadTicket;
    try { claim = ticketSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString())); }
    catch { throw new ImageError(403, "Invalid upload signature."); }
    if (claim.productId !== productId || !this.owns(claim.publicId) || !claim.publicId.startsWith(`${this.prefix}${productId}/`)) throw new ImageError(403, "This upload belongs to a different product.");
    if (claim.expiresAt <= this.now()) throw new ImageError(410, "Upload signature expired. Select the image again.");
    return claim;
  }
  async list(productId: string) {
    const product = await this.database.client.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new ImageError(404, "Product not found.");
    return this.database.client.productImage.findMany({ where: { productId }, orderBy: { position: "asc" } });
  }
  private async lock(tx: Prisma.TransactionClient, productId: string) {
    const products = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Product" WHERE "id" = ${productId}::uuid FOR UPDATE`;
    if (!products.length) throw new ImageError(404, "Product not found.");
  }
  private async position(tx: Prisma.TransactionClient, productId: string, images: ProductImage[], order: string[]) {
    if (!images.length) return;
    // Move all positions out of the occupied range before assigning a new order.
    const offset = Math.max(...images.map((image) => image.position)) + 1;
    await tx.productImage.updateMany({ where: { productId }, data: { position: { increment: offset } } });
    for (const [position, id] of order.entries()) await tx.productImage.update({ where: { id, productId }, data: { position } });
  }
  async upload(productId: string, sessionKey: string, ticket: string, contentType: string, buffer: Buffer) {
    const claim = this.authorize(productId, sessionKey, ticket);
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp = buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
    if (buffer.length !== claim.size || buffer.length > MAX_IMAGE_BYTES || contentType !== claim.contentType ||
      !({ "image/jpeg": jpeg, "image/png": png, "image/webp": webp }[claim.contentType])) throw new ImageError(400, "Choose a valid JPEG, PNG, or WebP image up to 10 MB.");
    const current = await this.list(productId);
    if (current.some((image) => image.cloudinaryPublicId === claim.publicId)) return current;
    if (current.length >= MAX_PRODUCT_IMAGES) throw new ImageError(409, "A product can have up to 10 images.");
    let asset: CloudAsset;
    try { asset = await this.assets.upload(buffer, claim.publicId); }
    catch (error) {
      if (error instanceof CloudinaryUploadFailure) throw new ImageError(error.status, error.message, "upload", error.code, error.providerStatus);
      throw new ImageError(502, "The upload to Cloudinary failed. The image was not attached to the product. Please try again.", "upload", "CLOUDINARY_UPLOAD_FAILED");
    }
    return this.attachAsset(productId, claim, asset);
  }
  async directUpload(productId: string, sessionKey: string, ticket: string) {
    const claim = this.authorize(productId, sessionKey, ticket);
    if (!this.assets.sign) throw new ImageError(503, "Direct image uploads are not configured.", "upload");
    await this.list(productId);
    // A lost upload/attachment response must not cause a second asset or overwrite.
    const existing = await this.assets.get(claim.publicId);
    if (existing) return { uploaded: true as const };
    return { uploaded: false as const, ...this.assets.sign(claim.publicId) };
  }
  async attach(productId: string, sessionKey: string, ticket: string) {
    const claim = this.authorize(productId, sessionKey, ticket);
    const current = await this.list(productId);
    if (current.some(image => image.cloudinaryPublicId === claim.publicId)) return current;
    const asset = await this.assets.get(claim.publicId);
    if (!asset) throw new ImageError(409, "The uploaded image is not ready. Retry or refresh images.", "attachment");
    return this.attachAsset(productId, claim, asset);
  }
  private async attachAsset(productId: string, claim: UploadTicket, asset: CloudAsset) {
    const url = URL.canParse(asset.secure_url) ? new URL(asset.secure_url) : null;
    if (asset.public_id !== claim.publicId || asset.resource_type !== "image" || asset.type !== "upload" ||
      !["jpg", "jpeg", "png", "webp"].includes(asset.format) || !Number.isSafeInteger(asset.bytes) || asset.bytes > MAX_IMAGE_BYTES || asset.bytes < 1 ||
      !Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width < 1 || asset.height < 1 || asset.width > 2400 || asset.height > 2400 || url?.protocol !== "https:" || url.hostname !== "res.cloudinary.com") throw new ImageError(400, "Cloudinary returned an unsupported image.", "upload", "CLOUDINARY_INVALID_RESPONSE");
    try { return await this.database.transaction(async (tx) => {
      await this.lock(tx, productId);
      const images = await tx.productImage.findMany({ where: { productId }, orderBy: { position: "asc" } });
      if (images.some((image) => image.cloudinaryPublicId === claim.publicId)) return images;
      if (images.length >= MAX_PRODUCT_IMAGES) throw new ImageError(409, "A product can have up to 10 images.");
      await tx.productImage.create({ data: { productId, cloudinaryPublicId: claim.publicId, url: asset.secure_url, position: images.length ? Math.max(...images.map((image) => image.position)) + 1 : 0 } });
      return tx.productImage.findMany({ where: { productId }, orderBy: { position: "asc" } });
    }); } catch (error) {
      if (error instanceof ImageError) throw new ImageError(error.status, `The image reached Cloudinary, but could not be attached: ${error.message}`, "attachment", "IMAGE_ATTACHMENT_CONFLICT");
      throw new ImageError(503, "The image reached Cloudinary, but its attachment to this product could not be confirmed. Refresh images before retrying.", "attachment", "IMAGE_ATTACHMENT_FAILED");
    }
  }
  async reorder(productId: string, order: string[]) {
    return this.database.transaction(async (tx) => {
      await this.lock(tx, productId);
      const images = await tx.productImage.findMany({ where: { productId } });
      if (order.length !== images.length || new Set(order).size !== order.length || order.some((id) => !images.some((image) => image.id === id))) throw new ImageError(409, "Images changed. Refresh them and try again.");
      await this.position(tx, productId, images, order);
      return tx.productImage.findMany({ where: { productId }, orderBy: { position: "asc" } });
    });
  }
  async remove(productId: string, imageId: string) {
    const result = await this.database.transaction(async (tx) => {
      await this.lock(tx, productId);
      const image = await tx.productImage.findFirst({ where: { id: imageId, productId } });
      if (!image) throw new ImageError(404, "Image not found for this product.");
      await tx.productImage.delete({ where: { id: imageId, productId } });
      const images = await tx.productImage.findMany({ where: { productId }, orderBy: { position: "asc" } });
      await this.position(tx, productId, images, images.map((item) => item.id));
      return { publicId: image.cloudinaryPublicId, images: await tx.productImage.findMany({ where: { productId }, orderBy: { position: "asc" } }) };
    });
    // The transaction has committed before touching Cloudinary. The sweep retries failures.
    try { await this.cleanupOne(result.publicId); } catch { /* Retried by reconciliation. */ }
    return result.images;
  }
  async cleanupOne(publicId: string, candidate?: CloudAsset) {
    if (!this.owns(publicId) || await this.database.client.productImage.count({ where: { cloudinaryPublicId: publicId } })) return false;
    const asset = candidate ?? await this.assets.get(publicId);
    if (!asset || asset.public_id !== publicId || asset.resource_type !== "image" || asset.type !== "upload") return false;
    const createdAt = Date.parse(asset.created_at);
    // Old tickets must expire before deletion, including any in-flight upload/DB transaction.
    if (!Number.isFinite(createdAt) || createdAt > this.now() - CLEANUP_GRACE) return false;
    if (await this.database.client.productImage.count({ where: { cloudinaryPublicId: publicId } })) return false;
    await this.assets.destroy(publicId);
    return true;
  }
  async cleanupUnused() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (let page = 0; page < 20; page++) {
        const batch = await this.assets.list(this.cursor, this.prefix);
        for (const asset of batch.resources) await this.cleanupOne(asset.public_id, asset);
        this.cursor = batch.next_cursor;
        if (!this.cursor) break;
      }
    } finally { this.sweeping = false; }
  }
}
