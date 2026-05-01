export type CardColumn =
  | "todo"
  | "in_progress"
  | "review"
  | "idle"
  | "done";

/**
 * Permission modes accepted by the Claude Agent SDK (and surfaced in our UI).
 *
 *   - default            → ask the user for every tool call (current behaviour
 *                          when the field is null)
 *   - acceptEdits        → auto-approve Edit/Write/MultiEdit but still prompt
 *                          for Bash/etc.
 *   - plan               → planning mode, Claude writes a plan and asks before
 *                          executing
 *   - bypassPermissions  → skip canUseTool entirely, dangerous, kanban
 *                          auto-approve rules don't apply
 */
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions";

/** Model alias understood by the SDK. We keep `null` = "let the SDK pick" so
 *  the user doesn't have to know what their plan defaults to. The full model
 *  id form (`claude-sonnet-4-5-…`) is also accepted as a free-form string. */
export type ModelAlias = "sonnet" | "opus" | "haiku";

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
  /** Absolute path to a per-card git worktree, set if the user opted in
   *  at creation. Sessions run with this as cwd instead of `projectPath`,
   *  so parallel cards on the same repo don't trample each other. */
  worktreePath: string | null;
  // ---------------------------------------------------------------------
  // Per-card SDK options. All optional / null = "use SDK defaults" so old
  // cards keep their legacy behaviour after the schema migration.
  // ---------------------------------------------------------------------
  /** Model alias or full id forwarded to the SDK as `model`. */
  model: string | null;
  /** Permission mode forwarded as `permissionMode`. */
  permissionMode: PermissionMode | null;
  /** Free-form prose appended to Claude Code's preset system prompt. */
  systemPromptAppend: string | null;
  /** Hard cap on agent turns per session. */
  maxTurns: number | null;
  /** Newline-separated absolute paths handed to the SDK's
   *  `additionalDirectories` option. */
  additionalDirectories: string | null;
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
