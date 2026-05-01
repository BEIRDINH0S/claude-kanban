import { ArrowUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCardsStore } from "../../../stores/cardsStore";
import { useMessagesStore } from "../../../stores/messagesStore";
import { useTemplatesStore } from "../../../stores/templatesStore";
import { useToastsStore } from "../../../stores/toastsStore";
import { useUiStore } from "../../../stores/uiStore";
import {
  filterUserCommands,
  substituteArguments,
  useUserCommandsStore,
  type UserCommand,
} from "../../../stores/userCommandsStore";
import {
  filterTemplates,
  PromptTemplateMenu,
  shouldShowSlashMenu,
} from "./PromptTemplateMenu";
import {
  filterSlashCommands,
  parseSlashCommand,
  SLASH_COMMANDS,
  type SlashCommand,
} from "./slashCommands";

/**
 * Once the user has typed `/foo ` (note the trailing space), the strict
 * `shouldShowSlashMenu` predicate closes the menu — but we want it to
 * stay open if `foo` resolves to a known command, so the user sees they
 * are filling its argument rather than writing free-form prose. This
 * helper returns true exactly in that case.
 */
function isCommandPrefixWithArg(
  text: string,
  userCommandNames: ReadonlySet<string>,
): boolean {
  if (!text.startsWith("/")) return false;
  const m = text.slice(1).match(/^([A-Za-z][\w-]*)\s/);
  if (!m) return false;
  const head = m[1];
  if (
    SLASH_COMMANDS.some(
      (c) => c.name === head || (c.aliases ?? []).includes(head),
    )
  ) {
    return true;
  }
  // Also keep the menu open while the user is filling args for a
  // discovered `.claude/commands/*.md` entry — same UX as the built-ins.
  return userCommandNames.has(head);
}

// Stable empty array reference — passing `[]` inline would create a new
// reference each render and force Zustand selectors to rerender.
const EMPTY_USER_COMMANDS: UserCommand[] = [];

/**
 * Try to match the typed text against a discovered user command. Same
 * shape as `parseSlashCommand` (built-ins): `/name [args]`. Returns the
 * matched command + args, or null when nothing fits.
 */
function parseUserCommand(
  text: string,
  commands: readonly UserCommand[],
): { command: UserCommand; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const rest = trimmed.slice(1);
  const wsIdx = rest.search(/\s/);
  const head = wsIdx === -1 ? rest : rest.slice(0, wsIdx);
  const args = wsIdx === -1 ? "" : rest.slice(wsIdx + 1);
  const cmd = commands.find((c) => c.name === head);
  return cmd ? { command: cmd, args } : null;
}

interface Props {
  onSend: (text: string) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Owning card. Optional for backwards-compat with any future caller, but
   * required in practice to enable the prompt-history shortcut (Alt+↑/↓
   * cycles through past user messages on this card).
   */
  cardId?: string;
}

export function MessageInput({ onSend, disabled, placeholder, cardId }: Props) {
  const [text, setText] = useState("");
  const [menuCursor, setMenuCursor] = useState(0);
  // Lets Esc temporarily hide the menu without erasing the user's `/foo`
  // text; reset as soon as they edit again so re-typing reopens it.
  const [menuDismissed, setMenuDismissed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Templates: lazy-load on first mount of any input. The store guards
  // against double-loads internally (see `loading` flag).
  const templates = useTemplatesStore((s) => s.templates);
  const templatesLoaded = useTemplatesStore((s) => s.loaded);
  const loadTemplates = useTemplatesStore((s) => s.load);
  useEffect(() => {
    if (!templatesLoaded) void loadTemplates();
  }, [templatesLoaded, loadTemplates]);

  // User commands discovered from `~/.claude/commands` and
  // `<project>/.claude/commands`. Cached per card on the store side; we
  // call `load()` once per mount and the store dedupes if it already has
  // the data. No card_id = no project-scoped commands; we still get the
  // globals back so the menu isn't empty.
  const userCommands = useUserCommandsStore(
    (s) => (cardId ? s.byCard[cardId] : undefined) ?? EMPTY_USER_COMMANDS,
  );
  const loadUserCommands = useUserCommandsStore((s) => s.load);
  useEffect(() => {
    if (!cardId) return;
    void loadUserCommands(cardId);
  }, [cardId, loadUserCommands]);

  // Slash-menu open state derives purely from the textarea content so we
  // never end up with a stale "open" flag — the menu closes itself the
  // instant the user types a space/newline (via `shouldShowSlashMenu`).
  // We accept whitespace inside the trigger only when the typed prefix
  // already matches a built-in command (e.g. `/model sonnet` keeps the
  // menu open so the user sees they're driving a real command rather
  // than a free-form prose). Templates use the strict no-whitespace rule.
  // Pre-compute the set of user-command names so the menu-open predicate
  // can recognise them as "real commands" (and keep the menu visible past
  // the trailing space). Memoised so the Set isn't rebuilt every keystroke.
  const userCommandNames = useMemo(
    () => new Set(userCommands.map((c) => c.name)),
    [userCommands],
  );
  const slashTrigger =
    !disabled &&
    text.startsWith("/") &&
    (shouldShowSlashMenu(text) || isCommandPrefixWithArg(text, userCommandNames));
  const slashOpen = slashTrigger && !menuDismissed;
  // The query for filtering: substring AFTER `/`, up to the first space.
  const slashQuery = slashOpen
    ? text.slice(1).split(/\s/, 1)[0] ?? ""
    : "";
  const filteredTemplates = useMemo(
    () => (slashOpen ? filterTemplates(templates, slashQuery) : []),
    [slashOpen, templates, slashQuery],
  );
  const filteredCommands = useMemo(
    () => (slashOpen ? filterSlashCommands(slashQuery) : []),
    [slashOpen, slashQuery],
  );
  const filteredUserCommands = useMemo(
    () => (slashOpen ? filterUserCommands(userCommands, slashQuery) : []),
    [slashOpen, userCommands, slashQuery],
  );

  // Reset cursor whenever the visible list changes — landing on a stale
  // index after filtering would highlight the wrong row (or nothing).
  useEffect(() => {
    setMenuCursor(0);
  }, [
    slashOpen,
    slashQuery,
    filteredCommands.length,
    filteredUserCommands.length,
    filteredTemplates.length,
  ]);

  // Prompt history (Alt+↑/↓): reuse the user's previous prompts on this
  // card, shell-style. We resolve the history lazily on each keypress so
  // we don't subscribe the input to every transcript update — Zustand
  // would re-render us on every Claude event otherwise.
  //
  // `historyIndex` is `-1` when "off" (textarea owns its content) and 0+
  // when navigating (0 = most recent prompt). `historyDraft` snapshots
  // whatever the user had typed before they started navigating, so
  // pressing ↓ past index 0 restores it instead of leaving an empty box.
  const historyIndex = useRef<number>(-1);
  const historyDraft = useRef<string>("");

  const setView = useUiStore((s) => s.setView);
  const closeZoom = useUiStore((s) => s.closeZoom);

  // Autofocus on mount and after each successful send. We defer with rAF so
  // the focus call lands AFTER the parent's `animate-zoom-in` first paint —
  // some browsers drop focus calls that hit a node mid-animation when it
  // sits inside a `backdrop-filter` ancestor (the glass modal here).
  useEffect(() => {
    if (disabled) return;
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [disabled]);

  // Auto-grow textarea up to a sensible cap.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const pushToast = useToastsStore((s) => s.push);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    // Slash command intercept order:
    //   1. Built-in commands (parseSlashCommand). Run a function, don't
    //      ship anything to Claude.
    //   2. User commands discovered from `.claude/commands/*.md`. Body
    //      becomes the prompt sent to Claude after `$ARGUMENTS` substitution.
    //   3. Anything else starting with `/` falls through to Claude as a
    //      regular prompt — same permissive behaviour as the CLI, so
    //      future built-in slash commands Anthropic ships still get
    //      forwarded even if we don't recognise them yet.
    const parsed = parseSlashCommand(trimmed);
    if (parsed) {
      const card = cardId
        ? useCardsStore.getState().cards.find((c) => c.id === cardId)
        : undefined;
      if (!card) {
        pushToast({
          message: "Can't run the command — card not found.",
        });
        return;
      }
      // Clear the textarea + history state immediately so the user sees
      // their command "submitted" even before async handlers settle.
      setText("");
      historyIndex.current = -1;
      historyDraft.current = "";
      try {
        const out = await Promise.resolve(parsed.command.run(parsed.args, card));
        if (typeof out === "string" && out) {
          pushToast({ message: out, ttlMs: 4000 });
        }
      } catch (e) {
        pushToast({
          message: `Command failed — ${String(e).slice(0, 200)}`,
          ttlMs: 6000,
        });
      }
      return;
    }

    // Try a discovered user command. Same parse shape: `/name args…`.
    const userCmd = parseUserCommand(trimmed, userCommands);
    if (userCmd) {
      const body = substituteArguments(userCmd.command.body, userCmd.args);
      setText("");
      historyIndex.current = -1;
      historyDraft.current = "";
      // The substituted body IS the prompt sent to Claude — same UX as the
      // CLI, where typing `/review main` dispatches the markdown body of
      // `~/.claude/commands/review.md` (with $ARGUMENTS = "main") as the
      // user message. Tools / model / permission mode are unchanged: the
      // SDK options for this card still apply.
      await onSend(body);
      return;
    }

    setText("");
    historyIndex.current = -1;
    historyDraft.current = "";
    await onSend(trimmed);
  };

  /** Drop the picked template into the textarea, replacing the `/foo` trigger. */
  const applyTemplate = (body: string) => {
    setText(body);
    setMenuDismissed(false);
    // Place the caret at the end after React flushes — handy when the
    // template is a fill-in-the-blanks prose the user wants to extend.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const pos = body.length;
      el.setSelectionRange(pos, pos);
    });
  };

  /**
   * Picking a built-in command from the menu: if it takes args (usage
   * string contains `<…>`), pre-fill the textarea with `/<name> ` so the
   * user can type the value. Otherwise execute it immediately.
   */
  const applyCommand = (cmd: SlashCommand) => {
    const takesArg = /<.*?>/.test(cmd.usage);
    if (takesArg) {
      const next = `/${cmd.name} `;
      setText(next);
      setMenuDismissed(false);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        const pos = next.length;
        el.setSelectionRange(pos, pos);
      });
      return;
    }
    // No-arg commands run on pick — feels more like Claude Code's CLI
    // where `/clear` fires the moment you press Enter.
    setText("");
    setMenuDismissed(true);
    historyIndex.current = -1;
    historyDraft.current = "";
    const card = cardId
      ? useCardsStore.getState().cards.find((c) => c.id === cardId)
      : undefined;
    if (!card) return;
    void Promise.resolve(cmd.run("", card)).catch((e) => {
      pushToast({
        message: `Command failed — ${String(e).slice(0, 200)}`,
        ttlMs: 6000,
      });
    });
  };

  /**
   * Picking a user command (from `.claude/commands/*.md`) from the menu.
   * Same arg-or-fire heuristic as built-ins:
   *   - Body references `$ARGUMENTS` → pre-fill `/<name> ` and let the
   *     user type the arg before pressing Enter.
   *   - No `$ARGUMENTS` → dispatch the body to Claude immediately.
   */
  const applyUserCommand = (cmd: UserCommand) => {
    if (cmd.takesArguments) {
      const next = `/${cmd.name} `;
      setText(next);
      setMenuDismissed(false);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        const pos = next.length;
        el.setSelectionRange(pos, pos);
      });
      return;
    }
    setText("");
    setMenuDismissed(true);
    historyIndex.current = -1;
    historyDraft.current = "";
    void Promise.resolve(onSend(cmd.body)).catch((e) => {
      pushToast({
        message: `Claude Code command failed — ${String(e).slice(0, 200)}`,
        ttlMs: 6000,
      });
    });
  };

  /** Pull the user-input transcript for this card, newest-first. */
  const readUserHistory = (): string[] => {
    if (!cardId) return [];
    const items = useMessagesStore.getState().byCard[cardId] ?? [];
    const out: string[] = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "user-input" && it.text) out.push(it.text);
    }
    return out;
  };

  const goHistoryOlder = () => {
    const history = readUserHistory();
    if (history.length === 0) return;
    if (historyIndex.current === -1) {
      historyDraft.current = text; // remember the in-flight draft
    }
    const next = Math.min(historyIndex.current + 1, history.length - 1);
    historyIndex.current = next;
    setText(history[next]);
  };

  const goHistoryNewer = () => {
    if (historyIndex.current === -1) return;
    const next = historyIndex.current - 1;
    historyIndex.current = next;
    if (next === -1) {
      setText(historyDraft.current);
    } else {
      const history = readUserHistory();
      setText(history[next] ?? "");
    }
  };

  const handleOpenSettings = () => {
    closeZoom();
    setView("settings");
  };

  // Total flat count for cursor bounds and "is anything visible?" checks.
  // Order: built-in commands → user commands → templates (matches menu).
  const menuItemCount =
    filteredCommands.length +
    filteredUserCommands.length +
    filteredTemplates.length;

  /** Resolve the cursor index back to a command / userCommand / template. */
  const itemAtCursor = (idx: number):
    | { kind: "command"; command: SlashCommand }
    | { kind: "userCommand"; command: UserCommand }
    | { kind: "template"; template: typeof filteredTemplates[number] }
    | null => {
    if (idx < filteredCommands.length) {
      return { kind: "command", command: filteredCommands[idx] };
    }
    const ucIdx = idx - filteredCommands.length;
    if (ucIdx < filteredUserCommands.length) {
      return { kind: "userCommand", command: filteredUserCommands[ucIdx] };
    }
    const tIdx = ucIdx - filteredUserCommands.length;
    const t = filteredTemplates[tIdx];
    return t ? { kind: "template", template: t } : null;
  };

  return (
    <div className="relative px-6 pb-5">
      {slashOpen && (
        <PromptTemplateMenu
          templates={filteredTemplates}
          commands={filteredCommands}
          userCommands={filteredUserCommands}
          query={slashQuery}
          cursor={menuCursor}
          onCursorChange={setMenuCursor}
          onPick={(item) => {
            if (item.kind === "command") applyCommand(item.command);
            else if (item.kind === "userCommand") applyUserCommand(item.command);
            else applyTemplate(item.template.body);
          }}
          onOpenSettings={handleOpenSettings}
        />
      )}
      <div className="mx-auto flex max-w-[760px] items-end gap-2">
        <div className="glass flex-1 rounded-2xl px-4 py-2.5">
          <textarea
            ref={ref}
            // Belt-and-suspenders with the rAF effect above — covers the
            // initial mount before React effects run.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={!disabled}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMenuDismissed(false);
              // User edited manually → drop out of history-cycling mode.
              historyIndex.current = -1;
            }}
            onKeyDown={(e) => {
              // 1) Slash menu has priority: when it's visible, ↑/↓/Enter/Tab
              //    drive the menu, not the textarea. Esc closes the menu
              //    (without erasing `/foo` so the user can keep typing).
              //    The cursor walks both commands and templates as a flat list.
              if (slashOpen && menuItemCount > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMenuCursor((c) => Math.min(c + 1, menuItemCount - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMenuCursor((c) => Math.max(c - 1, 0));
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const it = itemAtCursor(menuCursor);
                  if (it?.kind === "command") {
                    applyCommand(it.command);
                  } else if (it?.kind === "userCommand") {
                    applyUserCommand(it.command);
                  } else if (it?.kind === "template") {
                    applyTemplate(it.template.body);
                  }
                  return;
                }
                if (e.key === "Tab") {
                  e.preventDefault();
                  const it = itemAtCursor(menuCursor);
                  if (it?.kind === "command") {
                    applyCommand(it.command);
                  } else if (it?.kind === "userCommand") {
                    applyUserCommand(it.command);
                  } else if (it?.kind === "template") {
                    applyTemplate(it.template.body);
                  }
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMenuDismissed(true);
                  return;
                }
              } else if (slashOpen && e.key === "Escape") {
                // Empty results: still let Esc dismiss so the input box
                // doesn't feel hijacked.
                e.preventDefault();
                setMenuDismissed(true);
                return;
              }

              // 2) Prompt history: Alt+↑/↓ cycles through prior user
              //    prompts on this card. Alt-modifier picked because it
              //    avoids macOS' Ctrl+↑ (Mission Control) and the native
              //    Cmd+↑ "go to start of textarea" binding.
              if (e.altKey && e.key === "ArrowUp") {
                e.preventDefault();
                goHistoryOlder();
                return;
              }
              if (e.altKey && e.key === "ArrowDown") {
                e.preventDefault();
                goHistoryNewer();
                return;
              }

              // 3) Default: Enter sends; Shift+Enter for newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={placeholder ?? "Reply to Claude…"}
            disabled={disabled}
            rows={1}
            className="block w-full resize-none bg-transparent font-mono text-[13px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !text.trim()}
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[var(--color-accent)] text-white shadow-[0_0_24px_var(--color-accent-ring)] transition-opacity disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
          aria-label="Envoyer"
        >
          <ArrowUp className="size-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
