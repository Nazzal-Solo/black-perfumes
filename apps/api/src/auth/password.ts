import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 32768;
const r = 8;
const p = 3;
const dummy = `scrypt$${N}$${r}$${p}$${"00".repeat(16)}$${"00".repeat(64)}`;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string | undefined) {
  const valid = encoded?.match(/^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/);
  const parts = (valid ? encoded! : dummy).split("$");
  const key = await derive(password, Buffer.from(parts[4]!, "hex"));
  const matches = timingSafeEqual(key, Buffer.from(parts[5]!, "hex"));
  return Boolean(valid) && matches;
}
