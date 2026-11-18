import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

// Limits are counted in memory, per server process. Running several
// instances needs a shared store (e.g. Redis) so they count together.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Counts per session when there is one, otherwise per IP address. */
function sessionOrIpKey(req: Request): string {
  return req.sessionId
    ? `session:${req.sessionId}`
    : `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

const common = {
  standardHeaders: "draft-8",
  legacyHeaders: false,
} as const;

/** New sessions per IP. Stops a client from creating sessions to dodge per-session limits. */
export const sessionCreationLimiter = rateLimit({
  ...common,
  windowMs: HOUR,
  limit: 20,
  message: { error: "Too many sessions created. Try again later." },
});

/** All requests to protected routes, per session. */
export const apiLimiter = rateLimit({
  ...common,
  windowMs: 15 * MINUTE,
  limit: 300,
  keyGenerator: sessionOrIpKey,
  message: { error: "Too many requests. Try again later." },
});

/** Questions per session. Each one costs a Gemini embedding and a generation. */
export const chatLimiter = rateLimit({
  ...common,
  windowMs: HOUR,
  limit: 60,
  keyGenerator: sessionOrIpKey,
  message: { error: "Question limit reached. Try again later." },
});

/** Uploads per session. Each upload costs Gemini embedding quota. */
export const uploadLimiter = rateLimit({
  ...common,
  windowMs: HOUR,
  limit: 10,
  keyGenerator: sessionOrIpKey,
  message: { error: "Upload limit reached. Try again later." },
});
