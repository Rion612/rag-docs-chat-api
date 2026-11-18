import { ApiError } from "@google/genai";

export interface RetryOptions {
  /** Retries after the first attempt. */
  maxRetries?: number;
  /** Longest single wait between attempts. */
  maxDelayMs?: number;
}

/**
 * Retries rate-limit (429) and server (5xx) errors from Gemini, waiting as
 * long as Gemini asks. Defaults suit background work; interactive requests
 * should pass smaller limits so callers aren't kept waiting.
 */
export async function withGeminiRetry<T>(
  call: () => Promise<T>,
  { maxRetries = 6, maxDelayMs = 60_000 }: RetryOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (!isRetryableGeminiError(error) || attempt >= maxRetries) throw error;

      const delayMs = Math.min(
        retryDelayFromError(error) ?? 2 ** attempt * 1000,
        maxDelayMs,
      );
      console.warn(
        `Gemini returned ${error.status}; retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export function isRetryableGeminiError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && (error.status === 429 || error.status >= 500)
  );
}

/** Reads the delay from Gemini's RetryInfo, e.g. "retryDelay":"7s". */
function retryDelayFromError(error: ApiError): number | undefined {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(error.message);
  // Add a second of margin so the quota window has actually reset.
  return match?.[1] ? Number(match[1]) * 1000 + 1000 : undefined;
}
