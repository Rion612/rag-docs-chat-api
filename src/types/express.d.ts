// Adds the anonymous session ID that requireSession attaches to each request.
declare module "express-serve-static-core" {
  interface Request {
    sessionId?: string;
  }
}

export {};
