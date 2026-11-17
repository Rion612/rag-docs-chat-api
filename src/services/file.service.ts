import { ObjectId } from "mongodb";
import { getDb } from "../config/database.js";
import { getStorage, type StoredObject } from "../storage/index.js";

export type FileStatus = "processing" | "ready" | "failed";

export interface FileDocument {
  _id: ObjectId;
  originalName: string;
  mimeType: string;
  size: number;
  storage: StoredObject;
  status: FileStatus;
  pageCount?: number;
  chunkCount?: number;
  /** Why processing failed, when status is "failed". */
  error?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function filesCollection() {
  return getDb().collection<FileDocument>("files");
}

export async function findFileById(id: ObjectId): Promise<FileDocument | null> {
  return filesCollection().findOne({ _id: id });
}

export async function savePdf(
  file: Express.Multer.File,
): Promise<FileDocument> {
  const id = new ObjectId();
  const key = `pdfs/${id.toHexString()}.pdf`;
  const storage = getStorage();

  const stored = await storage.upload(key, file.buffer, "application/pdf");

  const now = new Date();
  const doc: FileDocument = {
    _id: id,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    storage: stored,
    status: "processing",
    createdAt: now,
    updatedAt: now,
  };

  try {
    await filesCollection().insertOne(doc);
  } catch (error) {
    // Don't leave an orphaned file in storage if the metadata write fails.
    await storage.delete(key).catch(() => undefined);
    throw error;
  }

  return doc;
}
