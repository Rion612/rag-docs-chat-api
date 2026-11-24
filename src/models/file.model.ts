import type { ObjectId } from "mongodb";
import { getDb } from "../config/database.js";
import type { StoredObject } from "../storage/index.js";

/** The steps a file goes through after upload, in order. */
export const PROCESSING_STATUSES = [
  "queued",
  "extracting",
  "chunking",
  "embedding",
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export type FileStatus = ProcessingStatus | "ready" | "failed";

export interface FileProgress {
  embeddedChunks: number;
  totalChunks: number;
}

export interface FileDocument {
  _id: ObjectId;
  /** Anonymous session that uploaded the file; only it can access the file. */
  ownerId: string;
  originalName: string;
  mimeType: string;
  size: number;
  storage: StoredObject;
  status: FileStatus;
  pageCount?: number;
  chunkCount?: number;
  /** Model and size of the chunk embeddings; re-embed if these change. */
  embeddingModel?: string;
  embeddingDimensions?: number;
  /** Embedding progress, while status is "embedding". */
  progress?: FileProgress;
  /** Why processing failed: final when "failed", the last attempt when retrying. */
  error?: string;
  /** Processing attempts started so far. */
  attempts?: number;
  /** A worker owns the file until then. Also delays the next retry. */
  lockedUntil?: Date;
  /** Identifies the worker attempt that owns the file. */
  lockToken?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function filesCollection() {
  return getDb().collection<FileDocument>("files");
}
