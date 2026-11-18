/**
 * Creates the database indexes the app needs. Safe to run repeatedly: it only
 * creates what is missing. Run once per environment, and again after changing
 * GEMINI_EMBEDDING_DIMENSIONS.
 *
 *   Development:  npm run db:setup
 *   Production:   npm run build && npm run db:setup:prod
 */
import "dotenv/config";
import { closeDatabase, connectToDatabase } from "../config/database.js";
import {
  chunksCollection,
  ensureChunkIndexes,
  ensureVectorSearchIndex,
  VECTOR_INDEX_NAME,
} from "../services/chunk.service.js";

const READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

/** Waits until the vector search index can serve queries (it builds asynchronously). */
async function waitForVectorIndex(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [index] = (await chunksCollection()
      .listSearchIndexes(VECTOR_INDEX_NAME)
      .toArray()) as { queryable?: boolean }[];
    if (index?.queryable === true) {
      console.log(`Vector search index "${VECTOR_INDEX_NAME}" is ready`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  console.warn(
    `Vector search index "${VECTOR_INDEX_NAME}" is not queryable after ${READY_TIMEOUT_MS / 1000}s. ` +
      "It may still be building; check its status in Atlas.",
  );
}

async function main(): Promise<void> {
  await connectToDatabase();
  try {
    await ensureChunkIndexes();
    console.log("Chunk indexes are in place");

    await ensureVectorSearchIndex();
    await waitForVectorIndex();
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error("Database setup failed:", error);
  process.exit(1);
});
