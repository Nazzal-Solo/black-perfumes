import "dotenv/config";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { hashPassword } from "../auth/password.js";

const input = z.object({
  DATABASE_URL: z.url().refine((value) => URL.canParse(value) && ["postgres:", "postgresql:"].includes(new URL(value).protocol)),
  INITIAL_ADMIN_EMAIL: z.email().max(254).transform((value) => value.toLowerCase()),
  INITIAL_ADMIN_PASSWORD: z.string().min(16).max(128),
  INITIAL_ADMIN_CONFIRM: z.literal("create-initial-admin"),
}).safeParse(process.env);

if (!input.success) {
  console.error("Admin creation requires DATABASE_URL, INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD (16–128 characters), and INITIAL_ADMIN_CONFIRM=create-initial-admin.");
  process.exitCode = 1;
} else {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: input.data.DATABASE_URL, connectionTimeoutMillis: 10_000 }) });
  try {
    if (await db.adminUser.count()) throw new Error("Admin already exists");
    const passwordHash = await hashPassword(input.data.INITIAL_ADMIN_PASSWORD);
    // The fixed primary key and database check also prevent concurrent bootstrap commands.
    await db.adminUser.create({ data: { id: 1, email: input.data.INITIAL_ADMIN_EMAIL, passwordHash } });
    console.log("Initial admin created.");
  } catch {
    console.error("Admin was not created. Check database connectivity/migrations and whether an admin already exists. Existing accounts are never overwritten.");
    process.exitCode = 1;
  } finally {
    delete process.env.INITIAL_ADMIN_PASSWORD;
    await db.$disconnect();
  }
}
