import { geminiConfig, getGemini } from "../config/gemini.js";
import { withGeminiRetry, type RetryOptions } from "../utils/gemini-retry.js";

/** Gemini rejects batch embedding requests with more than 100 texts. */
const MAX_BATCH_SIZE = 100;

/**
 * gemini-embedding-2 has no taskType option; the task goes in the text itself.
 * Documents and questions use different formats so they match each other well.
 */
export function formatDocumentForEmbedding(
  text: string,
  title?: string,
): string {
  return `title: ${title?.trim() || "none"} | text: ${text}`;
}

export function formatQueryForEmbedding(question: string): string {
  return `task: question answering | query: ${question}`;
}

/**
 * Embeds texts in batches, returning one vector per text in the same order.
 * Texts must already be formatted with the functions above.
 */
export async function embedTexts(
  texts: string[],
  retry?: RetryOptions,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += MAX_BATCH_SIZE) {
    const batch = texts.slice(start, start + MAX_BATCH_SIZE);
    vectors.push(...(await embedBatch(batch, retry)));
  }
  return vectors;
}

async function embedBatch(
  texts: string[],
  retry?: RetryOptions,
): Promise<number[][]> {
  const response = await withGeminiRetry(
    () =>
      getGemini().models.embedContent({
        model: geminiConfig.embeddingModel,
        // Each text must be its own Content object. Passing plain strings makes
        // gemini-embedding-2 return one combined embedding for all of them.
        contents: texts.map((text) => ({ parts: [{ text }] })),
        config: { outputDimensionality: geminiConfig.embeddingDimensions },
      }),
    retry,
  );

  const vectors = (response.embeddings ?? []).map((e) => e.values ?? []);
  if (vectors.length !== texts.length) {
    throw new Error(
      `Expected ${texts.length} embeddings from Gemini, got ${vectors.length}.`,
    );
  }
  for (const vector of vectors) {
    if (vector.length !== geminiConfig.embeddingDimensions) {
      throw new Error(
        `Expected ${geminiConfig.embeddingDimensions}-dimension embeddings, got ${vector.length}.`,
      );
    }
  }
  return vectors;
}
