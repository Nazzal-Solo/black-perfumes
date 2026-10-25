import { db } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";

export type LoginAttempt = { id: number; email: string; passwordHash: string; loginAttempts: number; retryAfter: number };
export type ActiveSession = { admin: { id: number; email: string }; expiresAt: Date };

export interface AuthStore {
  attemptLogin(): Promise<LoginAttempt | null>;
  createSession(tokenHash: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string): Promise<ActiveSession | null>;
  revokeSession(tokenHash: string): Promise<void>;
}

export function createAuthStore(client: Prisma.TransactionClient = db): AuthStore {
  return {
    async attemptLogin() {
      // One atomic, database-backed window shared across instances and all supplied emails.
      const rows = await client.$queryRaw<LoginAttempt[]>`
      UPDATE "AdminUser" SET
        "loginAttempts" = CASE WHEN "loginWindowStartsAt" <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
          THEN 1 ELSE LEAST("loginAttempts" + 1, 6) END,
        "loginWindowStartsAt" = CASE WHEN "loginWindowStartsAt" <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
          THEN CURRENT_TIMESTAMP ELSE "loginWindowStartsAt" END
      WHERE "id" = 1
      RETURNING "id", "email", "passwordHash", "loginAttempts",
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("loginWindowStartsAt" + INTERVAL '15 minutes' - CURRENT_TIMESTAMP))))::int AS "retryAfter"
      `;
      return rows[0] ?? null;
    },
    async createSession(tokenHash, expiresAt) {
      await client.adminSession.create({ data: { tokenHash, expiresAt, adminId: 1 } });
    },
    async findSession(tokenHash) {
      return client.adminSession.findFirst({
        where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { expiresAt: true, admin: { select: { id: true, email: true } } },
      });
    },
    async revokeSession(tokenHash) {
      await client.adminSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    },
  };
}

export const authStore = createAuthStore();
