import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createPublicReader, CATALOG_POLICY, DETAIL_POLICY, PublicReadError } from "../src/lib/public-read";
const policy = { attempts: 4, timeoutMs: 100, backoffMs: 1 };
const parse = (value: unknown) => z.object({ value: z.number() }).parse(value);
const url = "https://api.example.test/api/products?limit=6&page=1";

test("catalog has an 87-second maximum retry budget; server-rendered details stay below function limits", () => {
  assert.equal(CATALOG_POLICY.attempts * CATALOG_POLICY.timeoutMs + 7 * CATALOG_POLICY.backoffMs, 87_000);
  assert.equal(DETAIL_POLICY.attempts * DETAIL_POLICY.timeoutMs + 3 * DETAIL_POLICY.backoffMs, 48_000);
});
test("transient 502/503/504 and network failures recover with bounded retries and no credentials", async () => {
  for (const failure of [502, 503, 504, "network"]) {
    let calls = 0;
    const reader = createPublicReader(async (_input, init) => {
      calls++; assert.equal(init?.credentials, "omit"); assert.equal(init?.cache, "no-store");
      if (calls < 3) { if (failure === "network") throw new TypeError("offline"); return new Response(null, { status: failure as number }); }
      return Response.json({ value: 1 });
    });
    assert.deepEqual(await reader(url, parse, { policy }), { value: 1 }); assert.equal(calls, 3);
  }
});
test("timeouts still apply when callers supply an AbortSignal", async () => {
  let calls = 0;
  const reader = createPublicReader(async (_input, init) => {
    calls++; if (calls === 2) return Response.json({ value: 2 });
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
  });
  const keepAlive = setTimeout(() => {}, 200);
  try { assert.deepEqual(await reader(url, parse, { signal: new AbortController().signal, policy: { ...policy, timeoutMs: 5 } }), { value: 2 }); assert.equal(calls, 2); }
  finally { clearTimeout(keepAlive); }
});
test("permanent HTTP, invalid JSON/schema, and missing products are not automatically retried", async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    let calls = 0; const reader = createPublicReader(async () => { calls++; return new Response(null, { status }); });
    await assert.rejects(reader(url, parse, { policy }), error => error instanceof PublicReadError && error.status === status); assert.equal(calls, 1);
  }
  for (const response of [new Response("<html>not an API response</html>"), Response.json({ value: "invalid" })]) {
    let calls = 0; const reader = createPublicReader(async () => { calls++; return response; });
    await assert.rejects(reader(url, parse, { policy })); assert.equal(calls, 1);
  }
  const reader = createPublicReader(async () => new Response(null, { status: 404 }));
  assert.equal(await reader(url, value => value, { policy }), null);
});
test("transient exhaustion stops and a manual retry starts a fresh request", async () => {
  let calls = 0; let offline = true;
  const reader = createPublicReader(async () => { calls++; return offline ? new Response(null, { status: 503 }) : Response.json({ value: 1 }); });
  await assert.rejects(reader(url, parse, { policy }), PublicReadError); assert.equal(calls, 4);
  offline = false; assert.deepEqual(await reader(url, parse, { policy }), { value: 1 }); assert.equal(calls, 5);
});
test("obsolete requests cancel active fetches and pending backoff without poisoning replacement requests", async () => {
  const controller = new AbortController(); let calls = 0;
  const reader = createPublicReader(async () => { calls++; return new Response(null, { status: 503 }); });
  const pending = reader(url, parse, { signal: controller.signal, policy: { ...policy, backoffMs: 1000 } });
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort();
  await assert.rejects(pending, { name: "AbortError" }); assert.equal(calls, 1);
  const active = new AbortController(); let stopped = false;
  const fetcher = createPublicReader(async (_input, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => { stopped = true; reject(init!.signal!.reason); }, { once: true })));
  const inFlight = fetcher(url, parse, { signal: active.signal, policy }); active.abort();
  await assert.rejects(inFlight, { name: "AbortError" }); assert.equal(stopped, true);
  const preAborted = new AbortController(); preAborted.abort();
  await assert.rejects(reader(url, parse, { signal: preAborted.signal }), { name: "AbortError" }); assert.equal(calls, 1);
});
test("concurrent consumers share a request; aborting one does not cancel another", async () => {
  let calls = 0; let complete!: (response: Response) => void;
  const reader = createPublicReader(async () => { calls++; return new Promise<Response>(resolve => { complete = resolve; }); });
  const controller = new AbortController(); const first = reader(url, parse, { signal: controller.signal, policy }); const second = reader(url, parse, { policy });
  controller.abort(); await assert.rejects(first, { name: "AbortError" }); complete(Response.json({ value: 3 }));
  assert.deepEqual(await second, { value: 3 }); assert.equal(calls, 1);
});
test("only validated categories cache for 30 seconds; product reads stay fresh and query keys stay isolated", async () => {
  let now = 0; let calls = 0;
  const reader = createPublicReader(async () => { calls++; return Response.json({ value: calls }); }, () => now);
  const categoryUrl = "https://api.example.test/api/categories";
  assert.deepEqual(await reader(categoryUrl, parse, { categoryCache: true, policy }), { value: 1 });
  now = 29_999; assert.deepEqual(await reader(categoryUrl, parse, { categoryCache: true, policy }), { value: 1 });
  now = 30_000; assert.deepEqual(await reader(categoryUrl, parse, { categoryCache: true, policy }), { value: 2 });
  await reader(url, parse, { policy }); await reader(url, parse, { policy }); assert.equal(calls, 4);
  await Promise.all([reader(url + "&search=عطر", parse, { policy }), reader(url + "&categoryId=women", parse, { policy })]); assert.equal(calls, 6);
  let invalidCalls = 0; const invalid = createPublicReader(async () => { invalidCalls++; return Response.json({ value: "bad" }); });
  for (let i = 0; i < 2; i++) await assert.rejects(invalid(categoryUrl, parse, { policy, categoryCache: true })); assert.equal(invalidCalls, 2);
});

test("retry delays grow exponentially at one, two and four seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const reader = createPublicReader(async () => { calls++; return calls < 4 ? new Response(null, { status: 503 }) : Response.json({ value: 1 }); });
  const pending = reader(url, parse);
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  await flush(); assert.equal(calls, 1);
  for (const delay of [1000, 2000, 4000]) {
    const previous: number = calls; t.mock.timers.tick(delay - 1); await flush(); assert.equal(calls, previous);
    t.mock.timers.tick(1); await flush(); assert.equal(calls, previous + 1);
  }
  assert.deepEqual(await pending, { value: 1 });
});
