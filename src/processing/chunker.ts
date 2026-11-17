export interface ChunkOptions {
  /** Maximum characters per chunk. */
  chunkSize: number;
  /** Characters repeated from the end of one chunk at the start of the next. */
  chunkOverlap: number;
}

export interface TextChunk {
  text: string;
  /** 1-based page where the chunk starts. */
  pageStart: number;
  /** 1-based page where the chunk ends. */
  pageEnd: number;
}

interface Segment {
  text: string;
  page: number;
}

export function getChunkOptions(): ChunkOptions {
  const chunkSize = Number(process.env.CHUNK_SIZE || 1000);
  const chunkOverlap = Number(process.env.CHUNK_OVERLAP || 200);

  if (!Number.isInteger(chunkSize) || chunkSize < 100) {
    throw new Error("CHUNK_SIZE must be an integer of at least 100.");
  }
  if (
    !Number.isInteger(chunkOverlap) ||
    chunkOverlap < 0 ||
    chunkOverlap >= chunkSize
  ) {
    throw new Error(
      "CHUNK_OVERLAP must be a non-negative integer smaller than CHUNK_SIZE.",
    );
  }
  return { chunkSize, chunkOverlap };
}

/**
 * Splits page texts into overlapping chunks. Lines are kept whole where
 * possible, so chunks break between lines rather than mid-sentence.
 */
export function chunkPages(
  pages: string[],
  { chunkSize, chunkOverlap }: ChunkOptions,
): TextChunk[] {
  const segments = pages.flatMap((pageText, i) =>
    pageText
      .split("\n")
      .flatMap((line) => splitLongText(line, chunkSize))
      .map((text) => ({ text, page: i + 1 })),
  );

  const chunks: TextChunk[] = [];
  let current: Segment[] = [];
  let currentLength = 0;
  let hasNewContent = false;

  const emit = () => {
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last || !hasNewContent) return;
    chunks.push({
      text: current.map((s) => s.text).join("\n"),
      pageStart: first.page,
      pageEnd: last.page,
    });
  };

  for (const segment of segments) {
    const added = (current.length > 0 ? 1 : 0) + segment.text.length;

    if (current.length > 0 && currentLength + added > chunkSize) {
      emit();
      current = takeOverlap(current, chunkOverlap);
      currentLength = joinedLength(current);
      hasNewContent = false;

      // Drop overlap from the front until the new segment fits.
      while (
        current.length > 0 &&
        currentLength + 1 + segment.text.length > chunkSize
      ) {
        current.shift();
        currentLength = joinedLength(current);
      }
    }

    current.push(segment);
    currentLength = joinedLength(current);
    hasNewContent = true;
  }
  emit();

  return chunks;
}

/** The trailing segments of a chunk, up to `overlap` characters. */
function takeOverlap(segments: Segment[], overlap: number): Segment[] {
  const result: Segment[] = [];
  let length = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment) break;
    const next = length + (result.length > 0 ? 1 : 0) + segment.text.length;
    if (next > overlap) break;
    result.unshift(segment);
    length = next;
  }
  return result;
}

function joinedLength(segments: Segment[]): number {
  if (segments.length === 0) return 0;
  return (
    segments.reduce((sum, s) => sum + s.text.length, 0) + segments.length - 1
  );
}

/** Splits text longer than `max` at word boundaries (or hard, for huge words). */
function splitLongText(text: string, max: number): string[] {
  if (text.length <= max) return [text];

  const pieces: string[] = [];
  let piece = "";
  for (const word of text.split(" ")) {
    if (word.length > max) {
      if (piece) pieces.push(piece);
      for (let i = 0; i < word.length; i += max) {
        pieces.push(word.slice(i, i + max));
      }
      piece = "";
    } else if (!piece) {
      piece = word;
    } else if (piece.length + 1 + word.length <= max) {
      piece += ` ${word}`;
    } else {
      pieces.push(piece);
      piece = word;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}
