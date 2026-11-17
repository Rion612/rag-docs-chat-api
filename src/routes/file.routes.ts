import { Router } from "express";
import { uploadPdf } from "../middlewares/upload.js";
import { savePdf } from "../services/file.service.js";
import { HttpError } from "../utils/http-error.js";

const PDF_MAGIC_BYTES = Buffer.from("%PDF-");

export const fileRouter = Router();

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
  console.log;

  const saved = await savePdf(file);

  res.status(201).json({
    id: saved._id.toHexString(),
    originalName: saved.originalName,
    mimeType: saved.mimeType,
    size: saved.size,
    storagePath: saved.storagePath,
    createdAt: saved.createdAt,
  });
});
