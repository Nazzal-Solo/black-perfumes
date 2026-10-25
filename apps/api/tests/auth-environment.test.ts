import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const fixture = {
  ...process.env, CORS_ORIGINS: "https://shop.example.test", DATABASE_URL: "postgresql://fixture:fixture@localhost/fixture",
  CLOUDINARY_CLOUD_NAME: "fixture", CLOUDINARY_API_KEY: "fixture-key", CLOUDINARY_API_SECRET: "fixture-secret", TRUST_PROXY_HOPS: "1",
};
function readMode(render: string, nodeEnv: string) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", 'import {env} from "./src/config/env.ts"; console.log(JSON.stringify({mode:env.NODE_ENV,proxyHops:env.TRUST_PROXY_HOPS}));'], {
    cwd: new URL("..", import.meta.url), env: { ...fixture, RENDER: render, NODE_ENV: nodeEnv }, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.status, 0, "Fixture-only environment validation should succeed");
  return JSON.parse(result.stdout) as { mode: string; proxyHops: number };
}
test("Render always enables production authentication even when NODE_ENV is missing or overridden", () => {
  for (const mode of ["", "development", "test", "production"]) {
    const result = readMode("true", mode); assert.equal(result.mode, "production"); assert.equal(result.proxyHops, 1);
  }
});
test("local development/test environments retain their existing behavior", () => {
  for (const mode of ["development", "test", "production"]) assert.equal(readMode("false", mode).mode, mode);
});
