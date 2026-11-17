import type { ObjectId } from "mongodb";
import { getDb } from "../config/database.js";
import type { TextChunk } from "../processing/chunker.js";

export interface ChunkDocument {
  _id?: ObjectId;
  fileId: ObjectId;
  /** 0-based position of the chunk within the file. */
  index: number;
  text: string;
  pageStart: number;
  pageEnd: number;
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

/** Replaces all chunks of a file, so reprocessing a file never duplicates them. */
export async function replaceChunks(
  fileId: ObjectId,
  chunks: TextChunk[],
): Promise<void> {
  const collection = chunksCollection();
  await collection.deleteMany({ fileId });
  if (chunks.length === 0) return;

  const now = new Date();
  await collection.insertMany(
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
