import { stopSession as ipcStopSession } from "../../../ipc/sessions";
import { useCardsStore } from "../../../stores/cardsStore";
import { useMessagesStore } from "../../../stores/messagesStore";
import { useToastsStore } from "../../../stores/toastsStore";
import { useUiStore } from "../../../stores/uiStore";
import type { Card, PermissionMode } from "../../../types/card";
import type { SdkEvent } from "../../../types/chat";

/**
 * Built-in slash commands surfaced in the message input. Mirrors a subset
 * of Claude Code's CLI slash commands (`/clear`, `/cost`, `/help`, …) but
 * adapted to the kanban context — most commands persist on the card and
 * apply on the next session start, since we can't mutate a live SDK
 * `query()` mid-stream.
 *
 * Each command exposes:
 *   - `name` / `aliases`   — what the user types after `/`
 *   - `summary` / `usage`  — what shows in the slash menu
 *   - `run`                — the handler. Receives the parsed arg (text
 *                            after the command name) and the owning card.
 *                            Returns `void` synchronously or a Promise.
 *
 * Commands DO NOT echo themselves into the chat as user-input — that would
 * leak control sequences into the SDK's transcript. They append a synthetic
 * "system" SDK event instead, so the user sees what happened without
 * cluttering Claude's context.
 */
export interface SlashCommand {
  name: string;
  /** Alternate spellings the parser also accepts. */
  aliases?: string[];
  summary: string;
  /** "/clear" or "/model sonnet" — shown in the menu. */
  usage: string;
  /**
   * @returns a short message we surface as a toast, or `void` if the
   *          command already pushed its own UI feedback.
   */
  run: (args: string, card: Card) => void | string | Promise<void | string>;
}

/**
 * Append a synthetic system row to the transcript so commands have visible
 * feedback in the chat. We piggyback on the existing SdkEvent shape with a
 * custom `type: "system_command"` — the MessageList will render it like
 * any other system event (currently dropped, but keeping it future-proof).
 * In parallel we push a toast so the user gets immediate feedback in the
 * common case where the chat is the focused area.
 */
function pushFeedback(cardId: string, message: string): void {
  const evt: SdkEvent = {
    type: "system_command",
    subtype: "info",
    text: message,
  } as SdkEvent;
  useMessagesStore.getState().appendSdkEvent(cardId, evt);
  useToastsStore.getState().push({ message, ttlMs: 4000 });
}

/**
 * Set a per-card session config field while preserving the rest. We always
 * round-trip through the store's `setSessionConfig` (which overwrites all
 * fields) so the saved blob stays consistent.
 */
async function patchConfig(
  card: Card,
  patch: {
    model?: string | null;
    permissionMode?: PermissionMode | null;
    systemPromptAppend?: string | null;
    maxTurns?: number | null;
    additionalDirectories?: string | null;
  },
): Promise<void> {
  await useCardsStore.getState().setSessionConfig(card.id, {
    model: patch.model !== undefined ? patch.model : card.model,
    permissionMode:
      patch.permissionMode !== undefined ? patch.permissionMode : card.permissionMode,
    systemPromptAppend:
      patch.systemPromptAppend !== undefined
        ? patch.systemPromptAppend
        : card.systemPromptAppend,
    maxTurns: patch.maxTurns !== undefined ? patch.maxTurns : card.maxTurns,
    additionalDirectories:
      patch.additionalDirectories !== undefined
        ? patch.additionalDirectories
        : card.additionalDirectories,
  });
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "help",
    aliases: ["?"],
    summary: "List the available commands",
    usage: "/help",
    run: (_args, card) => {
      const lines = SLASH_COMMANDS.map(
        (c) => `${c.usage} — ${c.summary}`,
      ).join("\n");
      pushFeedback(card.id, `Available commands:\n${lines}`);
    },
  },
  {
    name: "clear",
    summary: "Clear the local transcript (the SDK session is not affected)",
    usage: "/clear",
    run: (_args, card) => {
      // Clear the in-memory chat. The on-disk JSONL stays intact — the SDK
      // still has its own context. Re-zooming the card will rehydrate from
      // disk, so this is a "give me a clean visual workspace" gesture, not
      // a true conversation reset.
      useMessagesStore.getState().clear(card.id);
      useToastsStore.getState().push({
        message:
          "Local transcript cleared. The SDK session keeps its context; close and reopen the card to rehydrate from disk.",
        ttlMs: 5000,
      });
    },
  },
  {
    name: "plan",
    summary: "Enable Plan mode for the next session",
    usage: "/plan",
    run: async (_args, card) => {
      await patchConfig(card, { permissionMode: "plan" });
      pushFeedback(
        card.id,
        "Plan mode enabled. On the next session start, Claude will draft a plan before running anything.",
      );
    },
  },
  {
    name: "accept-edits",
    aliases: ["acceptEdits"],
    summary: "acceptEdits mode (auto-approve Edit/Write/MultiEdit)",
    usage: "/accept-edits",
    run: async (_args, card) => {
      await patchConfig(card, { permissionMode: "acceptEdits" });
      pushFeedback(
        card.id,
        "acceptEdits mode enabled for the next session. Bash & co still ask.",
      );
    },
  },
  {
    name: "default-mode",
    aliases: ["default"],
    summary: "Switch back to default (asks for every tool)",
    usage: "/default-mode",
    run: async (_args, card) => {
      await patchConfig(card, { permissionMode: null });
      pushFeedback(
        card.id,
        "Permission mode reset to default. Every tool will ask again.",
      );
    },
  },
  {
    name: "bypass",
    aliases: ["bypassPermissions"],
    summary: "⚠️ bypassPermissions — Claude runs everything without asking",
    usage: "/bypass",
    run: async (_args, card) => {
      await patchConfig(card, { permissionMode: "bypassPermissions" });
      pushFeedback(
        card.id,
        "⚠️ bypassPermissions enabled. No permission prompt on the next session start.",
      );
    },
  },
  {
    name: "model",
    summary: "Change the model (sonnet/opus/haiku or claude-…). Empty = default.",
    usage: "/model <sonnet|opus|haiku|claude-…>",
    run: async (args, card) => {
      const next = args.trim();
      // Validate before persisting so the toast carries the failure rather
      // than the IPC error stack. Same predicates as the Rust side.
      if (next) {
        const isAlias = next === "sonnet" || next === "opus" || next === "haiku";
        const isFull = next.startsWith("claude-");
        if (!isAlias && !isFull) {
          throw new Error(
            `Invalid model "${next}" — expected sonnet/opus/haiku or claude-…`,
          );
        }
      }
      await patchConfig(card, { model: next || null });
      pushFeedback(
        card.id,
        next
          ? `Model set to "${next}" for the next session.`
          : "Model reset to the SDK default.",
      );
    },
  },
  {
    name: "max-turns",
    aliases: ["maxTurns"],
    summary: "Cap the number of turns (empty or 0 = no limit)",
    usage: "/max-turns <n>",
    run: async (args, card) => {
      const trimmed = args.trim();
      if (!trimmed) {
        await patchConfig(card, { maxTurns: null });
        pushFeedback(card.id, "max-turns: limit removed.");
        return;
      }
      const n = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid max-turns "${trimmed}" — expected an integer > 0`);
      }
      await patchConfig(card, { maxTurns: n });
      pushFeedback(card.id, `max-turns: ${n} for the next session.`);
    },
  },
  {
    name: "stop",
    summary: "Stop the live session (same as the Stop button)",
    usage: "/stop",
    run: async (_args, card) => {
      const liveSessionIds = useUiStore.getState().liveSessionIds;
      if (!card.sessionId || !liveSessionIds.has(card.sessionId)) {
        throw new Error("No live session to stop.");
      }
      await ipcStopSession(card.id);
      pushFeedback(card.id, "Session stopped.");
    },
  },
  {
    name: "config",
    summary: "Show the current card configuration",
    usage: "/config",
    run: (_args, card) => {
      const lines: string[] = [];
      lines.push(`model               = ${card.model ?? "(SDK default)"}`);
      lines.push(`permissionMode      = ${card.permissionMode ?? "(default)"}`);
      lines.push(
        `maxTurns            = ${card.maxTurns != null ? card.maxTurns : "(unlimited)"}`,
      );
      const dirs = card.additionalDirectories
        ? card.additionalDirectories.split("\n").filter(Boolean)
        : [];
      lines.push(
        `additionalDirs      = ${dirs.length === 0 ? "(none)" : dirs.join(", ")}`,
      );
      lines.push(
        `systemPromptAppend  = ${
          card.systemPromptAppend
            ? card.systemPromptAppend.length > 80
              ? `${card.systemPromptAppend.slice(0, 80)}…`
              : card.systemPromptAppend
            : "(empty)"
        }`,
      );
      pushFeedback(card.id, `Card config:\n${lines.join("\n")}`);
    },
  },
];

/**
 * Index by name + aliases so lookups are constant time. Built once on
 * module load — the registry is static.
 */
const COMMAND_INDEX: Map<string, SlashCommand> = (() => {
  const m = new Map<string, SlashCommand>();
  for (const cmd of SLASH_COMMANDS) {
    m.set(cmd.name, cmd);
    for (const a of cmd.aliases ?? []) m.set(a, cmd);
  }
  return m;
})();

/**
 * Parse a textarea content as a slash command. Returns the matched command
 * + the trailing argument (everything after the first whitespace), or null
 * if the text isn't a known command.
 */
export function parseSlashCommand(
  text: string,
): { command: SlashCommand; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const rest = trimmed.slice(1);
  // Split on the first run of whitespace — keeps multi-word args intact.
  const wsIdx = rest.search(/\s/);
  const head = wsIdx === -1 ? rest : rest.slice(0, wsIdx);
  const args = wsIdx === -1 ? "" : rest.slice(wsIdx + 1);
  const cmd = COMMAND_INDEX.get(head);
  return cmd ? { command: cmd, args } : null;
}

/**
 * Filter the command list against the slash query (substring on name).
 * Mirrors the convention of `filterTemplates`.
 */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => {
    if (c.name.toLowerCase().includes(q)) return true;
    return (c.aliases ?? []).some((a) => a.toLowerCase().includes(q));
  });
}
