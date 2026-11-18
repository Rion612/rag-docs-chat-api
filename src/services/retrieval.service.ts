import type { ObjectId } from "mongodb";
import { chunksCollection, VECTOR_INDEX_NAME } from "./chunk.service.js";

export interface RetrievedChunk {
  fileId: ObjectId;
  index: number;
  text: string;
  pageStart: number;
  pageEnd: number;
  /** Atlas similarity score, 0 to 1 (higher is closer). */
  score: number;
}

/**
 * Finds the chunks closest to the query vector. Always limited to the
 * owner's session and to the given files.
 */
export async function searchChunks(options: {
  ownerId: string;
  fileIds: ObjectId[];
  queryVector: number[];
  limit: number;
}): Promise<RetrievedChunk[]> {
  const { ownerId, fileIds, queryVector, limit } = options;

  return chunksCollection()
    .aggregate<RetrievedChunk>([
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: "embedding",
          queryVector,
          // Atlas recommends 10-20x the limit for good recall.
          numCandidates: limit * 20,
          limit,
          filter: { ownerId, fileId: { $in: fileIds } },
        },
      },
      {
        $project: {
          _id: 0,
          fileId: 1,
          index: 1,
          text: 1,
          pageStart: 1,
          pageEnd: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ])
    .toArray();
}

/**
 * $vectorSearch returns no results, rather than an error, when the index is
 * missing. Used to tell "nothing relevant" apart from "not set up".
 */
export async function vectorIndexExists(): Promise<boolean> {
  const indexes = await chunksCollection()
    .listSearchIndexes(VECTOR_INDEX_NAME)
    .toArray();
  return indexes.length > 0;
}
