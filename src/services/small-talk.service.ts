const GREETINGS = [
  "hi",
  "hii",
  "hello",
  "hey",
  "hiya",
  "good morning",
  "good afternoon",
  "good evening",
];

/**
 * Whole messages that are only small talk. A message must match exactly
 * (after normalizing), so "hi, what is this PDF about?" is still a question.
 */
const SMALL_TALK = new Set([
  ...GREETINGS,
  "hi there",
  "hello there",
  "hey there",
  "how are you",
  // thanks
  "thanks",
  "thank you",
  "thanks a lot",
  "thank you so much",
  "thx",
  "ty",
  // goodbyes
  "bye",
  "goodbye",
  "bye bye",
  "see you",
  "see ya",
]);

/**
 * True for greetings, thanks and goodbyes. These are answered as a general
 * chat instead of searching the documents.
 */
export function isSmallTalk(question: string): boolean {
  return SMALL_TALK.has(normalize(question));
}

/** True when the message opens with a greeting, e.g. "HI, do you know C++?". */
export function startsWithGreeting(question: string): boolean {
  const text = normalize(question);
  return GREETINGS.some(
    (greeting) => text === greeting || text.startsWith(`${greeting} `),
  );
}

/** "Hello!! 👋" → "hello" */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
