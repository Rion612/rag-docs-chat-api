import { extractText } from "unpdf";

/** Extracts text from a PDF, one cleaned-up string per page (index 0 = page 1). */
export async function extractPdfPages(buffer: Buffer): Promise<string[]> {
  // Pass a copy: pdf.js may take ownership of the bytes it is given.
  // Given raw bytes, extractText opens and closes the document itself.
  const { text } = await extractText(new Uint8Array(buffer), {
    mergePages: false,
  });
  return text.map(normalizePageText);
}

function normalizePageText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
