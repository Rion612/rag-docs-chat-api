import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { HttpError } from "../utils/http-error.js";
import { MAX_FILE_SIZE_BYTES } from "./upload.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      const maxMb = MAX_FILE_SIZE_BYTES / (1024 * 1024);
      res.status(413).json({ error: `File exceeds the ${maxMb} MB limit.` });
      return;
    }
    if (
      err.code === "LIMIT_UNEXPECTED_FILE" ||
      err.code === "LIMIT_FILE_COUNT"
    ) {
      res
        .status(400)
        .json({ error: 'Upload exactly one file in the "file" field.' });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
