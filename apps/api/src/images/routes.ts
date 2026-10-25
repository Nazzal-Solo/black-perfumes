import express, { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth/routes.js";
import type { AuthStore } from "../auth/store.js";
import { ImageError, MAX_IMAGE_BYTES, MAX_PRODUCT_IMAGES, type ImageService } from "./service.js";

type Options = { production: boolean; origins: string[] };
const uploadInput = z.object({ size: z.number().int().min(1).max(MAX_IMAGE_BYTES), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]) }).strict();
const orderInput = z.object({ imageIds: z.array(z.uuid()).max(MAX_PRODUCT_IMAGES) }).strict();
const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (error instanceof ImageError) response.status(error.status).json({
    error: error.message,
    ...(error.stage ? { stage: error.stage } : {}),
    ...(error.code ? { code: error.code } : {}),
    ...(error.providerStatus ? { providerStatus: error.providerStatus } : {}),
  });
  else if (typeof error === "object" && error !== null && "status" in error && [400, 413, 415].includes(Number(error.status))) response.status(Number(error.status)).json({ error: "Choose a JPEG, PNG, or WebP image up to 10 MB." });
  else next(error);
};
function parameters(router: Router) {
  for (const key of ["productId", "imageId"]) router.param(key, (request, response, next, value: string) => {
    if (!z.uuid().safeParse(value).success) { response.status(400).json({ error: "Invalid identifier." }); return; }
    request.params[key] = value.toLowerCase();
    next();
  });
}

export function createImageUploadRouter(service: ImageService, store: AuthStore, options: Options) {
  const router = Router();
  parameters(router);
  router.post("/products/:productId/images/upload", requireAdmin(store, { ...options, binaryImageUpload: true }),
    (request, response, next) => {
      try {
        service.authorize(String(request.params.productId), String(response.locals.sessionKey), request.get("X-Upload-Signature") ?? "");
        next();
      } catch (error) { next(error); }
    },
    express.raw({ type: () => true, limit: MAX_IMAGE_BYTES, inflate: false }),
    async (request, response) => {
      if (!Buffer.isBuffer(request.body)) throw new ImageError(400, "An image file is required.");
      const images = await service.upload(String(request.params.productId), String(response.locals.sessionKey), request.get("X-Upload-Signature") ?? "", request.get("content-type")?.split(";")[0] ?? "", request.body);
      response.status(201).json({ images });
    });
  router.use(errorHandler);
  return router;
}

export function createImageRouter(service: ImageService, store: AuthStore, options: Options) {
  const router = Router();
  router.use("/products/:productId/images", requireAdmin(store, options));
  parameters(router);
  router.get("/products/:productId/images", async (request, response) => {
    response.json({ images: await service.list(String(request.params.productId)) });
  });
  router.post("/products/:productId/images/signature", async (request, response) => {
    const parsed = uploadInput.safeParse(request.body);
    if (!parsed.success) throw new ImageError(400, "Choose a JPEG, PNG, or WebP image up to 10 MB.");
    response.json(await service.issue(String(request.params.productId), String(response.locals.sessionKey), parsed.data.size, parsed.data.contentType));
  });
  const attachmentInput = z.object({ ticket: z.string().min(1).max(2000) }).strict();
  router.post("/products/:productId/images/direct-upload", async (request, response) => {
    const parsed = attachmentInput.safeParse(request.body);
    if (!parsed.success) throw new ImageError(400, "Invalid upload ticket.");
    response.json(await service.directUpload(String(request.params.productId), String(response.locals.sessionKey), parsed.data.ticket));
  });
  router.post("/products/:productId/images/attach", async (request, response) => {
    const parsed = attachmentInput.safeParse(request.body);
    if (!parsed.success) throw new ImageError(400, "Invalid upload ticket.");
    response.json({ images: await service.attach(String(request.params.productId), String(response.locals.sessionKey), parsed.data.ticket) });
  });
  router.put("/products/:productId/images/order", async (request, response) => {
    const parsed = orderInput.safeParse(request.body);
    if (!parsed.success) throw new ImageError(400, "Invalid image order.");
    response.json({ images: await service.reorder(String(request.params.productId), parsed.data.imageIds) });
  });
  router.delete("/products/:productId/images/:imageId", async (request, response) => {
    response.json({ images: await service.remove(String(request.params.productId), String(request.params.imageId)) });
  });
  router.use(errorHandler);
  return router;
}
