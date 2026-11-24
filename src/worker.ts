/**
 * Runs the file worker on its own, without the HTTP API, so that PDF
 * processing doesn't compete with chat requests for CPU. Run the API with
 * FILE_WORKER_CONCURRENCY=0 when using this.
 *
 *   Development:  npm run worker
 *   Production:   npm run build && npm run worker:prod
 */
import "dotenv/config";
import { closeDatabase, connectToDatabase } from "./config/database.js";
import { validateEnv } from "./config/validate-env.js";
import { getStorage } from "./storage/index.js";
import { startFileWorker } from "./workers/file-worker.js";

async function start(): Promise<void> {
  validateEnv();
  console.log(`Using "${getStorage().name}" storage provider`);
  await connectToDatabase();

  // At least one: this process exists only to process files.
  const concurrency = Math.max(
    1,
    Number(process.env.FILE_WORKER_CONCURRENCY || 2),
  );
  const worker = startFileWorker(concurrency);

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    worker.stop();
    void closeDatabase().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error: unknown) => {
  console.error("Failed to start file worker:", error);
  process.exit(1);
});
