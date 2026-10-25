import { writeFile } from "node:fs/promises";
import { db } from "../db.js";
import { importCatalog, loadCatalog } from "../catalog/import.js";

try {
  const rows = await loadCatalog();
  const apply = process.argv.includes("--apply");
  const rollback = new Error("Dry run rollback");
  let report: Awaited<ReturnType<typeof importCatalog>> = [];
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(283745910)`;
      report = await importCatalog(tx, rows);
      if (!apply) throw rollback;
    }, { timeout: 120_000 });
  } catch (error) { if (error !== rollback) throw error; }
  const result = { mode: apply ? "applied" : "dry-run", sourceEntries: rows.length, unique: 180, products: report, duplicates: rows.filter((row) => row.reference !== row.canonical), review: rows.filter((row) => row.review) };
  await writeFile(new URL("../catalog/data/import-report.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ mode: result.mode, created: report.filter((item) => item.outcome === "created-draft").length, skipped: report.filter((item) => item.outcome !== "created-draft").length, sourceEntries: rows.length, unique: 180 }));
} catch { console.error("Catalog import failed; transaction rolled back. Check database connectivity and migration status."); process.exitCode = 1; }
finally { await db.$disconnect(); }
