import { ObjectId } from "mongodb";
import { filesCollection, type FileDocument } from "../models/file.model.js";
import { getStorage } from "../storage/index.js";
import { notifyFileQueued } from "../workers/file-worker.js";

export type { FileDocument, FileStatus } from "../models/file.model.js";

/** Finds a file only if it belongs to the given session. */
export async function findFileById(
  id: ObjectId,
  ownerId: string,
): Promise<FileDocument | null> {
  return filesCollection().findOne({ _id: id, ownerId });
}

export async function countFilesByOwner(ownerId: string): Promise<number> {
  return filesCollection().countDocuments({ ownerId });
}

/**
 * Stores an uploaded PDF and its metadata and queues it for processing.
 * Returns as soon as the file is stored, with status "queued". The file
 * worker then moves it through extracting, chunking and embedding to
 * "ready" or "failed".
 */
export async function savePdf(
  file: Express.Multer.File,
  ownerId: string,
): Promise<FileDocument> {
  const id = new ObjectId();
  const key = `pdfs/${id.toHexString()}.pdf`;
  const storage = getStorage();

  const stored = await storage.upload(key, file.buffer, "application/pdf");

  const now = new Date();
  const doc: FileDocument = {
    _id: id,
    ownerId,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    storage: stored,
    status: "queued",
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

  notifyFileQueued();
  return doc;
}
