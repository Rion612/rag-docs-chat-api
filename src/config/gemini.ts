import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | undefined;

export function getGemini(): GoogleGenAI {
  if (client) return client;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY must be set to call the Gemini API.");
  }

  client = new GoogleGenAI({ apiKey });
  return client;
}

function embeddingDimensions(): number {
  const value = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 768);
  if (!Number.isInteger(value) || value < 128 || value > 3072) {
    throw new Error(
      "GEMINI_EMBEDDING_DIMENSIONS must be an integer between 128 and 3072.",
    );
  }
  return value;
}

// Getters read the environment when used, not when this module is imported,
// so startup validation (validateEnv) runs before any of these values are read.
export const geminiConfig = {
  /** Model that writes answers from retrieved chunks. */
  get chatModel(): string {
    return process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash-lite";
  },
  /** Model that turns chunks and questions into vectors. */
  get embeddingModel(): string {
    return process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
  },
  /**
   * Vector size. Must match numDimensions in the Atlas vector search index,
   * and changing it later means re-embedding every stored chunk.
   */
  get embeddingDimensions(): number {
    return embeddingDimensions();
  },
};
