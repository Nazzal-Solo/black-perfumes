import { cloudinary } from "../config/cloudinary.js";
import { env } from "../config/env.js";
import { ImageError } from "./service.js";
import { ASSET_PREFIX, type CloudAsset, type ImageAssets } from "./service.js";
import { cloudinaryStatus, cloudinaryUploadFailure } from "./upload-error.js";

export const cloudinaryAssets: ImageAssets = {
  sign(publicId) {
    if (!env.CLOUDINARY_UPLOAD_PRESET) throw new ImageError(503, "Image uploads need a configured signed Cloudinary upload preset.", "upload");
    // Cloudinary signatures last one hour; backdating leaves five minutes to upload.
    const fields = {
      public_id: publicId, timestamp: String(Math.floor(Date.now() / 1000) - 55 * 60),
      upload_preset: env.CLOUDINARY_UPLOAD_PRESET, overwrite: "false", type: "upload",
      allowed_formats: "jpg,png,webp", transformation: "c_limit,h_2400,w_2400",
    };
    return {
      url: `https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME)}/image/upload`,
      fields: { ...fields, api_key: env.CLOUDINARY_API_KEY, signature: cloudinary.utils.api_sign_request(fields, env.CLOUDINARY_API_SECRET) },
    };
  },
  upload(buffer, publicId) {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({
        public_id: publicId, resource_type: "image", type: "upload", overwrite: false,
        allowed_formats: ["jpg", "png", "webp"],
        transformation: [{ width: 2400, height: 2400, crop: "limit" }], timeout: 60_000,
      }, (error, result) => {
        if (error || !result) reject(cloudinaryUploadFailure(error));
        else resolve(result as CloudAsset);
      }).end(buffer);
    });
  },
  async get(publicId) {
    try { return await cloudinary.api.resource(publicId, { resource_type: "image", type: "upload", timeout: 10_000 }) as CloudAsset; }
    catch (error) {
      if (cloudinaryStatus(error) === 404) return null;
      throw new Error("Cloudinary lookup failed");
    }
  },
  async list(cursor, prefix = ASSET_PREFIX) {
    return cloudinary.api.resources({ type: "upload", resource_type: "image", prefix, max_results: 100, ...(cursor ? { next_cursor: cursor } : {}) }) as Promise<{ resources: CloudAsset[]; next_cursor?: string }>;
  },
  async destroy(publicId) {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: "image", type: "upload", invalidate: true });
    if (result.result !== "ok" && result.result !== "not found") throw new Error("Cloudinary deletion failed");
  },
};
