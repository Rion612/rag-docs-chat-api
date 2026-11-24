import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Filter } from "mongodb";
import {
  filesCollection,
  PROCESSING_STATUSES,
  type FileDocument,
} from "../models/file.model.js";
import {
  PermanentProcessingError,
  processFile,
  type StageUpdate,
} from "../services/file-processing.service.js";

/** How often idle workers look for queued files. */
const POLL_INTERVAL_MS = 2_000;
/** A worker owns a file this long, renewed while it works on it. */
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;
/** Wait before retrying a failed attempt (multiplied by the attempt number). */
const RETRY_DELAY_MS = 15_000;

/** The worker lost the file to another worker after its lease expired. */
class LeaseLostError extends Error {}

const wakeUp = new EventEmitter();
wakeUp.setMaxListeners(0);

/** Lets idle workers in this process start on a new file right away. */
export function notifyFileQueued(): void {
  wakeUp.emit("wake");
}

export interface FileWorker {
  /** Stops taking new files. Files in progress resume elsewhere if the process exits. */
  stop(): void;
}

/**
 * Processes queued files in the background, `concurrency` at a time.
 * Several processes can run workers against the same database: each file
 * is claimed by one worker, and a worker that dies loses its claim when
 * the lease expires, so another worker picks the file up again.
 */
export function startFileWorker(concurrency: number): FileWorker {
  let stopped = false;

  const idle = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wakeUp.off("wake", done);
        resolve();
      };
      const timer = setTimeout(done, POLL_INTERVAL_MS);
      wakeUp.once("wake", done);
    });

  const runSlot = async () => {
    while (!stopped) {
      const lockToken = randomUUID();
      const file = await claimNextFile(lockToken).catch((error: unknown) => {
        console.error("File worker could not claim a file:", error);
        return null;
      });
      if (file) await runJob(file, lockToken);
      else await idle();
    }
  };

  void requeueLegacyFiles().finally(() => {
    for (let i = 0; i < concurrency; i++) void runSlot();
    console.log(`File worker started (${concurrency} at a time)`);
  });

  return {
    stop() {
      stopped = true;
      wakeUp.emit("wake");
    },
  };
}

/** Takes the oldest queued or abandoned file whose lease has expired. */
async function claimNextFile(lockToken: string): Promise<FileDocument | null> {
  const now = new Date();
  return filesCollection().findOneAndUpdate(
    {
      status: { $in: [...PROCESSING_STATUSES] },
      $or: [
        { lockedUntil: { $exists: false } },
        { lockedUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        lockedUntil: new Date(now.getTime() + LEASE_MS),
        lockToken,
      },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
}

async function runJob(file: FileDocument, lockToken: string): Promise<void> {
  const id = file._id.toHexString();
  const attempts = file.attempts ?? 1;
  // Updates only apply while this attempt still owns the file.
  const owned: Filter<FileDocument> = { _id: file._id, lockToken };

  // Attempts that never finished (e.g. the process crashed on this file).
  if (attempts > MAX_ATTEMPTS) {
    await finish(owned, "failed", {
      error:
        file.error ??
        "Processing stopped unexpectedly too many times. Try uploading again.",
    });
    return;
  }

  const update = async (set: Partial<FileDocument>, unset: string[] = []) => {
    const result = await filesCollection().updateOne(owned, {
      $set: { ...set, updatedAt: new Date() },
      ...(unset.length > 0 && {
        $unset: Object.fromEntries(unset.map((key) => [key, ""])),
      }),
    });
    if (result.matchedCount === 0) throw new LeaseLostError();
  };

  const renewLease = setInterval(() => {
    filesCollection()
      .updateOne(owned, {
        $set: { lockedUntil: new Date(Date.now() + LEASE_MS) },
      })
      .catch((error: unknown) =>
        console.error(`Could not renew the lease on file ${id}:`, error),
      );
  }, LEASE_MS / 3);

  try {
    const result = await processFile(file, (stage: StageUpdate) =>
      stage.status === "embedding"
        ? update({ status: stage.status, progress: stage.progress }, ["error"])
        : update({ status: stage.status }, ["progress", "error"]),
    );
    await finish(owned, "ready", { ...result, processedAt: new Date() });
    console.log(
      `Processed file ${id}: ${result.pageCount} pages, ${result.chunkCount} chunks embedded`,
    );
  } catch (error) {
    if (error instanceof LeaseLostError) {
      console.warn(`File ${id} was taken over by another worker`);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const retry =
      !(error instanceof PermanentProcessingError) && attempts < MAX_ATTEMPTS;
    console.error(
      `Failed to process file ${id} (attempt ${attempts}/${MAX_ATTEMPTS}${retry ? ", will retry" : ""}):`,
      error,
    );

    await (
      retry
        ? update({
            status: "queued",
            error: message,
            lockedUntil: new Date(Date.now() + RETRY_DELAY_MS * attempts),
          })
        : finish(owned, "failed", { error: message })
    ).catch((updateError: unknown) =>
      console.error(`Could not record the failure of file ${id}:`, updateError),
    );
  } finally {
    clearInterval(renewLease);
  }
}

/** Records the final status and releases the file. */
async function finish(
  owned: Filter<FileDocument>,
  status: "ready" | "failed",
  set: Partial<FileDocument>,
): Promise<void> {
  const unset = ["lockedUntil", "lockToken", "progress"];
  if (status === "ready") unset.push("error");
  await filesCollection().updateOne(owned, {
    $set: { ...set, status, updatedAt: new Date() },
    $unset: Object.fromEntries(unset.map((key) => [key, ""])),
  });
}

/**
 * Files uploaded before the queue existed were left as "processing" and
 * never finished. Queue them again.
 */
async function requeueLegacyFiles(): Promise<void> {
  try {
    const result = await filesCollection().updateMany(
      // "processing" is no longer a FileStatus, so the type can't express it.
      { status: "processing" } as unknown as Filter<FileDocument>,
      { $set: { status: "queued", updatedAt: new Date() } },
    );
    if (result.modifiedCount > 0) {
      console.log(`Re-queued ${result.modifiedCount} unfinished file(s)`);
    }
  } catch (error) {
    console.error("Could not re-queue unfinished files:", error);
  }
}
