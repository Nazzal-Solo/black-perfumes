import "dotenv/config";
import { z } from "zod";

const origin = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && url.origin === value;
}, "Use an HTTP(S) origin without a path or trailing slash");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  CORS_ORIGINS: z.string().min(1).transform((value) => value.split(",").map((item) => item.trim())).pipe(z.array(origin).min(1)),
  DATABASE_URL: z.url().refine((value) => URL.canParse(value) && ["postgres:", "postgresql:"].includes(new URL(value).protocol), "Use a PostgreSQL connection URL"),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  CLOUDINARY_UPLOAD_PRESET: z.string().min(1).optional(),
}).refine((value) => value.NODE_ENV !== "production" || value.CORS_ORIGINS.every((item) => item.startsWith("https://")), { message: "Production CORS origins must use HTTPS", path: ["CORS_ORIGINS"] });

// Render is always a hosted environment, even if NODE_ENV is accidentally overridden.
const result = schema.safeParse({
  ...process.env,
  NODE_ENV: process.env.RENDER === "true" ? "production" : process.env.NODE_ENV,
});
if (!result.success) {
  // Report field names and validation messages only; never log supplied secrets.
  throw new Error(`Invalid API environment: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
}

export const env = result.data;
