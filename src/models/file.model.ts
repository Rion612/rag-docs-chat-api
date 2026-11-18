import type { ObjectId } from "mongodb";
import { getDb } from "../config/database.js";
import type { StoredObject } from "../storage/index.js";

export type FileStatus = "processing" | "ready" | "failed";

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
  /** Why processing failed, when status is "failed". */
  error?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function filesCollection() {
  return getDb().collection<FileDocument>("files");
}
