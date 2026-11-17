import { Router } from "express";
import { ObjectId } from "mongodb";
import { uploadPdf } from "../middlewares/upload.js";
import { processPdf } from "../services/file-processing.service.js";
import {
  findFileById,
  savePdf,
  type FileDocument,
} from "../services/file.service.js";
import { HttpError } from "../utils/http-error.js";

const PDF_MAGIC_BYTES = Buffer.from("%PDF-");

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

fileRouter.post("/", uploadPdf, async (req, res) => {
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

  const saved = await savePdf(file);

  // Extract and chunk in the background; poll GET /api/files/:id for status.
  void processPdf(saved._id, file.buffer);

  res.status(201).json(toFileResponse(saved));
});

fileRouter.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    throw new HttpError(400, "Invalid file id.");
  }

  const file = await findFileById(new ObjectId(id));
  if (!file) {
    throw new HttpError(404, "File not found.");
  }

  res.json(toFileResponse(file));
});
