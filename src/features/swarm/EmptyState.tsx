/**
 * Filler shown in the swarm view's main pane when nothing is selected. Two
 * cases share this surface:
 *
 *   - the project has zero agents at all (`hasAnyAgent === false`)
 *   - the project has agents but the user hasn't picked one yet
 *
 * We render the same layout in both cases — the only thing that changes is
 * the copy. Spawn affordance lives in the list header, not here, so this
 * stays purely informational.
 */
import { MousePointerClick, Sparkles } from "lucide-react";

interface Props {
  hasAnyAgent: boolean;
  /** Project name, when one is active. Lets us personalise the empty copy. */
  projectName?: string | null;
}

export function EmptyState({ hasAnyAgent, projectName }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="grid size-12 place-items-center rounded-2xl border border-[var(--glass-stroke)] text-[var(--text-muted)]">
        {hasAnyAgent ? (
          <MousePointerClick className="size-5" strokeWidth={1.5} />
        ) : (
          <Sparkles className="size-5" strokeWidth={1.5} />
        )}
      </div>
      <h2 className="text-[14px] font-medium text-[var(--text-primary)]">
        {hasAnyAgent
          ? "Pick an agent on the left"
          : projectName
          ? `No agents in ${projectName} yet`
          : "No agents yet"}
      </h2>
      <p className="max-w-[340px] text-[12px] leading-relaxed text-[var(--text-muted)]">
        {hasAnyAgent
          ? "Select an agent from the list to see its conversation, diff, and config in this pane."
          : "Spawn one from the top-right of the list to start a Claude session — each agent runs in its own worktree so they never trample each other."}
      </p>
    </div>
  );
}
