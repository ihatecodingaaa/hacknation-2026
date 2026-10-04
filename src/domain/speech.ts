// Spoken answers are messy: "that, that the de- the deployment caused the
// accident, the incident". Matching works on a cleaned copy, but every span
// is mapped back to the original transcript, so quotes shown as evidence are
// always the expert's exact words. The original text is never rewritten.

export interface Normalized {
  /** Cleaned text used for matching only. */
  text: string;
  /** For each character of `text`, its index in the original transcript. */
  map: number[];
}

// Each pattern removes a span from the text it runs on.
const DISFLUENCIES: RegExp[] = [
  // Filler sounds: "uh", "um", "erm", "hmm".
  /\b(?:u+h+|u+m+|uhm|erm|hmm+)\b,?\s*/gi,
  // Filler phrases.
  /\b(?:i mean|you know)\b,?\s*/gi,
  // Words cut off mid-way, only when the next word or the one after starts
  // the same way: "the de- the deployment", "re- restart". "normal- only"
  // is left alone, so a claim is never flipped by cleaning.
  /\b([a-z]{1,8})-\s+(?=(?:[a-z']+\s+)?\1)/gi,
  // Immediate repeats: "that, that", "the the". The first copy goes.
  /\b([a-z']+)\b,?\s+(?=\1\b)/gi,
];

function identity(text: string): Normalized {
  return { text, map: Array.from(text, (_, i) => i) };
}

function drop(src: Normalized, re: RegExp): Normalized {
  const keep = new Array<boolean>(src.text.length).fill(true);
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src.text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    for (let i = m.index; i < m.index + m[0].length; i++) keep[i] = false;
  }
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < src.text.length; i++) {
    if (!keep[i]) continue;
    text += src.text[i];
    map.push(src.map[i]);
  }
  return { text, map };
}

export function normalizeSpeech(original: string): Normalized {
  return DISFLUENCIES.reduce(drop, identity(original));
}

/** Map a [start, end) span of normalized text back to the original transcript. */
export function toOriginalSpan(n: Normalized, start: number, end: number): { start: number; end: number } {
  return { start: n.map[start], end: n.map[end - 1] + 1 };
}

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokens(n: Normalized): Token[] {
  const out: Token[] = [];
  const re = /[a-z0-9]+(?:['.][a-z0-9]+)*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(n.text))) {
    const span = toOriginalSpan(n, m.index, m.index + m[0].length);
    out.push({ word: m[0].toLowerCase(), ...span });
  }
  return out;
}

/** Up to this many extra transcript words may sit between two quoted words. */
const MAX_GAP = 3;
/** Negation words a quote may never add, drop or skip over. */
const NEGATOR = /^(?:not|no|never|none|nothing|neither|nor|without|cannot|\w+n't)$/;
/** Words just before a match that would negate it ("did not cause this"). */
const LOOKBEHIND = 2;

function negations(words: string[]): number {
  return words.filter((w) => NEGATOR.test(w)).length;
}
/** Share of the quote's words that must be found, in order. */
const MIN_COVERAGE = 0.8;

/**
 * Find where a quote (for example one returned by a language model) occurs in
 * the original transcript. Tolerates disfluencies, punctuation and small
 * self-corrections, but every matched word must really be in the transcript,
 * in order. Returns null when the quote cannot be traced to the expert's words.
 */
export function locateQuote(original: string, quote: string): { start: number; end: number } | null {
  const hay = tokens(normalizeSpeech(original));
  const needle = tokens(normalizeSpeech(quote)).map((t) => t.word);
  if (needle.length === 0 || hay.length === 0) return null;

  let best: { score: number; start: number; end: number } | null = null;
  for (let i = 0; i < hay.length; i++) {
    if (hay[i].word !== needle[0] && hay[i].word !== needle[1]) continue;
    let pos = i;
    let matched = 0;
    let first = -1;
    let last = -1;
    for (const word of needle) {
      const limit = first === -1 ? i : Math.min(hay.length - 1, pos + MAX_GAP);
      let found = -1;
      for (let k = pos; k <= limit; k++) {
        if (hay[k].word === word) {
          found = k;
          break;
        }
      }
      if (found === -1) continue;
      matched++;
      if (first === -1) first = found;
      last = found;
      pos = found + 1;
    }
    if (first === -1) continue;
    // Negation must agree exactly: the matched stretch of transcript (plus the
    // words just before it) carries the same "not"s as the quote, no more, no fewer.
    const window = hay.slice(Math.max(0, first - LOOKBEHIND), last + 1).map((t) => t.word);
    if (negations(window) !== negations(needle)) continue;
    const score = matched / needle.length;
    const enough = needle.length <= 2 ? matched === needle.length : score >= MIN_COVERAGE;
    if (enough && (!best || score > best.score)) {
      best = { score, start: hay[first].start, end: hay[last].end };
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

/** Words that mark a statement as a guess, not a claim. "I think" is not one: experts say it when sure. */
const HEDGE = /\b(?:maybe|might|perhaps|possibly|probably|not sure|unsure|i guess|could be|i'?m not certain)\b/i;

/**
 * Is the claim at this span hedged? Looks at the clause around it: from the
 * previous clause break (. , ; ! ?) to the end of the span. Deterministic, and
 * it can only remove claims, never add them.
 */
export function isHedged(text: string, span: { start: number; end: number }): string | null {
  let from = span.start;
  while (from > 0 && !/[.,;!?]/.test(text[from - 1])) from--;
  let to = span.end;
  while (to < text.length && !/[.,;!?]/.test(text[to])) to++;
  return HEDGE.exec(text.slice(from, to))?.[0] ?? null;
}
