import type { Request, RequestHandler } from "express";
import { verifySessionToken } from "../auth/session.js";
import { HttpError } from "../utils/http-error.js";

/** Rejects requests without a valid `Authorization: Bearer <session token>`. */
export const requireSession: RequestHandler = async (req, _res, next) => {
  const [scheme, token] = req.headers.authorization?.split(" ") ?? [];
  if (scheme !== "Bearer" || !token) {
    throw new HttpError(
      401,
      "Missing session token. Create one with POST /api/sessions and send it as 'Authorization: Bearer <token>'.",
    );
  }

  try {
    req.sessionId = await verifySessionToken(token);
  } catch {
    throw new HttpError(
      401,
      "Invalid or expired session token. Create a new one with POST /api/sessions.",
    );
  }
  next();
};

/** The caller's session ID. Only valid on routes behind requireSession. */
export function sessionIdOf(req: Request): string {
  if (!req.sessionId) {
    throw new Error("sessionIdOf() used on a route without requireSession.");
  }
  return req.sessionId;
}
