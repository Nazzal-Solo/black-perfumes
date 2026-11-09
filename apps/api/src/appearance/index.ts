import { db } from "../db.js";
import { env } from "../config/env.js";
import { databaseScope } from "../images/index.js";
import { cloudinaryAssets } from "../images/cloudinary-assets.js";
import { AppearanceService } from "./service.js";

export const appearance = new AppearanceService({ client: db, transaction: work => db.$transaction(work, { maxWait: 10_000, timeout: 20_000 }) }, cloudinaryAssets, env.CLOUDINARY_API_SECRET, `black-perfumes/${databaseScope}/appearance/`, env.CLOUDINARY_CLOUD_NAME);
