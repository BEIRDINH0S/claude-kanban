import { CornerDownLeft, FileText, FolderOpen, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import type { PromptTemplate } from "../../../stores/templatesStore";
import type { UserCommand } from "../../../stores/userCommandsStore";
import type { SlashCommand } from "./slashCommands";

/**
 * Unified menu item — the cursor walks the same flat list, but rendering
 * splits commands above user commands above templates with section headers.
 * `kind` lets the parent dispatch correctly on pick:
 *   - "command":      built-in (runs a function)
 *   - "userCommand":  discovered from `~/.claude/commands` or
 *                     `<project>/.claude/commands` (markdown body sent
 *                     to Claude)
 *   - "template":     user-managed snippet (inserts text into the textarea)
 */
export type SlashItem =
  | { kind: "command"; command: SlashCommand }
  | { kind: "userCommand"; command: UserCommand }
  | { kind: "template"; template: PromptTemplate };

interface Props {
  templates: PromptTemplate[];
  commands: SlashCommand[];
  userCommands: UserCommand[];
  /** Substring to filter on (the bit after the leading `/`). */
  query: string;
  /** Currently-highlighted row in the combined commands+userCommands+templates list. */
  cursor: number;
  onCursorChange: (next: number) => void;
  onPick: (item: SlashItem) => void;
  /** Empty-state hint that links to Settings. Drives a subtle CTA when the
   *  user has no templates — first-run case is covered by the store seed,
   *  but they may have deleted everything. */
  onOpenSettings?: () => void;
}

/**
 * Menu that hovers above the textarea when the user types `/` at the
 * start of their message. Mouse + keyboard nav both supported; the
 * keyboard half lives in `MessageInput` since the textarea owns focus
 * (we never steal it — that would break the `/foo` substring filter).
 */
export function PromptTemplateMenu({
  templates,
  commands,
  userCommands,
  query,
  cursor,
  onCursorChange,
  onPick,
  onOpenSettings,
}: Props) {
  // Build the flat item list once: built-in commands first (most
  // discoverable / canonical), then user `.claude/commands/*.md` (the
  // extension point — picked up automatically), then user templates.
  // The cursor walks this concatenated list; rendering inserts section
  // headers between each kind transition.
  const items: SlashItem[] = useMemo(
    () => [
      ...commands.map((c) => ({ kind: "command" as const, command: c })),
      ...userCommands.map((c) => ({
        kind: "userCommand" as const,
        command: c,
      })),
      ...templates.map((t) => ({ kind: "template" as const, template: t })),
    ],
    [commands, userCommands, templates],
  );

  // Keep the highlighted row in view when the filter or cursor changes —
  // long lists scroll, and pressing ↓ off-screen otherwise looks broken.
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-slash-idx="${cursor}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [cursor, items]);

  const totalCount = items.length;
  const commandCount = commands.length;
  const userCommandCount = userCommands.length;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 px-6">
      <div className="glass-strong mx-auto max-w-[760px] overflow-hidden rounded-2xl shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--glass-stroke)] px-4 py-2 text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
          <FileText className="size-3" strokeWidth={1.75} />
          <span>Slash menu</span>
          <span className="font-mono normal-case tracking-normal text-[10.5px]">
            · /{query}
          </span>
        </div>
        {totalCount === 0 ? (
          <div className="px-4 py-3 text-[12px] text-[var(--text-muted)]">
            {templates.length === 0 && commandCount === 0 && userCommandCount === 0 ? (
              <>
                No commands or templates.{" "}
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
                  >
                    Create some in Settings
                  </button>
                )}
                .
              </>
            ) : (
              <>No results for "{query}".</>
            )}
          </div>
        ) : (
          <ul ref={listRef} className="max-h-[40vh] overflow-y-auto py-1">
            {commandCount > 0 && (
              <SectionHeader
                icon={<Terminal className="size-3" strokeWidth={1.75} />}
                label="Commands"
              />
            )}
            {commands.map((cmd, idx) => {
              const active = idx === cursor;
              return (
                <li key={`cmd-${cmd.name}`} data-slash-idx={idx}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPick({ kind: "command", command: cmd });
                    }}
                    onMouseEnter={() => onCursorChange(idx)}
                    className={[
                      "flex w-full items-start gap-2.5 px-4 py-2 text-left transition-colors",
                      active
                        ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)]",
                    ].join(" ")}
                  >
                    <Terminal
                      className="mt-0.5 size-3 shrink-0 text-[var(--text-muted)]"
                      strokeWidth={1.75}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[12px] font-medium">
                        {cmd.usage}
                      </p>
                      <p className="mt-0.5 truncate text-[10.5px] text-[var(--text-muted)]">
                        {cmd.summary}
                      </p>
                    </div>
                    {active && (
                      <CornerDownLeft
                        className="mt-1 size-3 shrink-0 text-[var(--text-muted)]"
                        strokeWidth={1.75}
                      />
                    )}
                  </button>
                </li>
              );
            })}
            {userCommandCount > 0 && (
              <SectionHeader
                icon={<FolderOpen className="size-3" strokeWidth={1.75} />}
                label="Claude Code · .claude/commands"
              />
            )}
            {userCommands.map((cmd, idx) => {
              const flatIdx = commandCount + idx;
              const active = flatIdx === cursor;
              return (
                <li key={`uc-${cmd.scope}-${cmd.name}`} data-slash-idx={flatIdx}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPick({ kind: "userCommand", command: cmd });
                    }}
                    onMouseEnter={() => onCursorChange(flatIdx)}
                    className={[
                      "flex w-full items-start gap-2.5 px-4 py-2 text-left transition-colors",
                      active
                        ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)]",
                    ].join(" ")}
                  >
                    <FolderOpen
                      className="mt-0.5 size-3 shrink-0 text-[var(--text-muted)]"
                      strokeWidth={1.75}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-mono text-[12px] font-medium">
                        /{cmd.name}
                        {cmd.takesArguments && (
                          <span className="text-[10.5px] font-normal text-[var(--text-muted)]">
                            &lt;args&gt;
                          </span>
                        )}
                        {/* Tiny scope badge so the user can tell the source
                            apart at a glance — global vs. project-level. */}
                        <span
                          className={[
                            "rounded-md px-1 py-px text-[9.5px] font-medium tracking-wide normal-case",
                            cmd.scope === "project"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300/85"
                              : "bg-black/5 text-[var(--text-muted)] dark:bg-white/8",
                          ].join(" ")}
                          title={
                            cmd.scope === "project"
                              ? "Defined in <project>/.claude/commands"
                              : "Defined in ~/.claude/commands"
                          }
                        >
                          {cmd.scope === "project" ? "project" : "global"}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-[10.5px] text-[var(--text-muted)]">
                        {cmd.description ?? "(no description)"}
                      </p>
                    </div>
                    {active && (
                      <CornerDownLeft
                        className="mt-1 size-3 shrink-0 text-[var(--text-muted)]"
                        strokeWidth={1.75}
                      />
                    )}
                  </button>
                </li>
              );
            })}
            {templates.length > 0 && (commandCount > 0 || userCommandCount > 0) && (
              <SectionHeader
                icon={<FileText className="size-3" strokeWidth={1.75} />}
                label="Templates"
              />
            )}
            {templates.map((tpl, idx) => {
              const flatIdx = commandCount + userCommandCount + idx;
              const active = flatIdx === cursor;
              const preview = tpl.body.replace(/\s+/g, " ").trim();
              return (
                <li key={tpl.id} data-slash-idx={flatIdx}>
                  <button
                    type="button"
                    // `onMouseDown` (not click) so the textarea doesn't lose
                    // focus before we reinject the body. Click would fire a
                    // blur on the textarea first.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPick({ kind: "template", template: tpl });
                    }}
                    onMouseEnter={() => onCursorChange(flatIdx)}
                    className={[
                      "flex w-full items-start gap-2.5 px-4 py-2 text-left transition-colors",
                      active
                        ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)]",
                    ].join(" ")}
                  >
                    <FileText
                      className="mt-0.5 size-3 shrink-0 text-[var(--text-muted)]"
                      strokeWidth={1.75}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">
                        {tpl.name}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                        {preview || "(vide)"}
                      </p>
                    </div>
                    {active && (
                      <CornerDownLeft
                        className="mt-1 size-3 shrink-0 text-[var(--text-muted)]"
                        strokeWidth={1.75}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <li
      aria-hidden
      className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[9.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase"
    >
      {icon}
      <span>{label}</span>
    </li>
  );
}

/**
 * Filter templates against the query string typed after `/`. Matches on
 * `name` (case-insensitive substring) — body content is intentionally not
 * searched: it would surface a template for any keyword inside multi-line
 * prose, which gets noisy fast.
 */
export function filterTemplates(
  templates: PromptTemplate[],
  query: string,
): PromptTemplate[] {
  const q = query.trim().toLowerCase();
  if (!q) return templates;
  return templates.filter((t) => t.name.toLowerCase().includes(q));
}

/**
 * Predicate: should the slash menu be open right now? True iff the
 * textarea content is exactly `/...` with no whitespace and no newline.
 * Exposed so `MessageInput` can mirror the same rule for keyboard nav
 * and the visual mount.
 */
export function shouldShowSlashMenu(text: string): boolean {
  if (!text.startsWith("/")) return false;
  // First character is `/`. Reject as soon as we hit whitespace/newline —
  // means the user moved past the trigger into a real message.
  for (let i = 1; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // space, tab, LF, CR
    if (c === 32 || c === 9 || c === 10 || c === 13) return false;
  }
  return true;
}
