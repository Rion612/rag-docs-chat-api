import path from "node:path";
import type { ObjectId } from "mongodb";
import { geminiConfig } from "../config/gemini.js";
import { chunkPages, getChunkOptions } from "../processing/chunker.js";
import { extractPdfPages } from "../processing/pdf-extractor.js";
import { embedFileChunks, insertChunks } from "./chunk.service.js";
import { filesCollection } from "../models/file.model.js";

/**
 * Extracts text from an uploaded PDF, chunks it, embeds the chunks, and
 * stores them. Runs in the background after upload: it never throws, and
 * records the outcome on the file document as status "ready" or "failed".
 */
export async function processPdf(
  fileId: ObjectId,
  buffer: Buffer,
): Promise<void> {
  const files = filesCollection();

  try {
    const file = await files.findOne(
      { _id: fileId },
      { projection: { originalName: 1, ownerId: 1 } },
    );
    if (!file) throw new Error("File record not found.");

    // The file name (without .pdf) is the embedding title for every chunk.
    const title = path.parse(file.originalName).name;

    const pages = await extractPdfPages(buffer);
    const chunks = chunkPages(pages, getChunkOptions());

    if (chunks.length === 0) {
      throw new Error(
        "No extractable text found. Scanned (image-only) PDFs are not supported.",
      );
    }

    await insertChunks(fileId, file.ownerId, chunks);
    await embedFileChunks(fileId, title);

    await files.updateOne(
      { _id: fileId },
      {
        $set: {
          status: "ready",
          pageCount: pages.length,
          chunkCount: chunks.length,
          embeddingModel: geminiConfig.embeddingModel,
          embeddingDimensions: geminiConfig.embeddingDimensions,
          processedAt: new Date(),
          updatedAt: new Date(),
        },
        $unset: { error: "" },
      },
    );
    console.log(
      `Processed file ${fileId.toHexString()}: ${pages.length} pages, ${chunks.length} chunks embedded`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to process file ${fileId.toHexString()}:`, error);
    await files
      .updateOne(
        { _id: fileId },
        { $set: { status: "failed", error: message, updatedAt: new Date() } },
      )
      .catch((updateError: unknown) =>
        console.error("Failed to record processing failure:", updateError),
      );
  }
}
