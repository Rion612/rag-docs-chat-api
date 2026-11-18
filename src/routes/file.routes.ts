import { Router, type RequestHandler } from "express";
import { ObjectId } from "mongodb";
import { uploadLimiter } from "../middlewares/rate-limit.js";
import { sessionIdOf } from "../middlewares/require-session.js";
import { uploadPdf } from "../middlewares/upload.js";
import {
  countFilesByOwner,
  findFileById,
  savePdf,
  type FileDocument,
} from "../services/file.service.js";
import { HttpError } from "../utils/http-error.js";

const PDF_MAGIC_BYTES = Buffer.from("%PDF-");

// All routes here run behind requireSession (see index.ts).
export const fileRouter = Router();

function toFileResponse(file: FileDocument) {
  return {
    id: file._id.toHexString(),
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    storageProvider: file.storage.provider,
    storagePath: file.storage.key,
    status: file.status,
    pageCount: file.pageCount,
    chunkCount: file.chunkCount,
    error: file.error,
    processedAt: file.processedAt,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

/** Rejects the upload before the body is read if the session has hit its file cap. */
const enforceFileQuota: RequestHandler = async (req, _res, next) => {
  const max = Number(process.env.MAX_FILES_PER_SESSION || 20);
  if ((await countFilesByOwner(sessionIdOf(req))) >= max) {
    throw new HttpError(
      403,
      `File limit reached: a session can upload at most ${max} ${max === 1 ? "file" : "files"}.`,
    );
  }
  next();
};

fileRouter.post(
  "/",
  uploadLimiter,
  enforceFileQuota,
  uploadPdf,
  async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new HttpError(
        400,
        'No file uploaded. Send a PDF in the "file" field.',
      );
    }

    // The declared MIME type comes from the client; check the actual content too.
    if (
      !file.buffer.subarray(0, PDF_MAGIC_BYTES.length).equals(PDF_MAGIC_BYTES)
    ) {
      throw new HttpError(400, "File content is not a valid PDF.");
    }

    const saved = await savePdf(file, sessionIdOf(req));

    res.status(201).json(toFileResponse(saved));
  },
);

fileRouter.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    throw new HttpError(400, "Invalid file id.");
  }

  // Files of other sessions are reported as not found, not as forbidden,
  // so their IDs can't be probed.
  const file = await findFileById(new ObjectId(id), sessionIdOf(req));
  if (!file) {
    throw new HttpError(404, "File not found.");
  }

  res.json(toFileResponse(file));
});
