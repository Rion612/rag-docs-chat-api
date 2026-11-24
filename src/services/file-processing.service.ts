import path from "node:path";
import { geminiConfig } from "../config/gemini.js";
import type { FileDocument, FileProgress } from "../models/file.model.js";
import { chunkPages, getChunkOptions } from "../processing/chunker.js";
import { extractPdfPages } from "../processing/pdf-extractor.js";
import { getStorage } from "../storage/index.js";
import {
  countFileChunks,
  deleteFileChunks,
  embedFileChunks,
  insertChunks,
} from "./chunk.service.js";

/** A failure that retrying cannot fix, e.g. a PDF without text. */
export class PermanentProcessingError extends Error {}

export type StageUpdate =
  | { status: "extracting" }
  | { status: "chunking" }
  | { status: "embedding"; progress: FileProgress };

export interface ProcessingResult {
  pageCount: number;
  chunkCount: number;
  embeddingModel: string;
  embeddingDimensions: number;
}

/**
 * Extracts the text of a stored PDF, chunks it, and embeds the chunks,
 * reporting each step. Safe to run again after a failure: chunks saved by
 * an earlier attempt are reused, so finished embeddings aren't redone.
 */
export async function processFile(
  file: FileDocument,
  report: (update: StageUpdate) => Promise<void>,
): Promise<ProcessingResult> {
  await report({ status: "extracting" });
  const buffer = await getStorage().download(file.storage.key);
  const pages = await extractPdfPages(buffer);

  await report({ status: "chunking" });
  const chunks = chunkPages(pages, getChunkOptions());
  if (chunks.length === 0) {
    throw new PermanentProcessingError(
      "No extractable text found. Scanned (image-only) PDFs are not supported.",
    );
  }
  if ((await countFileChunks(file._id)) !== chunks.length) {
    await deleteFileChunks(file._id);
    await insertChunks(file._id, file.ownerId, chunks);
  }

  // The file name (without .pdf) is the embedding title for every chunk.
  const title = path.parse(file.originalName).name;
  await embedFileChunks(file._id, title, (embeddedChunks, totalChunks) =>
    report({ status: "embedding", progress: { embeddedChunks, totalChunks } }),
  );

  return {
    pageCount: pages.length,
    chunkCount: chunks.length,
    embeddingModel: geminiConfig.embeddingModel,
    embeddingDimensions: geminiConfig.embeddingDimensions,
  };
}
