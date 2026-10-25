import { db } from "../db.js";
import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { ImageService } from "./service.js";
import { cloudinaryAssets } from "./cloudinary-assets.js";

// Isolate cleanup when separate databases share one Cloudinary account. Credentials
// and pooling/SSL options do not influence the namespace.
const databaseUrl = new URL(env.DATABASE_URL);
const databaseScope = createHash("sha256").update([
  databaseUrl.hostname.toLowerCase().replace(/-pooler(?=\.)/, ""), databaseUrl.port || "5432",
  databaseUrl.pathname, databaseUrl.searchParams.get("schema") || "public",
].join("|")).digest("hex").slice(0, 24);

export const images = new ImageService({
  client: db, transaction: (work) => db.$transaction(work, { maxWait: 10_000, timeout: 15_000 }),
}, cloudinaryAssets, env.CLOUDINARY_API_SECRET, Date.now, `black-perfumes/${databaseScope}/products/`);
