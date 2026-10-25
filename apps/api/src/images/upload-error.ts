export class CloudinaryUploadFailure extends Error {
  constructor(public status: number, message: string, public code: string, public providerStatus?: number) { super(message); }
}

const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
export function cloudinaryStatus(error: unknown): number | undefined {
  const outer = record(error);
  return [outer, record(outer.error), record(outer.cause)].map(value => value.http_code).find((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599);
}

export function cloudinaryUploadFailure(error: unknown): CloudinaryUploadFailure {
  const outer = record(error);
  const details = [outer, record(outer.error), record(outer.cause)];
  const status = cloudinaryStatus(error);
  const message = details.map((value) => typeof value.message === "string" ? value.message : "").join(" ");
  // Provider messages can contain signatures and account identifiers. Classify
  // them here; never return, retain, or log the original error.
  if (status === 401 || status === 403) {
    const mismatch = /cloud(?:_name| name)[^.\n]*mismatch/i.test(message);
    return new CloudinaryUploadFailure(502,
      mismatch ? "Cloudinary rejected the cloud name for this API key. Verify the server configuration and restart the API." : "Cloudinary rejected the upload credentials or signature. Verify the server configuration and restart the API.",
      mismatch ? "CLOUDINARY_CLOUD_MISMATCH" : "CLOUDINARY_AUTH_FAILED", status);
  }
  if (status === 420 || status === 429) return new CloudinaryUploadFailure(503, "Cloudinary is busy. Please try uploading again later.", "CLOUDINARY_RATE_LIMITED", status);
  if (status === 499 || /timeout|timed? ?out/i.test(message)) return new CloudinaryUploadFailure(504, "Cloudinary did not finish processing the image in time. Refresh images before retrying.", "CLOUDINARY_TIMEOUT", status);
  if (status === 400 && /invalid image|image file|corrupt|unsupported.*format|format.*not allowed/i.test(message)) return new CloudinaryUploadFailure(422, "Cloudinary could not decode this image. Choose a different valid JPEG, PNG, or WebP file.", "CLOUDINARY_INVALID_IMAGE", status);
  return new CloudinaryUploadFailure(502, "The upload to Cloudinary failed. The image was not attached to the product. Please try again.", "CLOUDINARY_UPLOAD_FAILED", status);
}
