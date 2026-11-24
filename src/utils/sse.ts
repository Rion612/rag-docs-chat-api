import type { Response } from "express";

/** How often a comment is sent on a quiet stream so proxies keep it open. */
const KEEP_ALIVE_MS = 15_000;

export interface SseStream {
  /** Sends one event. Does nothing once the stream is closed. */
  send(event: string, data: unknown): void;
  /** Ends the response. */
  close(): void;
  /** True once the client disconnected or close() was called. */
  readonly closed: boolean;
}

/**
 * Starts a Server-Sent Events response: sends the headers right away and
 * keeps the connection alive until close() or the client disconnects.
 * Errors must be checked before calling this; afterwards the status is 200.
 */
export function openSse(res: Response): SseStream {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // stop nginx from buffering the stream
  });
  res.flushHeaders();

  let closed = false;
  const keepAlive = setInterval(() => res.write(": ping\n\n"), KEEP_ALIVE_MS);
  const cleanUp = () => {
    closed = true;
    clearInterval(keepAlive);
  };
  res.on("close", cleanUp);

  return {
    send(event, data) {
      // JSON keeps newlines in the data from breaking the SSE format.
      if (!closed)
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      cleanUp();
      res.end();
    },
    get closed() {
      return closed;
    },
  };
}
