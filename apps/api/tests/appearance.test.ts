import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import express from "express";
import type { Prisma, WebsiteAppearance, AppearanceAsset } from "../src/generated/prisma/client.js";
import type { AuthStore } from "../src/auth/store.js";
import { AppearanceService, AppearanceError } from "../src/appearance/service.js";
import { appearanceInput, initialAppearance, staticAssets, themes, slots, type AssetSlot } from "../src/appearance/config.js";
import { createAppearanceRouters } from "../src/appearance/routes.js";
import { MAX_IMAGE_BYTES, type CloudAsset, type ImageAssets } from "../src/images/service.js";

function harness() {
  let row: WebsiteAppearance = { id: 1, draft: structuredClone(initialAppearance), published: structuredClone(initialAppearance), version: 0, publishedRevision: 0, publishedAt: new Date(), updatedAt: new Date() };
  const assets = new Map<string, AppearanceAsset>(); const cloud = new Map<string, CloudAsset>(); const deleted: string[] = [];
  let now = Date.now(); let destroyFails = false; let readFails = false;
  type Change = { draft?: Prisma.JsonValue; published?: Prisma.JsonValue; version?: { increment: number }; publishedRevision?: { increment: number }; publishedAt?: Date };
  const client = {
    websiteAppearance: {
      async upsert() { return row; }, async findUnique() { if (readFails) throw Error("unavailable"); return row; }, async findUniqueOrThrow() { return row; },
      async update({ data }: { data: Change }) { row = { ...row, ...(data.draft ? { draft: structuredClone(data.draft) } : {}), ...(data.published ? { published: structuredClone(data.published) } : {}), version: row.version + (data.version?.increment ?? 0), publishedRevision: row.publishedRevision + (data.publishedRevision?.increment ?? 0), publishedAt: data.publishedAt ?? row.publishedAt }; return row; },
    },
    appearanceAsset: {
      async findMany({ where }: { where: { id?: { in: string[] }; deleting?: boolean } }) { return [...assets.values()].filter(asset => (!where.id || where.id.in.includes(asset.id)) && (where.deleting === undefined || asset.deleting === where.deleting)); },
      async findUnique({ where }: { where: { id: string } }) { return assets.get(where.id) ?? null; },
      async upsert({ where, create }: { where: { id: string }; create: Omit<AppearanceAsset, "createdAt" | "deleting"> }) { if (!assets.has(where.id)) assets.set(where.id, { ...create, createdAt: new Date(), deleting: false }); return assets.get(where.id)!; },
      async update({ where, data }: { where: { id: string }; data: { deleting: boolean } }) { const asset = assets.get(where.id)!; asset.deleting = data.deleting; return asset; },
      async deleteMany({ where }: { where: { id: string; deleting: boolean } }) { if (assets.get(where.id)?.deleting === where.deleting) assets.delete(where.id); return { count: 1 }; },
    },
    async $queryRaw() { return [{ id: 1 }]; },
  } as unknown as Prisma.TransactionClient;
  let queue = Promise.resolve();
  const database = { client, async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const previous = queue; let release!: () => void; queue = new Promise<void>(resolve => { release = resolve; }); await previous;
    const before = structuredClone(row); const beforeAssets = structuredClone(assets);
    try { return await work(client); } catch (error) { row = before; assets.clear(); for (const [id, asset] of beforeAssets) assets.set(id, asset); throw error; } finally { release(); }
  } };
  const gateway: ImageAssets = {
    sign(publicId) { return { url: "https://api.cloudinary.com/v1_1/fixture/image/upload", fields: { public_id: publicId, signature: "fixture-signature" } }; },
    async upload() { throw Error("binary uploads must bypass the BFF"); }, async get(id) { return cloud.get(id) ?? null; }, async list() { return { resources: [...cloud.values()] }; },
    async destroy(id) { if (destroyFails) throw Error("provider failure"); deleted.push(id); cloud.delete(id); },
  };
  const create = () => new AppearanceService(database, gateway, "fixture-secret", "black-perfumes/fixture/appearance/", "fixture", () => now);
  const service = create();
  function upload(slot: AssetSlot, session = "fixture-session") {
    const issued = service.issue(slot, session); const publicId = issued.fields.public_id!;
    const asset: CloudAsset = { public_id: publicId, secure_url: `https://res.cloudinary.com/fixture/image/upload/v1/${publicId}.png`, resource_type: "image", type: "upload", format: "png", bytes: 1000, width: 128, height: 128, created_at: new Date(now).toISOString() };
    cloud.set(publicId, asset); return { ...issued, remote: asset };
  }
  return { service, create, assets, cloud, deleted, upload, get row() { return row; }, advance() { now += 300_001; }, failDeletion(value: boolean) { destroyFails = value; }, failRead() { readFails = true; } };
}
const status = (code: number) => (error: unknown) => error instanceof AppearanceError && error.status === code;

test("persistent drafts, isolated preview/public reads, explicit publish, optimistic concurrency and discard", async () => {
  const h = harness(); const issued = h.upload("logo"); const asset = await h.service.attach(issued.ticket, "fixture-session");
  const initial = await h.service.published(); assert.deepEqual(initial.appearance.assets, staticAssets); assert.equal(initial.appearance.themePreset, "emerald-lab");
  const config = structuredClone(initialAppearance); config.themePreset = "retro-vice"; config.assets.logo = asset.id;
  await h.service.save(config, 0);
  assert.deepEqual((await h.create().admin()).draft, config, "Draft survives service reconstruction");
  assert.equal((await h.service.preview()).assets.logo, asset.url); assert.equal((await h.service.published()).appearance.themePreset, "emerald-lab");
  await assert.rejects(h.service.publish(0), status(409)); await h.service.publish(1);
  assert.equal((await h.service.published()).appearance.themePreset, "retro-vice"); assert.equal(h.row.publishedRevision, 1);
  await h.service.save({ ...config, themePreset: "light-elegance" }, 2); await h.service.discard(3);
  assert.deepEqual((await h.service.admin()).draft, config); assert.equal(h.row.publishedRevision, 1);
  const results = await Promise.allSettled([h.service.save(config, 4), h.service.save(config, 4)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
});

test("branding references cannot bypass URL, ownership, slot, image size/format, favicon, session or expiry validation", async () => {
  const h = harness();
  assert.equal(appearanceInput.safeParse({ ...initialAppearance, assets: { ...initialAppearance.assets, logo: "https://evil.test/logo.png" } }).success, false);
  assert.equal(appearanceInput.safeParse({ ...initialAppearance, themePreset: "custom-css" }).success, false);
  const issued = h.upload("logo"); await assert.rejects(h.service.attach(issued.ticket, "different-session"), status(403));
  for (const invalid of [{ bytes: MAX_IMAGE_BYTES + 1 }, { resource_type: "video" }, { secure_url: "https://evil.test/logo.png" }, { secure_url: "https://res.cloudinary.com/other/image/upload/logo.png" }, { format: "svg" }, { width: 2401 }]) {
    h.cloud.set(issued.remote.public_id, { ...issued.remote, ...invalid }); await assert.rejects(h.service.attach(issued.ticket, "fixture-session"), status(400));
  }
  h.cloud.set(issued.remote.public_id, issued.remote); const asset = await h.service.attach(issued.ticket, "fixture-session");
  const config = structuredClone(initialAppearance); config.assets.hero = asset.id; await assert.rejects(h.service.save(config, 0), status(400));
  config.assets.hero = randomUUID(); await assert.rejects(h.service.save(config, 0), status(400));
  config.assets.hero = asset.id; h.assets.get(asset.id)!.cloudinaryPublicId = "black-perfumes/products/unrelated"; await assert.rejects(h.service.save(config, 0), status(400));
  const icon = h.upload("favicon"); h.cloud.set(icon.remote.public_id, { ...icon.remote, width: 129 }); await assert.rejects(h.service.attach(icon.ticket, "fixture-session"), status(400));
  h.advance(); await assert.rejects(h.service.attach(icon.ticket, "fixture-session"), status(410));
});

test("deletion protects both configurations, commits tombstones before provider deletion and safely retries failures", async () => {
  const h = harness(); const issued = h.upload("hero"); const asset = await h.service.attach(issued.ticket, "fixture-session");
  assert.equal((await h.service.attach(issued.ticket, "fixture-session")).id, asset.id, "Attachment retry is idempotent");
  const config = structuredClone(initialAppearance); config.assets.hero = asset.id; await h.service.save(config, 0);
  await assert.rejects(h.service.remove(asset.id), status(409)); await h.service.publish(1);
  await h.service.save(initialAppearance, 2); await assert.rejects(h.service.remove(asset.id), status(409));
  assert.equal(h.deleted.length, 0); await h.service.publish(3);
  h.failDeletion(true); await assert.rejects(h.service.remove(asset.id), status(503)); assert.equal(h.assets.get(asset.id)?.deleting, true);
  await assert.rejects(h.service.save(config, 4), status(400)); h.failDeletion(false); await h.service.remove(asset.id);
  assert.deepEqual(h.deleted, [issued.remote.public_id]); assert.equal(h.assets.size, 0);
});

test("publishing revalidates provider images and unavailable public settings fall back without draft leakage", async () => {
  const h = harness(); const issued = h.upload("men"); const asset = await h.service.attach(issued.ticket, "fixture-session");
  const config = structuredClone(initialAppearance); config.assets.men = asset.id; await h.service.save(config, 0); h.cloud.delete(issued.remote.public_id);
  await assert.rejects(h.service.publish(1), status(400)); assert.equal(h.row.publishedRevision, 0);
  h.failRead(); const fallback = await h.service.published(); assert.equal(fallback.fallback, true); assert.deepEqual(fallback.appearance.assets, staticAssets);
});

test("appearance endpoints preserve auth/origin protections and expose only published settings", async () => {
  const h = harness(); const token = "a".repeat(64); const origin = "https://shop.example.test";
  const store: AuthStore = { async attemptLogin() { throw Error("not used"); }, async createSession() {}, async revokeSession() {}, async findSession(hash) { return hash === createHash("sha256").update(token).digest("hex") ? { admin: { id: 1, email: "fixture@example.test" }, expiresAt: new Date(Date.now() + 60_000) } : null; } };
  const app = express(); app.set("trust proxy", 1); app.use(express.json()); const routers = createAppearanceRouters(h.service, store, { production: true, origins: [origin] });
  app.use("/api", routers.publicRouter); app.use("/api/admin", routers.adminRouter);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
  const headers = { Cookie: `__Host-bp_admin=${token}`, Origin: origin, "Content-Type": "application/json", "X-Forwarded-Proto": "https" };
  try {
    for (const path of ["", "/preview", "/themes", "/assets"]) assert.equal((await fetch(base + "/api/admin/appearance" + path, { headers: { "X-Forwarded-Proto": "https" } })).status, 401);
    for (const source of ["", "https://evil.test"]) assert.equal((await fetch(base + "/api/admin/appearance/publish", { method: "POST", headers: { ...headers, Origin: source }, body: '{"expectedVersion":0}' })).status, 403);
    for (const invalid of [{ slot: "logo", size: MAX_IMAGE_BYTES + 1, contentType: "image/png" }, { slot: "favicon", size: 100, contentType: "image/jpeg" }, { slot: "hero", size: 100, contentType: "image/svg+xml" }]) {
      assert.equal((await fetch(base + "/api/admin/appearance/assets/signature", { method: "POST", headers, body: JSON.stringify(invalid) })).status, 400);
    }
    const oversizedIcon = h.upload("favicon", createHash("sha256").update(token).digest("hex"));
    h.cloud.set(oversizedIcon.remote.public_id, { ...oversizedIcon.remote, width: 1254, height: 1254, bytes: 1656632 });
    const rejected = await fetch(base + "/api/admin/appearance/assets/attach", { method: "POST", headers, body: JSON.stringify({ ticket: oversizedIcon.ticket }) });
    assert.equal(rejected.status, 400);
    const rejection = await rejected.json() as { error: string; fields: Record<string, string[]> };
    assert.equal(rejection.fields.reason?.[0], "favicon-dimensions"); assert.deepEqual(rejection.fields.width, ["1254"]); assert.deepEqual(rejection.fields.height, ["1254"]);
    assert.equal(h.assets.size, 0); assert.equal(h.row.publishedRevision, 0);
    const config = { ...initialAppearance, themePreset: "midnight-luxury" }; const body = JSON.stringify({ expectedVersion: 0, config });
    const saved = await fetch(base + "/api/admin/appearance/draft", { method: "PUT", headers, body }); assert.equal(saved.status, 200); assert.match(saved.headers.get("cache-control")!, /no-store/);
    let publicResponse = await fetch(base + "/api/appearance"); const published = await publicResponse.json() as { themePreset: string }; assert.equal(published.themePreset, "emerald-lab"); assert.match(publicResponse.headers.get("cache-control")!, /max-age=30/);
    const preview = await fetch(base + "/api/admin/appearance/preview", { headers }); assert.equal((await preview.json() as { themePreset: string }).themePreset, "midnight-luxury"); assert.match(preview.headers.get("cache-control")!, /no-store/);
    assert.equal((await fetch(base + "/api/admin/appearance/publish", { method: "POST", headers, body: '{"expectedVersion":1}' })).status, 200);
    publicResponse = await fetch(base + "/api/appearance"); const publicText = await publicResponse.text(); assert.ok(publicText.includes("midnight-luxury")); assert.ok(!publicText.includes("draft")); assert.ok(!publicText.includes("fixture-secret"));
    const bad = await fetch(base + "/api/admin/appearance/draft", { method: "PUT", headers, body: JSON.stringify({ expectedVersion: 2, config: { ...initialAppearance, assets: { ...initialAppearance.assets, hero: "https://evil.test" } } }) }); assert.equal(bad.status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("all four semantic palettes meet readable text, button and focus contrast", () => {
  const luminance = (hex: string) => { const values = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4); return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722; };
  const ratio = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  assert.equal(Object.keys(themes).length, 4); assert.equal(slots.length, 6);
  for (const theme of Object.values(themes)) {
    for (const background of [theme.background, theme.surface, theme.raised]) assert.ok(ratio(theme.text, background) >= 4.5);
    // Muted copy is rendered on the base/card surfaces; raised surfaces use primary text.
    for (const background of [theme.background, theme.surface]) assert.ok(ratio(theme.muted, background) >= 4.5);
    for (const background of [theme.accent, theme.hover]) assert.ok(ratio(theme.onAccent, background) >= 4.5);
    assert.ok(ratio(theme.focus, theme.background) >= 3); assert.ok(ratio(theme.disabledText, theme.disabled) >= 4.5);
  }
});


test("all six branding slots publish only their owned provider-verified image", async () => {
  const h = harness(); const config = structuredClone(initialAppearance);
  for (const slot of slots) {
    const issued = h.upload(slot); const asset = await h.service.attach(issued.ticket, "fixture-session"); config.assets[slot] = asset.id;
  }
  await h.service.save(config, 0); await h.service.publish(1);
  const result = await h.service.published();
  for (const slot of slots) assert.ok(result.appearance.assets[slot]?.includes(`/appearance/${slot}/`));
  assert.equal(h.assets.size, 6);
});

test("additive migration initializes both configurations to the exact current branding", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20261109000100_website_appearance/migration.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 2);
  assert.ok(!/DROP\s|ALTER TABLE/i.test(sql)); assert.ok(sql.includes('CHECK ("id" = 1)'));
  const configs = [...sql.matchAll(/'(\{"themePreset"[^']+\})'/g)].map(match => JSON.parse(match[1]!));
  assert.equal(configs.length, 2); for (const config of configs) assert.deepEqual(config, initialAppearance);
});

test("Pure Light keeps the requested neutral palette and every UI token monochrome", () => {
  const theme = themes["light-elegance"];
  assert.equal(theme.background, "#FFFFFF"); assert.equal(theme.raised, "#F7F7F7"); assert.equal(theme.surface, "#FFFFFF");
  assert.equal(theme.border, "#E5E5E5"); assert.equal(theme.muted, "#737373"); assert.equal(theme.text, "#171717");
  assert.equal(theme.accent, "#171717"); assert.equal(theme.onAccent, "#FFFFFF");
  for (const color of Object.values(theme)) assert.ok(color.slice(1, 3) === color.slice(3, 5) && color.slice(3, 5) === color.slice(5, 7));
});


test("unconfigured assets retain a backward-compatible favicon path and neutral branding defaults", async () => {
  const h = harness();
  const result = await h.service.published();
  for (const slot of ["logo", "hero", "men", "women", "unisex"] as const) assert.equal(result.appearance.assets[slot], null);
  assert.equal(result.appearance.assets.favicon, "/favicon.ico");
});

test("square PNG favicon boundaries support attach, saved draft, preview and explicit publishing", async () => {
  for (const size of [32, 512]) {
    const h = harness(); const issued = h.upload("favicon");
    h.cloud.set(issued.remote.public_id, { ...issued.remote, width: size, height: size });
    const asset = await h.service.attach(issued.ticket, "fixture-session");
    const config = structuredClone(initialAppearance); config.assets.favicon = asset.id;
    await h.service.save(config, 0);
    assert.equal((await h.service.preview()).assets.favicon, asset.url);
    assert.equal((await h.service.published()).appearance.assets.favicon, staticAssets.favicon);
    await h.service.publish(1);
    assert.equal((await h.service.published()).appearance.assets.favicon, asset.url);
  }
  for (const patch of [{ width: 31, height: 31 }, { width: 513, height: 513 }, { width: 512, height: 256 }, { width: 1254, height: 1254 }, { format: "jpg" }]) {
    const h = harness(); const issued = h.upload("favicon"); h.cloud.set(issued.remote.public_id, { ...issued.remote, ...patch });
    await assert.rejects(h.service.attach(issued.ticket, "fixture-session"), error => error instanceof AppearanceError && error.status === 400 && !!error.fields.reason?.[0]?.startsWith("favicon-"));
    assert.equal(h.assets.size, 0);
  }
});

test("all four theme-only draft/preview/publish cycles retain published branding references", async () => {
  const h = harness(); let config = structuredClone(initialAppearance);
  for (const slot of slots) { const upload = h.upload(slot); const asset = await h.service.attach(upload.ticket, "fixture-session"); config.assets[slot] = asset.id; }
  await h.service.save(config, 0); await h.service.publish(1); let version = 2;
  const branding = structuredClone(config.assets);
  for (const themePreset of ["retro-vice", "midnight-luxury", "light-elegance", "emerald-lab"] as const) {
    const previous = await h.service.published(); config = { ...config, themePreset };
    await h.service.save(config, version++);
    assert.equal((await h.service.published()).appearance.themePreset, previous.appearance.themePreset);
    assert.equal((await h.service.preview()).themePreset, themePreset);
    const result = await h.service.publish(version++);
    assert.equal(result.published.themePreset, themePreset); assert.deepEqual(result.published.tokens, themes[themePreset]);
    assert.deepEqual((await h.service.admin()).published.assets, branding);
    assert.deepEqual(result.published.assets, previous.appearance.assets);
  }
});
