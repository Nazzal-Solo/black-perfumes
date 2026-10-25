import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db } from "../db.js";
import { loadCatalog } from "../catalog/import.js";
import { releaseCatalog, releasePlan } from "../catalog/release.js";

try {
  const rows = await loadCatalog();
  const imported = JSON.parse(await readFile(new URL("../catalog/data/import-report.json", import.meta.url), "utf8")) as { products: { reference: string; id: string }[] };
  const catalog = await readFile(new URL("../catalog/data/initial-catalog.json", import.meta.url));
  const apply = process.argv.includes("--apply");
  const rollback = new Error("Dry run rollback");
  let changes: Awaited<ReturnType<typeof releaseCatalog>> = [];
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(283745910)`;
      changes = await releaseCatalog(tx, rows, Object.fromEntries(imported.products.map((item) => [item.reference, item.id])));
      if (!apply) throw rollback;
    }, { timeout: 120000 });
  } catch (error) { if (error !== rollback) throw error; }
  const summary = { mode: apply ? "applied" : "dry-run", published: changes.filter((item) => item.after.published).length, drafts: changes.filter((item) => !item.after.published).length, changed: changes.filter((item) => item.action === "updated").length, held: changes.filter((item) => item.holdReason).length };
  const destination = new URL("../catalog/data/release-report.json", import.meta.url);
  let history: unknown[] = [];
  try { history = JSON.parse(await readFile(destination, "utf8")) as unknown[]; } catch (error) { if (!(typeof error === "object" && error && "code" in error && error.code === "ENOENT")) throw error; }
  await writeFile(destination, JSON.stringify([...history, { at: new Date().toISOString(), catalogSha256: createHash("sha256").update(catalog).digest("hex"), planSha256: createHash("sha256").update(JSON.stringify(releasePlan(rows))).digest("hex"), summary, changes }], null, 2) + "\n");
  console.log(JSON.stringify(summary));
} catch { console.error("Catalog release failed. The transaction is atomic; verify source IDs, references, and database status before retrying."); process.exitCode = 1; }
finally { await db.$disconnect(); }
