import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth/routes.js";
import type { AuthStore } from "../auth/store.js";
import { ImageError, MAX_IMAGE_BYTES } from "../images/service.js";
import { appearanceInput, slots, themes } from "./config.js";
import { AppearanceError, type AppearanceService } from "./service.js";

export function createAppearanceRouters(service: AppearanceService, store: AuthStore, options: { production: boolean; origins: string[] }) {
  const publicRouter = Router(); const adminRouter = Router();
  publicRouter.get("/appearance", async (_request, response) => {
    const result = await service.published();
    response.set("Cache-Control", result.fallback ? "public, max-age=5" : "public, max-age=30, must-revalidate").json(result.appearance);
  });
  adminRouter.use("/appearance", requireAdmin(store, options));
  adminRouter.get("/appearance", async (_request, response) => { response.json(await service.admin()); });
  adminRouter.get("/appearance/themes", (_request, response) => { response.json({ presets: themes }); });
  adminRouter.get("/appearance/preview", async (_request, response) => { response.json(await service.preview()); });
  adminRouter.get("/appearance/assets", async (_request, response) => { response.json({ assets: await service.listAssets() }); });
  const version = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();
  adminRouter.put("/appearance/draft", async (request, response) => {
    const input = version.extend({ config: appearanceInput }).parse(request.body);
    response.json(await service.save(input.config, input.expectedVersion));
  });
  adminRouter.post("/appearance/publish", async (request, response) => { response.json(await service.publish(version.parse(request.body).expectedVersion)); });
  adminRouter.post("/appearance/discard", async (request, response) => { response.json(await service.discard(version.parse(request.body).expectedVersion)); });
  adminRouter.post("/appearance/assets/signature", (request, response) => {
    const input = z.object({ slot: z.enum(slots), size: z.number().int().min(1).max(MAX_IMAGE_BYTES), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]) }).strict().parse(request.body);
    if (input.slot === "favicon" && input.contentType !== "image/png") throw new AppearanceError(400, "Choose a square PNG favicon.");
    response.json(service.issue(input.slot, String(response.locals.sessionKey)));
  });
  adminRouter.post("/appearance/assets/attach", async (request, response) => {
    const input = z.object({ ticket: z.string().min(1).max(2000) }).strict().parse(request.body);
    response.status(201).json({ asset: await service.attach(input.ticket, String(response.locals.sessionKey)) });
  });
  adminRouter.delete("/appearance/assets/:id", async (request, response) => {
    await service.remove(z.uuid().parse(request.params.id)); response.status(204).end();
  });
  const errors: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (error instanceof AppearanceError || error instanceof ImageError) response.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) response.status(400).json({ error: "Invalid appearance settings." });
    else next(error);
  };
  adminRouter.use(errors);
  return { publicRouter, adminRouter };
}
