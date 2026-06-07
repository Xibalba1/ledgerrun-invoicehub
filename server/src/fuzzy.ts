// Normalized string similarity for entity resolution. No dependency: a blend of
// character-bigram Dice (catches "Pharmaceuticals" ~ "Pharma") and token-set Dice
// (catches word reordering / extra words). Returns 0..1.

const NOISE = new Set(["inc", "llc", "ltd", "co", "corp", "the", "of", "and", "for", "study", "trial"]);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t && !NOISE.has(t));
}

function bigrams(s: string): string[] {
  const c = normalize(s).replace(/\s/g, "");
  if (c.length < 2) return c ? [c] : [];
  const out: string[] = [];
  for (let i = 0; i < c.length - 1; i++) out.push(c.slice(i, i + 2));
  return out;
}

function dice(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  let overlap = 0;
  for (const y of b) {
    const n = counts.get(y) ?? 0;
    if (n > 0) {
      overlap++;
      counts.set(y, n - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

// Token coverage of the smaller set — rewards containment ("VERITAS" inside
// "VERITAS Phase 2 Study"), which plain Dice penalizes for the extra words.
function coverage(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set(a);
  const overlap = b.filter((t) => set.has(t)).length;
  return overlap / Math.min(a.length, b.length);
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  return 0.4 * dice(bigrams(a), bigrams(b)) + 0.3 * dice(ta, tb) + 0.3 * coverage(ta, tb);
}

/** Compare protocol numbers ignoring case and punctuation (e.g. dashes). */
export function protocolEquals(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a) === norm(b);
}

export interface Ranked<T> {
  best: T | null;
  score: number;
  alternatives: { item: T; score: number }[];
}

/** Rank candidates by similarity of `name(candidate)` to `query`. */
export function rank<T>(query: string, candidates: T[], name: (c: T) => string): Ranked<T> {
  const scored = candidates
    .map((item) => ({ item, score: similarity(query, name(item)) }))
    .sort((x, y) => y.score - x.score);
  const top = scored[0];
  return {
    best: top ? top.item : null,
    score: top ? top.score : 0,
    alternatives: scored.slice(0, 5).map(({ item, score }) => ({ item, score })),
  };
}
