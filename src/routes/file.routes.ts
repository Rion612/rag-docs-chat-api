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
import { openSse } from "../utils/sse.js";

const PDF_MAGIC_BYTES = Buffer.from("%PDF-");

/** How often the events stream checks the file for changes. */
const STATUS_POLL_MS = 1_000;

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
    progress: file.progress,
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

/**
 * Finds a file of the caller's session. Files of other sessions are
 * reported as not found, not as forbidden, so their IDs can't be probed.
 */
async function findOwnFile(id: string, ownerId: string) {
  if (!ObjectId.isValid(id)) {
    throw new HttpError(400, "Invalid file id.");
  }
  const file = await findFileById(new ObjectId(id), ownerId);
  if (!file) {
    throw new HttpError(404, "File not found.");
  }
  return file;
}

fileRouter.get("/:id", async (req, res) => {
  res.json(toFileResponse(await findOwnFile(req.params.id, sessionIdOf(req))));
});

/**
 * Streams the file's processing steps as Server-Sent Events:
 *   event: status  data: <same shape as GET /:id>   (on every change)
 *   event: error   data: {"error": "..."}
 * The first event is the current status. The stream ends after "ready" or
 * "failed"; clients should then stop listening instead of reconnecting.
 */
fileRouter.get("/:id/events", async (req, res) => {
  const ownerId = sessionIdOf(req);
  let file: FileDocument | null = await findOwnFile(req.params.id, ownerId);

  const sse = openSse(res);
  let lastSent = "";
  try {
    while (file && !sse.closed) {
      // Only status, progress and error changes are worth an event.
      const snapshot = JSON.stringify([file.status, file.progress, file.error]);
      if (snapshot !== lastSent) {
        sse.send("status", toFileResponse(file));
        lastSent = snapshot;
      }
      if (file.status === "ready" || file.status === "failed") break;

      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
      if (sse.closed) break;
      file = await findFileById(file._id, ownerId);
    }
    if (!file) sse.send("error", { error: "File not found." });
  } catch (error) {
    console.error(error);
    sse.send("error", { error: "Could not read the file status. Try again." });
  } finally {
    sse.close();
  }
});
