import { adminApiUrl, ApiError, type ProductImage } from "./admin-api";

export function uploadProductImage(productId: string, file: File, ticket: string, progress: (value: number) => void, signal: AbortSignal): Promise<{ images: ProductImage[] }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Upload cancelled", "AbortError")); return; }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener("abort", abort);
    xhr.open("POST", adminApiUrl(`/products/${productId}/images/upload`));
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.timeout = 90_000;
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("X-Upload-Signature", ticket);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => {
      finish();
      const body = xhr.response as { error?: string; images?: ProductImage[]; stage?: "upload" | "attachment" } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.images) resolve({ images: body.images });
      else reject(new ApiError(xhr.status, body?.error ?? "Image upload failed. Refresh the images before trying again.", {}, body?.stage));
    };
    xhr.onerror = () => { finish(); reject(new ApiError(0, "Upload connection failed. Refresh the images before trying again.")); };
    xhr.ontimeout = () => { finish(); reject(new ApiError(0, "Upload timed out. Refresh the images before trying again.")); };
    xhr.onabort = () => { finish(); reject(new DOMException("Upload cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(file);
  });
}
