import "./config/cloudinary.js";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { db } from "./db.js";
import { images } from "./images/index.js";

const server = app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`Black Perfumes API listening on port ${env.PORT}`);
});

const imageCleanup = setInterval(() => {
  void images.cleanupUnused().catch(() => console.error("Unused image cleanup will be retried."));
}, 15 * 60 * 1000);
imageCleanup.unref();

server.on("error", () => {
  console.error("API failed to listen. Check the configured port.");
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(imageCleanup);
    server.close(() => { void db.$disconnect().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
