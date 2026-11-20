import { Router, type Response } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { chatLimiter } from "../middlewares/rate-limit.js";
import { sessionIdOf } from "../middlewares/require-session.js";
import { answerQuestion, streamAnswer } from "../services/chat.service.js";
import { isRetryableGeminiError } from "../utils/gemini-retry.js";
import { HttpError } from "../utils/http-error.js";

/** How often a comment is sent on a quiet stream so proxies keep it open. */
const KEEP_ALIVE_MS = 15_000;

const chatRequestSchema = z.object({
  question: z
    .string({ error: "question is required" })
    .trim()
    .min(1, "question must not be empty")
    .max(2000, "question must be at most 2000 characters"),
  /** Limit the search to these files. Omit to search all of your ready files. */
  fileIds: z
    .array(
      z
        .string()
        .refine((id) => ObjectId.isValid(id), "fileIds must be valid file ids"),
    )
    .max(50, "fileIds can list at most 50 files")
    .optional(),
});

function parseChatRequest(body: unknown) {
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return {
    question: parsed.data.question,
    ...(parsed.data.fileIds && { fileIds: parsed.data.fileIds }),
  };
}

// Runs behind requireSession (see index.ts).
export const chatRouter = Router();

chatRouter.post("/", chatLimiter, async (req, res) => {
  const result = await answerQuestion({
    ownerId: sessionIdOf(req),
    ...parseChatRequest(req.body),
  });

  res.json(result);
});

/**
 * Same as POST /, but streams the answer as Server-Sent Events:
 *   event: token  data: {"text": "..."}             (repeated)
 *   event: done   data: {"citations": [...], "model": "..."}
 *   event: error  data: {"error": "..."}            (only if it fails midway)
 * Errors before the first event are normal JSON error responses.
 */
chatRouter.post("/stream", chatLimiter, async (req, res) => {
  const input = parseChatRequest(req.body);

  // Stop generating (and paying for tokens) when the client goes away.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  let stream;
  try {
    stream = await streamAnswer({
      ownerId: sessionIdOf(req),
      ...input,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    throw error; // still a normal JSON error response
  }
  if (controller.signal.aborted) return;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // stop nginx from buffering the stream
  });
  res.flushHeaders();

  const keepAlive = setInterval(() => res.write(": ping\n\n"), KEEP_ALIVE_MS);

  try {
    for await (const event of stream) {
      if (event.type === "token") {
        sendEvent(res, "token", { text: event.text });
      } else {
        sendEvent(res, "done", {
          citations: event.citations,
          model: event.model,
        });
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      if (!(error instanceof HttpError) && !isRetryableGeminiError(error)) {
        console.error(error);
      }
      sendEvent(res, "error", { error: streamErrorMessage(error) });
    }
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

function sendEvent(res: Response, event: string, data: unknown): void {
  // JSON keeps newlines in the answer from breaking the SSE format.
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function streamErrorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (isRetryableGeminiError(error)) {
    return "The AI service stopped responding. Try again shortly.";
  }
  return "Something went wrong while writing the answer. Try again.";
}
