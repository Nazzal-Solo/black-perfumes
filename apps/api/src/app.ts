import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { authStore } from "./auth/store.js";
import { createAuthRouter } from "./auth/routes.js";
import { ADMIN_JSON_LIMIT, createAdminRouter } from "./admin/routes.js";
import { db } from "./db.js";
import { images } from "./images/index.js";
import { createImageRouter, createImageUploadRouter } from "./images/routes.js";
import { createCatalogRouter } from "./catalog/routes.js";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY_HOPS);
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || env.CORS_ORIGINS.includes(origin)),
  methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
}));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "black-perfumes-api" });
});

const adminOptions = { production: env.NODE_ENV === "production", origins: env.CORS_ORIGINS };
app.use("/api", createCatalogRouter(db));
app.use("/api/admin", createImageUploadRouter(images, authStore, adminOptions));
app.use("/api/admin", express.json({ limit: ADMIN_JSON_LIMIT }),
  createAuthRouter(authStore, adminOptions), createImageRouter(images, authStore, adminOptions),
  createAdminRouter(db, authStore, adminOptions));

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) { next(error); return; }
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  response.set("Cache-Control", "no-store");
  if (status === 400 || status === 413) response.status(status).json({ error: "Invalid request" });
  else response.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);
