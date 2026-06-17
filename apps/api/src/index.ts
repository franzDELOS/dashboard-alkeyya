import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath });

(async () => {
  const { createApp } = await import("./app.js");
  const { env } = await import("./config/env.js");

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(
      `[api] Alkeyya Dashboard API listening on :${env.PORT} (${env.NODE_ENV})`
    );
  });

  // Graceful shutdown so in-flight requests finish and the DB pool closes
  // cleanly when the container is stopped or redeployed.
  function shutdown(signal: string) {
    console.log(`[api] ${signal} received, shutting down...`);
    server.close(() => {
      console.log("[api] HTTP server closed. Bye.");
      process.exit(0);
    });
    // Force-exit if connections hang.
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
