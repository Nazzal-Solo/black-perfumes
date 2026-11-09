import assert from "node:assert/strict";
import { test } from "node:test";
import { sameAppearance, brandingUrl, validBrandingFile, loadAppearance, saveAppearance, previewAppearance, publishAppearance, discardAppearance, uploadBranding, defaultBranding, type AppearanceConfig, type BrandingUpload } from "../src/lib/appearance-admin";
import { ApiError } from "../src/lib/admin-api";
const id = "00000000-0000-4000-8000-000000000001";
const config: AppearanceConfig = { themePreset: "emerald-lab", assets: { logo: null, hero: null, men: null, women: null, unisex: null, favicon: null } };
const tokens = { background: "#090D0B", surface: "#152B20", raised: "#203D2C", text: "#F0EDE5", muted: "#A9C9B2", border: "#6F8B78", accent: "#A9C9B2", onAccent: "#090D0B", hover: "#C4E4CE", focus: "#C4E4CE", disabled: "#82988A", disabledText: "#090D0B" };
const resolved = { themePreset: "emerald-lab", assets: defaultBranding, tokens, revision: 0 };

test("dirty comparison covers all branding fields and removal restores defaults without deleting assets", () => {
  assert.ok(sameAppearance(config, structuredClone(config))); assert.ok(!sameAppearance(config, { ...config, themePreset: "light-elegance" }));
  for (const slot of Object.keys(config.assets) as (keyof AppearanceConfig["assets"])[]) { assert.ok(!sameAppearance(config, { ...config, assets: { ...config.assets, [slot]: id } })); assert.equal(brandingUrl(config, [], slot), defaultBranding[slot]); }
  assert.equal(brandingUrl({ ...config, assets: { ...config.assets, logo: id } }, [], "logo"), null);
});

test("draft, preview, publish and discard use existing same-origin APIs with explicit version guards", async () => {
  const original = globalThis.fetch; const calls: { path: string; method: string; body: unknown }[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input); assert.ok(path.startsWith("/api/admin/appearance")); assert.equal(init?.credentials, "include"); calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path.endsWith("/themes")) return Response.json({ presets: { "emerald-lab": tokens, "retro-vice": tokens, "midnight-luxury": tokens, "light-elegance": tokens } });
    if (path.endsWith("/assets")) return Response.json({ assets: [] });
    if (path.endsWith("/preview")) return Response.json(resolved);
    if (path.endsWith("/publish")) return Response.json({ published: { ...resolved, revision: 1 }, version: 2 });
    if (path.endsWith("/draft") || path.endsWith("/discard")) return Response.json({ draft: config, version: 1 });
    return Response.json({ draft: config, published: config, version: 0, publishedRevision: 0 });
  };
  try {
    assert.deepEqual((await loadAppearance()).state.draft, config); assert.equal(calls.length, 3);
    await saveAppearance(config, 0); await previewAppearance(); assert.ok(!calls.some(call => call.path.endsWith("/publish")));
    assert.deepEqual(calls.find(call => call.path.endsWith("/draft"))?.body, { config, expectedVersion: 0 });
    await publishAppearance(1); assert.deepEqual(calls.find(call => call.path.endsWith("/publish"))?.body, { expectedVersion: 1 });
    await discardAppearance(2); assert.deepEqual(calls.find(call => call.path.endsWith("/discard"))?.body, { expectedVersion: 2 }); assert.ok(!calls.some(call => call.method === "DELETE"));
  } finally { globalThis.fetch = original; }
});

test("conflicts and expired sessions propagate without automatic overwrite", async () => {
  const original = globalThis.fetch; let calls = 0;
  try { for (const status of [401, 409]) { globalThis.fetch = async () => { calls++; return Response.json({ error: "fixture" }, { status }); }; await assert.rejects(saveAppearance(config, 1), error => error instanceof ApiError && error.status === status); } assert.equal(calls, 2); }
  finally { globalThis.fetch = original; }
});

test("secure branding upload retries attachment without repeating upload or publishing", async () => {
  const original = globalThis.fetch; const originalXhr = globalThis.XMLHttpRequest; let uploads = 0; let signatures = 0; let attachments = 0;
  class Upload {
    upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
    withCredentials = true; responseType = ""; timeout = 0; status = 200; onload?: () => void; onabort?: () => void;
    open(method: string, url: string) { assert.equal(method, "POST"); assert.equal(url, "https://api.cloudinary.com/v1_1/fixture/image/upload"); }
    abort() { this.onabort?.(); }
    send(body: FormData) { uploads++; assert.equal(this.withCredentials, false); assert.equal(body.get("signature"), "fixture"); assert.ok(body.get("file") instanceof File); this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 }); queueMicrotask(() => this.onload?.()); }
  }
  globalThis.XMLHttpRequest = Upload as unknown as typeof XMLHttpRequest;
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.credentials, "include"); const path = String(input);
    if (path.endsWith("/signature")) { signatures++; assert.deepEqual(JSON.parse(String(init?.body)), { slot: "logo", size: 10, contentType: "image/png" }); return Response.json({ ticket: "fixture-ticket", expiresAt: Date.now() + 300000, url: "https://api.cloudinary.com/v1_1/fixture/image/upload", fields: { signature: "fixture" } }); }
    assert.equal(path, "/api/admin/appearance/assets/attach"); assert.deepEqual(JSON.parse(String(init?.body)), { ticket: "fixture-ticket" }); attachments++;
    return attachments === 1 ? Response.json({ error: "pending" }, { status: 503 }) : Response.json({ asset: { id, slot: "logo", url: "https://res.cloudinary.com/fixture/image/upload/logo.png" } });
  };
  try {
    const task: BrandingUpload = { file: new File([new Uint8Array(10)], "logo.png", { type: "image/png" }) };
    await assert.rejects(uploadBranding("logo", task, () => {}, new AbortController().signal), ApiError); assert.equal(task.uploaded, true);
    assert.equal((await uploadBranding("logo", task, () => {}, new AbortController().signal)).id, id); assert.equal(signatures, 1); assert.equal(uploads, 1); assert.equal(attachments, 2);
    task.grant!.expiresAt = 0; await assert.rejects(uploadBranding("logo", task, () => {}, new AbortController().signal), error => error instanceof ApiError && error.status === 410);
  } finally { globalThis.fetch = original; globalThis.XMLHttpRequest = originalXhr; }
});

test("file selection enforces existing limits and PNG-only favicon validation", () => {
  const file = (type: string, size: number) => new File([new Uint8Array(size)], "fixture", { type });
  assert.ok(validBrandingFile(file("image/png", 10 * 1024 * 1024), "logo")); assert.equal(validBrandingFile(file("image/png", 10 * 1024 * 1024 + 1), "hero"), false);
  assert.equal(validBrandingFile(file("image/svg+xml", 10), "logo"), false); assert.equal(validBrandingFile(file("image/jpeg", 10), "favicon"), false); assert.equal(validBrandingFile(file("image/png", 0), "unisex"), false);
});
