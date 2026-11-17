import path from "node:path";
import multer from "multer";
import { HttpError } from "../utils/http-error.js";

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === "application/pdf" &&
      path.extname(file.originalname).toLowerCase() === ".pdf";

    if (!isPdf) {
      cb(new HttpError(400, "Only PDF files are allowed."));
      return;
    }
    cb(null, true);
  },
}).single("file");
