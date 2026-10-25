import { adminApi, ApiError, type ProductImage } from "./admin-api";

type UploadGrant = { uploaded: true } | { uploaded: false; url: string; fields: Record<string, string> };

export async function uploadProductImage(productId: string, file: File, ticket: string, progress: (value: number) => void, signal: AbortSignal): Promise<{ images: ProductImage[] }> {
  const grant = await adminApi<UploadGrant>(`/products/${productId}/images/direct-upload`, { method: "POST", body: { ticket }, signal });
  if (!grant.uploaded) await sendImage(grant, file, progress, signal);
  progress(100);
  try { return await adminApi<{ images: ProductImage[] }>(`/products/${productId}/images/attach`, { method: "POST", body: { ticket }, signal }); }
  catch (error) {
    if (error instanceof ApiError) throw new ApiError(error.status, error.message, error.fields, "attachment");
    throw error;
  }
}

function sendImage(grant: Extract<UploadGrant, { uploaded: false }>, file: File, progress: (value: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Upload cancelled", "AbortError")); return; }
    const target = new URL(grant.url);
    if (target.origin !== "https://api.cloudinary.com" || !/^\/v1_1\/[^/]+\/image\/upload$/.test(target.pathname)) {
      reject(new ApiError(502, "Unable to prepare a secure image upload.", {}, "upload")); return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener("abort", abort);
    xhr.open("POST", target.toString());
    // Only the signed image grant goes to Cloudinary; admin cookies stay same-origin.
    xhr.withCredentials = false;
    xhr.responseType = "json";
    xhr.timeout = 90_000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => {
      finish();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status, "Cloudinary could not accept this image. Check its format and size, then retry.", {}, "upload"));
    };
    xhr.onerror = () => { finish(); reject(new ApiError(0, "Image upload connection failed. Retry or refresh images.", {}, "upload")); };
    xhr.ontimeout = () => { finish(); reject(new ApiError(0, "Image upload timed out. Retry or refresh images.", {}, "upload")); };
    xhr.onabort = () => { finish(); reject(new DOMException("Upload cancelled", "AbortError")); };
    const form = new FormData();
    for (const [name, value] of Object.entries(grant.fields)) form.append(name, value);
    form.append("file", file);
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(form);
  });
}
