import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateBrandingFile, uploadBranding } from "../src/lib/appearance-admin";
import { ApiError } from "../src/lib/admin-api";
import { appearanceIssue } from "../src/lib/appearance-errors";
import { appearanceText } from "../src/i18n/appearance-copy";
function png(width: number, height = width) {
  const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height);
  return new File([bytes], "favicon.png", { type: "image/png" });
}
test("favicon preflight accepts inclusive boundaries and a real PNG, rejecting oversized/non-square/header-spoofed files before signing", async () => {
  for (const size of [32, 128, 512]) await validateBrandingFile(png(size), "favicon");
  await validateBrandingFile(new File([readFileSync(new URL("../src/app/icon.png", import.meta.url))], "icon.png", { type: "image/png" }), "favicon");
  const original = globalThis.fetch; let requests = 0; globalThis.fetch = async () => { requests++; throw Error("Must not sign invalid input"); };
  try {
    for (const file of [png(31), png(513), png(1254), png(512, 256), new File(["not png"], "spoof.png", { type: "image/png" }), new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })]) {
      await assert.rejects(uploadBranding("favicon", { file }, () => {}, new AbortController().signal), error => error instanceof ApiError && error.fields.validation?.[0] === "file");
    }
    assert.equal(requests, 0);
    await validateBrandingFile(png(1254), "logo"); // Other branding slots retain existing restrictions.
  } finally { globalThis.fetch = original; }
});
test("favicon errors show actionable dimensions in EN/AR and never print unknown provider details", async () => {
  try { await validateBrandingFile(png(1254), "favicon"); assert.fail("must reject"); }
  catch (error) {
    const issue = appearanceIssue(error); assert.equal(issue.key, "faviconDimensions");
    for (const ar of [false, true]) { const text = appearanceText(issue.key, ar, issue.values); assert.ok(text.includes("1254×1254")); assert.ok(text.includes("512×512")); assert.ok(!text.includes("{width}")); }
  }
  assert.equal(appearanceIssue(new ApiError(401, "private provider details", {}, "upload")).key, "uploadConfiguration");
  assert.equal(appearanceIssue(new ApiError(403, "blocked")).key, "permission");
  assert.equal(appearanceIssue(new Error("secret details")).key, "failure");
});
