import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { env } from "./config/env.js";

export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10_000 }),
});
