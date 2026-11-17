import type { ObjectId } from "mongodb";
import { chunkPages, getChunkOptions } from "../processing/chunker.js";
import { extractPdfPages } from "../processing/pdf-extractor.js";
import { replaceChunks } from "./chunk.service.js";
import { filesCollection } from "./file.service.js";

/**
 * Extracts text from an uploaded PDF, chunks it, and stores the chunks.
 * Runs in the background after upload: it never throws, and records the
 * outcome on the file document as status "ready" or "failed".
 */
export async function processPdf(
  fileId: ObjectId,
  buffer: Buffer,
): Promise<void> {
  const files = filesCollection();

  try {
    const pages = await extractPdfPages(buffer);
    const chunks = chunkPages(pages, getChunkOptions());

    if (chunks.length === 0) {
      throw new Error(
        "No extractable text found. Scanned (image-only) PDFs are not supported.",
      );
    }

    await replaceChunks(fileId, chunks);
    await files.updateOne(
      { _id: fileId },
      {
        $set: {
          status: "ready",
          pageCount: pages.length,
          chunkCount: chunks.length,
          processedAt: new Date(),
          updatedAt: new Date(),
        },
        $unset: { error: "" },
      },
    );
    console.log(
      `Processed file ${fileId.toHexString()}: ${pages.length} pages, ${chunks.length} chunks`,
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
