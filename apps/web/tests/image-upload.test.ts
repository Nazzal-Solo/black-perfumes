import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadProductImage } from "../src/lib/image-upload";
import { ApiError } from "../src/lib/admin-api";

test("10 MB image bytes go only to Cloudinary; grants and verified attachment use same-origin JSON", async () => {
  const originalFetch = globalThis.fetch; const originalXhr = globalThis.XMLHttpRequest;
  const calls: string[] = []; let sent = 0; let uploaded = false; let attachmentFails = false;
  class Upload {
    upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
    withCredentials = true; responseType = ""; timeout = 0; status = 201;
    onload?: () => void; onabort?: () => void; onerror?: () => void; ontimeout?: () => void;
    open(method: string, url: string) { assert.equal(method, "POST"); assert.equal(url, "https://api.cloudinary.com/v1_1/fixture/image/upload"); }
    abort() { this.onabort?.(); }
    send(body: FormData) {
      assert.equal(this.withCredentials, false); assert.equal(this.timeout, 90_000);
      assert.equal((body.get("file") as File).size, 10 * 1024 * 1024);
      assert.equal(body.get("signature"), "fixture-signature"); assert.equal(body.has("cookie"), false);
      sent++; uploaded = true; this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 }); queueMicrotask(() => this.onload?.());
    }
  }
  globalThis.XMLHttpRequest = Upload as unknown as typeof XMLHttpRequest;
  globalThis.fetch = async (input, init) => {
    const path = String(input); calls.push(path); assert.ok(path.startsWith("/api/admin/products/"));
    assert.equal(init?.credentials, "include"); assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { ticket: "fixture-ticket" });
    if (path.endsWith("/direct-upload")) return Response.json(uploaded ? { uploaded: true } : { uploaded: false, url: "https://api.cloudinary.com/v1_1/fixture/image/upload", fields: { signature: "fixture-signature" } });
    if (attachmentFails) return Response.json({ error: "Attachment pending", stage: "attachment" }, { status: 503 });
    return Response.json({ images: [{ id: "fixture-image" }] });
  };
  try {
    const file = new File([new Uint8Array(10 * 1024 * 1024)], "fixture.png", { type: "image/png" }); const progress: number[] = [];
    const first = await uploadProductImage("fixture", file, "fixture-ticket", value => progress.push(value), new AbortController().signal);
    assert.equal(first.images.length, 1); assert.ok(progress.includes(100)); assert.equal(sent, 1);
    attachmentFails = true;
    await assert.rejects(uploadProductImage("fixture", file, "fixture-ticket", () => {}, new AbortController().signal), error => error instanceof ApiError && error.stage === "attachment" && error.status === 503);
    attachmentFails = false;
    await uploadProductImage("fixture", file, "fixture-ticket", () => {}, new AbortController().signal);
    assert.equal(sent, 1, "Retry must reuse the existing Cloudinary asset"); assert.equal(calls.length, 6);
  } finally { globalThis.fetch = originalFetch; globalThis.XMLHttpRequest = originalXhr; }
});
