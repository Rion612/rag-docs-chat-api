import { Router } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { chatLimiter } from "../middlewares/rate-limit.js";
import { sessionIdOf } from "../middlewares/require-session.js";
import { answerQuestion } from "../services/chat.service.js";
import { HttpError } from "../utils/http-error.js";

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

// Runs behind requireSession (see index.ts).
export const chatRouter = Router();

chatRouter.post("/", chatLimiter, async (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }

  const result = await answerQuestion({
    ownerId: sessionIdOf(req),
    question: parsed.data.question,
    ...(parsed.data.fileIds && { fileIds: parsed.data.fileIds }),
  });

  res.json(result);
});
