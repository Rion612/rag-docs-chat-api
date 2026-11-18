import type { ObjectId } from "mongodb";
import { getDb } from "../config/database.js";
import { geminiConfig } from "../config/gemini.js";
import type { TextChunk } from "../processing/chunker.js";
import { embedTexts, formatDocumentForEmbedding } from "./embedding.service.js";

export const VECTOR_INDEX_NAME = "chunks_vector_index";

export interface ChunkDocument {
  _id?: ObjectId;
  fileId: ObjectId;
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
}

/**
 * Creates the Atlas Vector Search index on chunk embeddings if it is missing.
 * The index builds in the background, so searches may return nothing for a
 * short while after it is first created.
 */
export async function ensureVectorSearchIndex(): Promise<void> {
  const collection = chunksCollection();
  const dimensions = geminiConfig.embeddingDimensions;

  const existing = await collection
    .listSearchIndexes(VECTOR_INDEX_NAME)
    .toArray();
  const index = existing[0] as
    | { latestDefinition?: { fields?: { numDimensions?: number }[] } }
    | undefined;

  if (!index) {
    await collection.createSearchIndex({
      name: VECTOR_INDEX_NAME,
      type: "vectorSearch",
      definition: {
        fields: [
          {
            type: "vector",
            path: "embedding",
            numDimensions: dimensions,
            similarity: "cosine",
          },
          { type: "filter", path: "fileId" },
        ],
      },
    });
    console.log(
      `Created vector search index "${VECTOR_INDEX_NAME}" (${dimensions} dimensions)`,
    );
    return;
  }

  const indexed = index.latestDefinition?.fields?.find(
    (f) => f.numDimensions !== undefined,
  )?.numDimensions;
  if (indexed !== undefined && indexed !== dimensions) {
    console.warn(
      `Vector search index "${VECTOR_INDEX_NAME}" uses ${indexed} dimensions but GEMINI_EMBEDDING_DIMENSIONS is ${dimensions}. ` +
        "Searches will fail until the index is rebuilt and all chunks are re-embedded.",
    );
  }
}

/** Saves the chunks of a newly uploaded file, in order. */
export async function insertChunks(
  fileId: ObjectId,
  chunks: TextChunk[],
): Promise<void> {
  if (chunks.length === 0) return;

  const now = new Date();
  await chunksCollection().insertMany(
    chunks.map((chunk, index) => ({
      fileId,
      index,
      text: chunk.text,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      createdAt: now,
    })),
  );
}

/**
 * Embeds every chunk of a file that has no embedding yet, saving each batch
 * as it completes. Safe to run again after a failure: it resumes where it
 * stopped. Returns the number of chunks embedded.
 */
export async function embedFileChunks(
  fileId: ObjectId,
  title: string,
): Promise<number> {
  const collection = chunksCollection();
  const pending = await collection
    .find(
      { fileId, embedding: { $exists: false } },
      { projection: { _id: 1, text: 1 } },
    )
    .sort({ index: 1 })
    .toArray();

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
  }
  return pending.length;
}
