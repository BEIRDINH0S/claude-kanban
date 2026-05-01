/**
 * Central registry of customizable keyboard shortcuts.
 *
 * Two scopes:
 *  - "global": fire from anywhere (palette, search, …). They typically use
 *    a modifier (⌘/Ctrl) so they don't collide with text input.
 *  - "board": only fire on the kanban board view, and only when the user
 *    isn't typing in an input (unless the binding uses a modifier — then
 *    we assume they meant the shortcut).
 *
 * Each shortcut is a list of bindings: any one matching triggers the
 * action. Defaults ship with two bindings for movement (vim + arrows).
 *
 * Persistence and active state live in `stores/shortcutsStore.ts`. This
 * file is intentionally pure (no React, no zustand) so handlers can call
 * `match()` straight from `useEffect` listeners without re-renders.
 */

export type ShortcutScope = "global" | "board";

export interface Binding {
  /**
   * KeyboardEvent.key value, normalized to lowercase for single
   * characters. Examples: "k", "/", "Enter", "ArrowDown", "Backspace".
   */
  key: string;
  /** Cmd on macOS, Ctrl elsewhere — collapsed to a single flag. */
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDefinition {
  id: ShortcutId;
  label: string;
  description?: string;
  scope: ShortcutScope;
  defaults: Binding[];
}

// Keep this list in sync with usages in App.tsx and Board.tsx.
export const SHORTCUT_IDS = [
  "global.palette",
  "global.search",
  "board.moveDown",
  "board.moveUp",
  "board.moveLeft",
  "board.moveRight",
  "board.openCard",
  "board.newTask",
  "board.openSearch",
  "board.archive",
  "board.duplicate",
  "board.delete",
] as const;

export type ShortcutId = (typeof SHORTCUT_IDS)[number];

export const SHORTCUTS: ShortcutDefinition[] = [
  {
    id: "global.palette",
    label: "Open the command palette",
    description: "Search projects, cards, actions.",
    scope: "global",
    defaults: [{ key: "k", meta: true }],
  },
  {
    id: "global.search",
    label: "Search the board",
    description: "Filter cards by title, repo or tag.",
    scope: "global",
    defaults: [{ key: "f", meta: true }],
  },
  {
    id: "board.moveDown",
    label: "Next card (down)",
    scope: "board",
    defaults: [{ key: "j" }, { key: "ArrowDown" }],
  },
  {
    id: "board.moveUp",
    label: "Previous card (up)",
    scope: "board",
    defaults: [{ key: "k" }, { key: "ArrowUp" }],
  },
  {
    id: "board.moveLeft",
    label: "Column to the left",
    scope: "board",
    defaults: [{ key: "h" }, { key: "ArrowLeft" }],
  },
  {
    id: "board.moveRight",
    label: "Column to the right",
    scope: "board",
    defaults: [{ key: "l" }, { key: "ArrowRight" }],
  },
  {
    id: "board.openCard",
    label: "Open the selected card",
    scope: "board",
    defaults: [{ key: "Enter" }, { key: "o" }],
  },
  {
    id: "board.newTask",
    label: "New task",
    scope: "board",
    defaults: [{ key: "n" }],
  },
  {
    id: "board.openSearch",
    label: "Board search",
    scope: "board",
    defaults: [{ key: "/" }],
  },
  {
    id: "board.archive",
    label: "Archive (move to Done)",
    scope: "board",
    defaults: [{ key: "a" }],
  },
  {
    id: "board.duplicate",
    label: "Duplicate",
    scope: "board",
    defaults: [{ key: "y" }],
  },
  {
    id: "board.delete",
    label: "Delete",
    scope: "board",
    defaults: [{ key: "d" }, { key: "Backspace" }, { key: "Delete" }],
  },
];

export const SHORTCUT_BY_ID: Record<ShortcutId, ShortcutDefinition> =
  Object.fromEntries(SHORTCUTS.map((s) => [s.id, s])) as Record<
    ShortcutId,
    ShortcutDefinition
  >;

// -----------------------------------------------------------------------------
// Matching
// -----------------------------------------------------------------------------

const SINGLE_CHAR = (s: string) => s.length === 1;

function normKey(k: string): string {
  return SINGLE_CHAR(k) ? k.toLowerCase() : k;
}

/**
 * True if the keyboard event matches the binding. Modifiers must match
 * exactly: a binding without `meta` will NOT fire when ⌘/Ctrl is held.
 * meta and ctrl are collapsed (either counts), to keep cross-platform
 * bindings clean.
 */
export function matchBinding(b: Binding, e: KeyboardEvent): boolean {
  if (normKey(e.key) !== normKey(b.key)) return false;
  const wantMeta = !!b.meta;
  const hasMeta = e.metaKey || e.ctrlKey;
  if (wantMeta !== hasMeta) return false;
  if (!!b.shift !== e.shiftKey) return false;
  if (!!b.alt !== e.altKey) return false;
  return true;
}

export function matchAny(bindings: Binding[], e: KeyboardEvent): boolean {
  for (const b of bindings) if (matchBinding(b, e)) return true;
  return false;
}

/**
 * Two bindings are equal as keyboard combos. Used for conflict detection
 * and dedup.
 */
export function bindingEquals(a: Binding, b: Binding): boolean {
  return (
    normKey(a.key) === normKey(b.key) &&
    !!a.meta === !!b.meta &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt
  );
}

// -----------------------------------------------------------------------------
// Display formatting
// -----------------------------------------------------------------------------

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(
    // `navigator.platform` is deprecated but still the most reliable
    // signal in Tauri webviews (userAgent often lies).
    (navigator.platform || "") + " " + (navigator.userAgent || ""),
  );

function formatKeyLabel(k: string): string {
  switch (k) {
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    case "Enter":
      return "⏎";
    case "Backspace":
      return "⌫";
    case "Delete":
      return "Del";
    case "Escape":
      return "Esc";
    case "Tab":
      return "⇥";
    case " ":
      return "Space";
    default:
      return SINGLE_CHAR(k) ? k.toUpperCase() : k;
  }
}

/** Compact human-readable label, e.g. "⌘K", "⇧⌥N", or "Ctrl+Shift+N". */
export function formatBinding(b: Binding): string {
  const parts: string[] = [];
  if (b.meta) parts.push(IS_MAC ? "⌘" : "Ctrl");
  if (b.alt) parts.push(IS_MAC ? "⌥" : "Alt");
  if (b.shift) parts.push(IS_MAC ? "⇧" : "Shift");
  parts.push(formatKeyLabel(b.key));
  return parts.join(IS_MAC ? "" : "+");
}

// -----------------------------------------------------------------------------
// Capture
// -----------------------------------------------------------------------------

const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "Cmd",
  "OS",
  "AltGraph",
  "CapsLock",
]);

/**
 * Listen for the next non-modifier keystroke and report it as a Binding.
 * Esc with no modifier cancels. Uses capture-phase so it beats App / Board
 * handlers while the user is recording.
 *
 * Returns a cleanup that stops listening — call it if the user clicks
 * away before pressing a key.
 */
export function captureBinding(
  onCapture: (b: Binding) => void,
  onCancel: () => void,
): () => void {
  const handler = (e: KeyboardEvent) => {
    // Lone modifier — wait for the actual key.
    if (MODIFIER_KEYS.has(e.key)) return;

    e.preventDefault();
    e.stopPropagation();

    if (
      e.key === "Escape" &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      cleanup();
      onCancel();
      return;
    }

    cleanup();
    onCapture({
      key: SINGLE_CHAR(e.key) ? e.key.toLowerCase() : e.key,
      meta: e.metaKey || e.ctrlKey || undefined,
      shift: e.shiftKey || undefined,
      alt: e.altKey || undefined,
    });
  };

  const cleanup = () => {
    window.removeEventListener("keydown", handler, true);
  };

  window.addEventListener("keydown", handler, true);
  return cleanup;
}

// -----------------------------------------------------------------------------
// Input-focus guard (for board shortcuts)
// -----------------------------------------------------------------------------

/**
 * True when the user is typing in a text-like field. Used by board
 * handlers to skip plain-letter shortcuts (n, /, a, …) so they don't
 * fire mid-typing. Modifier-based bindings are exempt: if Cmd is held,
 * the user clearly meant a shortcut.
 */
export function isTextInputTarget(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}
