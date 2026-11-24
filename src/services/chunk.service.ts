import type { ObjectId } from "mongodb";
import { getDb } from "../config/database.js";
import { geminiConfig } from "../config/gemini.js";
import type { TextChunk } from "../processing/chunker.js";
import { embedTexts, formatDocumentForEmbedding } from "./embedding.service.js";

export const VECTOR_INDEX_NAME = "chunks_vector_index";

export interface ChunkDocument {
  _id?: ObjectId;
  fileId: ObjectId;
  /** Session that owns the file; vector searches are filtered by it. */
  ownerId: string;
  /** 0-based position of the chunk within the file. */
  index: number;
  text: string;
  pageStart: number;
  pageEnd: number;
  /** Gemini embedding of the chunk text; absent until the chunk is embedded. */
  embedding?: number[];
  createdAt: Date;
}

export function chunksCollection() {
  return getDb().collection<ChunkDocument>("chunks");
}

export async function ensureChunkIndexes(): Promise<void> {
  await chunksCollection().createIndex(
    { fileId: 1, index: 1 },
    { unique: true },
  );
  // Listing and counting a session's files.
  await getDb().collection("files").createIndex({ ownerId: 1, createdAt: -1 });
}

interface SearchIndexField {
  type: string;
  path: string;
  numDimensions?: number;
}

/** Waits until a dropped search index is fully gone (dropping is asynchronous). */
async function waitForSearchIndexRemoval(name: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const remaining = await chunksCollection()
      .listSearchIndexes(name)
      .toArray();
    if (remaining.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Search index "${name}" was not removed within 60s.`);
}

/**
 * Creates the Atlas Vector Search index on chunk embeddings, or rebuilds it
 * when its filter fields are out of date. The index builds in the
 * background, so searches may return nothing for a short while afterwards.
 */
export async function ensureVectorSearchIndex(): Promise<void> {
  const collection = chunksCollection();
  const dimensions = geminiConfig.embeddingDimensions;
  const definition = {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions: dimensions,
        similarity: "cosine",
      },
      // Searches are always limited to the caller's session, optionally to some files.
      { type: "filter", path: "ownerId" },
      { type: "filter", path: "fileId" },
    ],
  };

  const create = async () => {
    await collection.createSearchIndex({
      name: VECTOR_INDEX_NAME,
      type: "vectorSearch",
      definition,
    });
    console.log(
      `Created vector search index "${VECTOR_INDEX_NAME}" (${dimensions} dimensions)`,
    );
  };

  const [index] = (await collection
    .listSearchIndexes(VECTOR_INDEX_NAME)
    .toArray()) as { latestDefinition?: { fields?: SearchIndexField[] } }[];

  if (!index) {
    await create();
    return;
  }

  const fields = index.latestDefinition?.fields ?? [];
  const indexed = fields.find((f) => f.type === "vector")?.numDimensions;
  if (indexed !== undefined && indexed !== dimensions) {
    console.warn(
      `Vector search index "${VECTOR_INDEX_NAME}" uses ${indexed} dimensions but GEMINI_EMBEDDING_DIMENSIONS is ${dimensions}. ` +
        "Not changing it: drop the index, re-embed all chunks, then run setup again.",
    );
    return;
  }

  const missingFilters = definition.fields.filter(
    (wanted) =>
      wanted.type === "filter" &&
      !fields.some((f) => f.type === "filter" && f.path === wanted.path),
  );
  if (missingFilters.length > 0) {
    // updateSearchIndex can't be used: it doesn't tell the server the index is
    // a vectorSearch index, so the server rejects the definition. Rebuild instead.
    console.log(
      `Vector search index "${VECTOR_INDEX_NAME}" is missing filters (${missingFilters.map((f) => f.path).join(", ")}); rebuilding it`,
    );
    await collection.dropSearchIndex(VECTOR_INDEX_NAME);
    await waitForSearchIndexRemoval(VECTOR_INDEX_NAME);
    await create();
  }
}

/** Saves the chunks of a newly uploaded file, in order. */
export async function insertChunks(
  fileId: ObjectId,
  ownerId: string,
  chunks: TextChunk[],
): Promise<void> {
  if (chunks.length === 0) return;

  const now = new Date();
  await chunksCollection().insertMany(
    chunks.map((chunk, index) => ({
      fileId,
      ownerId,
      index,
      text: chunk.text,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      createdAt: now,
    })),
  );
}

export async function countFileChunks(fileId: ObjectId): Promise<number> {
  return chunksCollection().countDocuments({ fileId });
}

export async function deleteFileChunks(fileId: ObjectId): Promise<void> {
  await chunksCollection().deleteMany({ fileId });
}

/**
 * Embeds every chunk of a file that has no embedding yet, saving each batch
 * as it completes. Safe to run again after a failure: it resumes where it
 * stopped. Reports progress before the first batch and after each one.
 * Returns the number of chunks embedded.
 */
export async function embedFileChunks(
  fileId: ObjectId,
  title: string,
  onProgress?: (embedded: number, total: number) => Promise<void>,
): Promise<number> {
  const collection = chunksCollection();
  const total = await countFileChunks(fileId);
  const pending = await collection
    .find(
      { fileId, embedding: { $exists: false } },
      { projection: { _id: 1, text: 1 } },
    )
    .sort({ index: 1 })
    .toArray();

  let embedded = total - pending.length;
  await onProgress?.(embedded, total);

  const batchSize = 100;
  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    const vectors = await embedTexts(
      batch.map((chunk) => formatDocumentForEmbedding(chunk.text, title)),
    );
    await collection.bulkWrite(
      batch.map((chunk, i) => ({
        updateOne: {
          filter: { _id: chunk._id },
          update: { $set: { embedding: vectors[i] ?? [] } },
        },
      })),
    );
    embedded += batch.length;
    await onProgress?.(embedded, total);
  }
  return pending.length;
}
