import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

const ISSUER = "rag-docs-chat-api";
const AUDIENCE = "rag-docs-chat-api:session";
const ALGORITHM = "HS256";

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be set.");
  return new TextEncoder().encode(secret);
}

function ttlDays(): number {
  return Number(process.env.SESSION_TTL_DAYS || 30);
}

export interface IssuedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

/**
 * Issues a token for a new anonymous session. The session ID is random and
 * owns every file uploaded with the token; nothing is stored server-side.
 */
export async function createSession(): Promise<IssuedSession> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + ttlDays() * 24 * 60 * 60 * 1000);

  const token = await new SignJWT()
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(sessionId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secretKey());

  return { token, sessionId, expiresAt };
}

/** Returns the session ID from a valid token, or throws if it is invalid or expired. */
export async function verifySessionToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secretKey(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: [ALGORITHM],
  });
  if (!payload.sub) throw new Error("Token has no subject.");
  return payload.sub;
}
