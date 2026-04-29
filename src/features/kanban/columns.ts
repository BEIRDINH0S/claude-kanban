import type { CardColumn } from "../../types/card";

export interface ColumnDef {
  id: CardColumn;
  label: string;
  /** Tailwind class for the small status dot in the header. */
  dotClass: string;
}

/**
 * Display order matches the lifecycle: Todo → In Progress → Review → Idle → Done.
 * Dot colors per the design spec — kept very desaturated, no big fills.
 */
export const COLUMNS: readonly ColumnDef[] = [
  { id: "todo", label: "Todo", dotClass: "bg-zinc-400/80" },
  { id: "in_progress", label: "En cours", dotClass: "bg-sky-400" },
  { id: "review", label: "Review", dotClass: "bg-amber-400" },
  { id: "idle", label: "Idle", dotClass: "bg-violet-400" },
  { id: "done", label: "Done", dotClass: "bg-emerald-400" },
] as const;

export function isColumnId(id: string): id is CardColumn {
  return COLUMNS.some((c) => c.id === id);
}
