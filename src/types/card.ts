export type CardColumn =
  | "todo"
  | "in_progress"
  | "review"
  | "idle"
  | "done";

export interface Card {
  id: string;
  title: string;
  column: CardColumn;
  position: number;
  sessionId: string | null;
  projectPath: string;
  projectId: string;
  createdAt: number;
  updatedAt: number;
  lastState: string | null;
  /** Comma-separated normalised tag slugs (lowercase, deduped). Empty
   *  string = no tags. Use `parseTags`/`joinTags` to round-trip via UI. */
  tags: string;
}

/** Split storage form into a clean array. Always returns lowercase
 *  unique slugs. Safe to call on `""` (returns `[]`). */
export function parseTags(raw: string): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const t of raw.split(",")) {
    const s = t.trim().toLowerCase();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function joinTags(tags: readonly string[]): string {
  return tags.map((t) => t.trim().toLowerCase()).filter(Boolean).join(",");
}
