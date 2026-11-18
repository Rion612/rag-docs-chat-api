import { Router } from "express";
import { createSession } from "../auth/session.js";
import { sessionCreationLimiter } from "../middlewares/rate-limit.js";

export const sessionRouter = Router();

/**
 * Starts an anonymous session. The frontend calls this once, stores the
 * token (e.g. in localStorage), and sends it on every request as
 * `Authorization: Bearer <token>`. Files uploaded with a token belong to
 * that session only.
 */
sessionRouter.post("/", sessionCreationLimiter, async (_req, res) => {
  const session = await createSession();
  res.status(201).json(session);
});
