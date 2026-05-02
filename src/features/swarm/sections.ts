/**
 * Pure derivation of "which section does this card belong to" for the swarm
 * view. The swarm doesn't surface workflow columns (Todo / In progress / …)
 * — it surfaces *runtime* state, which is the honest projection of what each
 * agent is doing right now.
 *
 * Sections, in display order:
 *
 *   1. needs_you  — pending permission OR sticky error OR review column.
 *                   Rises to the top because it blocks progress.
 *   2. active     — SDK call in flight (start_session pending) OR card is
 *                   parked in the In progress column with a live session.
 *   3. resting    — has a sessionId alive in the sidecar but isn't currently
 *                   working. Or parked in the Idle column.
 *   4. queued     — Todo with no live session — i.e. an agent the user has
 *                   drafted but not yet spawned.
 *   5. recent     — Done. Collapsed by default (archive bin).
 *
 * The Card schema still carries `column` (todo / in_progress / review / idle
 * / done) — a holdover from the pre-Phase-2 kanban that we still use as
 * weak metadata when projecting a card into a section (e.g. column == done
 * → recent). A future schema simplification could drop the column entirely,
 * but it costs nothing to keep and Rust still updates it on session events.
 */
import type { Card } from "../../types/card";

export type SectionId = "needs_you" | "active" | "resting" | "queued" | "recent";

export interface SectionDef {
  id: SectionId;
  label: string;
  /** Tailwind class for the section's accent dot in the header. */
  dotClass: string;
  /** Default-collapsed sections (currently just `recent`, the archive). */
  defaultCollapsed: boolean;
}

export const SECTIONS: readonly SectionDef[] = [
  {
    id: "needs_you",
    label: "Needs you",
    dotClass: "bg-amber-400",
    defaultCollapsed: false,
  },
  {
    id: "active",
    label: "Active",
    dotClass: "bg-sky-400",
    defaultCollapsed: false,
  },
  {
    id: "resting",
    label: "Resting",
    dotClass: "bg-emerald-400",
    defaultCollapsed: false,
  },
  {
    id: "queued",
    label: "Queued",
    dotClass: "bg-zinc-400/80",
    defaultCollapsed: false,
  },
  {
    id: "recent",
    label: "Recent",
    dotClass: "bg-violet-400",
    defaultCollapsed: true,
  },
] as const;

export interface CategorizeContext {
  /** Cards with an in-flight `start_session` IPC call. */
  starting: ReadonlySet<string>;
  /** Session ids whose SDK query is alive in the sidecar. */
  liveSessions: ReadonlySet<string>;
  /** Cards with a pending permission request. */
  pendingPerms: Readonly<Record<string, unknown>>;
  /** Cards with a sticky error. */
  errors: Readonly<Record<string, unknown>>;
}

/**
 * Pure: pick the section for a card given the runtime context. Order of
 * checks matters — `needs_you` wins over `active` because a working session
 * waiting on a permission should still surface in the attention bucket.
 */
export function categorize(card: Card, ctx: CategorizeContext): SectionId {
  if (ctx.pendingPerms[card.id] || ctx.errors[card.id]) return "needs_you";
  if (card.column === "review") return "needs_you";

  if (ctx.starting.has(card.id)) return "active";
  if (card.column === "in_progress") return "active";

  if (card.sessionId && ctx.liveSessions.has(card.sessionId)) return "resting";
  if (card.column === "idle") return "resting";

  if (card.column === "done") return "recent";
  return "queued";
}

/**
 * Group a card list into sections, preserving each card's relative order
 * within its section. We intentionally keep `position` ordering inside a
 * section (not "most-recent-first") so a card moving from `active` to
 * `resting` doesn't shuffle the rest of the list — the surrounding rows
 * stay put, only the moving row jumps.
 */
export function groupBySection(
  cards: Card[],
  ctx: CategorizeContext,
): Record<SectionId, Card[]> {
  const out: Record<SectionId, Card[]> = {
    needs_you: [],
    active: [],
    resting: [],
    queued: [],
    recent: [],
  };
  for (const card of cards) {
    out[categorize(card, ctx)].push(card);
  }
  for (const id of Object.keys(out) as SectionId[]) {
    out[id].sort((a, b) => a.position - b.position);
  }
  return out;
}
