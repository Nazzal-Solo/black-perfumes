import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_IMAGE_BYTES, UNCONFIRMED_UPLOAD, reconcileImageQueue, uploadImageQueue, validateImageSelection, type QueuedImage, type QueueTransport } from "../src/lib/image-queue";
import type { ProductImage } from "../src/lib/admin-api";

const file = (name = "image.png") => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
const pending = (id: string): QueuedImage => ({ id, file: file(`${id}.png`), preview: `blob:${id}`, progress: 0, status: "Waiting" });
const ticket = (id: string, expiresAt = Date.now() + 120000) => `${btoa(JSON.stringify({ publicId: `product/${id}`, expiresAt }))}.test-signature`;
const image = (id: string): ProductImage => ({ id, cloudinaryPublicId: `product/${id}`, url: `https://res.cloudinary.com/test/image/upload/${id}.png`, altText: "", position: 0 });
function harness(initial: QueuedImage[]) {
  let items = initial;
  let stored: ProductImage[] = [];
  let issued = 0;
  const uploads: string[] = [];
  const orders: string[][] = [];
  const transport: QueueTransport = {
    list: async () => stored,
    issue: async selected => { issued++; return ticket(selected.name.replace(".png", "")); },
    upload: async (selected, _grant, progress) => { const id = selected.name.replace(".png", ""); uploads.push(id); progress(100); if (!stored.some(item => item.id === id)) stored = [...stored, image(id)]; return stored; },
    reorder: async ids => { orders.push(ids); stored = ids.map(id => stored.find(item => item.id === id)!); return stored; },
  };
  return { get items() { return items; }, get issued() { return issued; }, get uploads() { return uploads; }, get orders() { return orders; }, get stored() { return stored; }, setStored: (value: ProductImage[]) => { stored = value; }, transport,
    run: (now?: () => number) => uploadImageQueue({ getItems: () => items, setItems: value => { items = value; }, transport, changed: () => {}, now }),
  };
}
test("selection validates count, MIME, empty files and exact size boundary", () => {
  assert.equal(validateImageSelection([file()], 9), null);
  assert.match(validateImageSelection([file(), file()], 9)!, /10 images/);
  assert.match(validateImageSelection([new File(["x"], "bad.svg", { type: "image/svg+xml" })], 0)!, /JPEG/);
  assert.match(validateImageSelection([new File([], "empty.png", { type: "image/png" })], 0)!, /10 MB/);
  const limit = new File([new Uint8Array(MAX_IMAGE_BYTES)], "limit.png", { type: "image/png" });
  assert.equal(validateImageSelection([limit], 0), null);
  assert.match(validateImageSelection([new File([limit, "x"], "large.png", { type: "image/png" })], 0)!, /10 MB/);
});
test("local queue retains previews and order without uploading before explicitly invoked", async () => {
  const state = harness([pending("primary"), pending("second")]);
  assert.equal(state.issued, 0); assert.equal(state.uploads.length, 0);
  assert.equal(state.items[0]?.preview, "blob:primary");
  await state.run();
  assert.deepEqual(state.uploads, ["primary", "second"]);
  assert.deepEqual(state.items.map(item => item.image?.id), ["primary", "second"]);
  assert.ok(state.items.every(item => !item.file && !item.preview));
});
test("partial failure retains failed file, skips saved images, and restores intended primary on retry", async () => {
  const state = harness([pending("first"), pending("second")]);
  const upload = state.transport.upload;
  let fail = true;
  state.transport.upload = async (...args) => { if (args[0].name === "first.png" && fail) { fail = false; throw Object.assign(new Error("Cloudinary unavailable"), { stage: "upload", status: 502 }); } return upload(...args); };
  await state.run();
  assert.equal(state.items[0]?.status, "Failed"); assert.ok(state.items[0]?.file);
  assert.equal(state.items[1]?.status, "Saved");
  const firstGrant = state.items[0]?.grant?.ticket;
  await state.run();
  assert.equal(state.issued, 2); assert.deepEqual(state.uploads, ["second", "first"]);
  assert.equal(state.items[0]?.grant?.ticket, firstGrant);
  assert.deepEqual(state.stored.map(item => item.id), ["first", "second"]);
  assert.deepEqual(state.orders, [["first", "second"]]);
});
test("lost upload response is reconciled without uploading an already attached image again", async () => {
  const state = harness([pending("first")]);
  const upload = state.transport.upload;
  state.transport.upload = async (...args) => { await upload(...args); throw Object.assign(new Error("Connection interrupted"), { status: 0 }); };
  await state.run(); assert.equal(state.items[0]?.status, "Save unconfirmed");
  await state.run();
  assert.equal(state.items[0]?.status, "Saved"); assert.equal(state.issued, 1); assert.deepEqual(state.uploads, ["first"]);
});
test("ambiguous retry reuses the same ticket, and expired ambiguous tickets never issue new uploads", async () => {
  const grant = { ticket: ticket("first", 1000), publicId: "product/first", expiresAt: 1000 };
  const state = harness([{ ...pending("first"), grant, uncertain: true }]);
  let seen = "";
  const upload = state.transport.upload;
  state.transport.upload = async (...args) => { seen = args[1]; return upload(...args); };
  await state.run(() => 500); assert.equal(seen, grant.ticket); assert.equal(state.issued, 0);
  const expired = harness([{ ...pending("first"), grant, uncertain: true }]);
  await expired.run(() => 1001);
  assert.equal(expired.issued, 0); assert.equal(expired.uploads.length, 0);
  assert.equal(expired.items[0]?.error, UNCONFIRMED_UPLOAD);
  assert.ok(expired.items[0]?.file);
});
test("refresh deduplicates confirmed images and preserves other queued files", () => {
  const first = pending("first"); first.grant = { ticket: ticket("first"), publicId: "product/first", expiresAt: Date.now() + 1000 };
  const result = reconcileImageQueue([first, pending("second")], [image("first")]);
  assert.equal(result.length, 2); assert.equal(result[0]?.image?.id, "first"); assert.ok(result[1]?.file);
  assert.equal(reconcileImageQueue(result, [image("first")]).length, 2);
});
test("order failures retain successful attachments and can retry without re-uploading", async () => {
  const state = harness([pending("first"), { id: "saved-second", image: image("second"), progress: 100, status: "Saved" }]);
  state.setStored([image("second")]);
  const order = state.transport.reorder;
  state.transport.reorder = async () => { throw new Error("Order not saved"); };
  await assert.rejects(state.run(), /Order not saved/);
  assert.ok(state.items.every(item => item.image));
  state.transport.reorder = order;
  await state.run();
  assert.deepEqual(state.uploads, ["first"]);
  assert.deepEqual(state.stored.map(item => item.id), ["first", "second"]);
});
