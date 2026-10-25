import assert from "node:assert/strict";
import { test } from "node:test";

test("Cloudinary grants are signed for a fixed image ID, five-minute window, formats and non-overwriting preset", async () => {
  Object.assign(process.env, {
    NODE_ENV: "test", CORS_ORIGINS: "https://shop.example.test", DATABASE_URL: "postgresql://fixture:fixture@localhost/fixture",
    CLOUDINARY_CLOUD_NAME: "fixture", CLOUDINARY_API_KEY: "fixture-key", CLOUDINARY_API_SECRET: "fixture-secret", CLOUDINARY_UPLOAD_PRESET: "signed-fixture",
  });
  const { cloudinaryAssets } = await import("../src/images/cloudinary-assets.js");
  const grant = cloudinaryAssets.sign!("black-perfumes/fixture/products/fixture/image");
  assert.equal(grant.url, "https://api.cloudinary.com/v1_1/fixture/image/upload");
  assert.equal(grant.fields.public_id, "black-perfumes/fixture/products/fixture/image");
  assert.equal(grant.fields.overwrite, "false"); assert.equal(grant.fields.type, "upload");
  assert.equal(grant.fields.upload_preset, "signed-fixture"); assert.equal(grant.fields.allowed_formats, "jpg,png,webp");
  assert.equal(grant.fields.transformation, "c_limit,h_2400,w_2400");
  const secondsLeft = Number(grant.fields.timestamp) + 3600 - Math.floor(Date.now() / 1000);
  assert.ok(secondsLeft >= 299 && secondsLeft <= 300);
  assert.match(grant.fields.signature!, /^[a-f0-9]{40}$/);
  assert.ok(!JSON.stringify(grant).includes("fixture-secret"));
  const { env } = await import("../src/config/env.js"); env.CLOUDINARY_UPLOAD_PRESET = undefined;
  assert.throws(() => cloudinaryAssets.sign!("fixture"), /configured signed Cloudinary upload preset/);
});
