import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/**
 * A slash command discovered by Rust on disk — see
 * `commands::user_commands::UserCommand` for the source-of-truth shape.
 *
 * The discovery dirs are the same as the Claude Code CLI's: globals at
 * `~/.claude/commands/` and project-scoped at
 * `<projectPath>/.claude/commands/`. Project entries override globals on
 * name conflict (Rust handles the dedup).
 */
export interface UserCommand {
  name: string;
  scope: "global" | "project";
  description: string | null;
  body: string;
  source: string;
  takesArguments: boolean;
}

/**
 * Per-card cache. We need per-card scoping because project-scoped
 * commands depend on the card's `projectPath`. Keying by card_id keeps
 * things simple even though two cards in the same project will fetch
 * identical results — the I/O is cheap (a few file reads) and correctness
 * beats clever dedup here.
 */
interface State {
  /** card_id → discovered commands (most recent fetch). */
  byCard: Record<string, UserCommand[]>;
  /** card_id → "in flight" guard, to dedupe concurrent fetches. */
  loading: Record<string, boolean>;
  /** card_id → last error string, cleared on next successful refresh. */
  error: Record<string, string | null>;

  load: (cardId: string) => Promise<void>;
  /** Force a refetch. Used after a manual edit / when the user knows they
   *  just dropped a new `.md` and wants the menu to pick it up immediately. */
  refresh: (cardId: string) => Promise<void>;
}

async function fetchCommands(cardId: string): Promise<UserCommand[]> {
  return invoke<UserCommand[]>("list_user_commands", { cardId });
}

export const useUserCommandsStore = create<State>((set, get) => ({
  byCard: {},
  loading: {},
  error: {},

  load: async (cardId) => {
    // Already cached AND not currently fetching → no work to do. The
    // caller can `refresh()` to bypass.
    if (get().byCard[cardId] !== undefined) return;
    if (get().loading[cardId]) return;
    set((s) => ({ loading: { ...s.loading, [cardId]: true } }));
    try {
      const commands = await fetchCommands(cardId);
      set((s) => ({
        byCard: { ...s.byCard, [cardId]: commands },
        error: { ...s.error, [cardId]: null },
        loading: { ...s.loading, [cardId]: false },
      }));
    } catch (e) {
      set((s) => ({
        error: { ...s.error, [cardId]: String(e) },
        loading: { ...s.loading, [cardId]: false },
      }));
    }
  },

  refresh: async (cardId) => {
    set((s) => ({ loading: { ...s.loading, [cardId]: true } }));
    try {
      const commands = await fetchCommands(cardId);
      set((s) => ({
        byCard: { ...s.byCard, [cardId]: commands },
        error: { ...s.error, [cardId]: null },
        loading: { ...s.loading, [cardId]: false },
      }));
    } catch (e) {
      set((s) => ({
        error: { ...s.error, [cardId]: String(e) },
        loading: { ...s.loading, [cardId]: false },
      }));
    }
  },
}));

/**
 * Filter discovered commands against the slash query (substring on name
 * AND description). Mirrors the convention of `filterTemplates` and
 * `filterSlashCommands`.
 */
export function filterUserCommands(
  commands: UserCommand[],
  query: string,
): UserCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => {
    if (c.name.toLowerCase().includes(q)) return true;
    if (c.description?.toLowerCase().includes(q)) return true;
    return false;
  });
}

/**
 * Substitute `$ARGUMENTS` with the runtime arg the user typed after the
 * command name. Same convention as Claude Code — the placeholder replaces
 * verbatim, no quoting / escaping. Empty args leaves an empty string.
 */
export function substituteArguments(body: string, args: string): string {
  if (!body.includes("$ARGUMENTS")) return body;
  return body.split("$ARGUMENTS").join(args);
}
