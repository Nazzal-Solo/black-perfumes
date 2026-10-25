import { images } from "../images/index.js";
import { db } from "../db.js";

try { await images.cleanupUnused(); console.log("Unused product image cleanup completed."); }
catch { console.error("Image cleanup failed; no referenced assets are eligible for deletion. Check Cloudinary configuration and retry."); process.exitCode = 1; }
finally { await db.$disconnect(); }
