import { ApiError } from "@google/genai";
import { geminiConfig, getGemini } from "../config/gemini.js";

/** Gemini rejects batch embedding requests with more than 100 texts. */
const MAX_BATCH_SIZE = 100;
const MAX_RETRIES = 6;
const MAX_RETRY_DELAY_MS = 60_000;

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
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += MAX_BATCH_SIZE) {
    const batch = texts.slice(start, start + MAX_BATCH_SIZE);
    vectors.push(...(await embedBatch(batch)));
  }
  return vectors;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await withRetry(() =>
    getGemini().models.embedContent({
      model: geminiConfig.embeddingModel,
      // Each text must be its own Content object. Passing plain strings makes
      // gemini-embedding-2 return one combined embedding for all of them.
      contents: texts.map((text) => ({ parts: [{ text }] })),
      config: { outputDimensionality: geminiConfig.embeddingDimensions },
    }),
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

/** Retries rate-limit (429) and server (5xx) errors, waiting as long as Gemini asks. */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const retryable =
        error instanceof ApiError &&
        (error.status === 429 || error.status >= 500);
      if (!retryable || attempt >= MAX_RETRIES) throw error;

      const delayMs = Math.min(
        retryDelayFromError(error) ?? 2 ** attempt * 1000,
        MAX_RETRY_DELAY_MS,
      );
      console.warn(
        `Gemini returned ${error.status}; retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** Reads the delay from Gemini's RetryInfo, e.g. "retryDelay":"7s". */
function retryDelayFromError(error: ApiError): number | undefined {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(error.message);
  // Add a second of margin so the quota window has actually reset.
  return match?.[1] ? Number(match[1]) * 1000 + 1000 : undefined;
}
