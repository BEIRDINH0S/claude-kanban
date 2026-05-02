/**
 * Lets the user replay the first-run tutorial on demand. Useful after
 * dismissing it, or when revisiting the app weeks later. Calls the
 * tutorial store directly — the store lives in `stores/` and is allowed
 * cross-feature, so we don't need to import the tutorial feature itself
 * (which would break isolation: `features/settings → features/tutorial`).
 *
 * `replay()` clears the persisted "seen" flag and flips the store status
 * to `"active"`. The `<TutorialOverlay />` mounted in App.tsx picks it up
 * automatically.
 */
import { GraduationCap } from "lucide-react";

import { useTutorialStore } from "../../../stores/tutorialStore";
import { Card } from "../layout";

export function ReplayTutorialSection() {
  const replay = useTutorialStore((s) => s.replay);
  const active = useTutorialStore((s) => s.status === "active");

  return (
    <Card
      icon={
        <GraduationCap
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Replay the welcome tour"
      subtitle="Walks you through projects, tasks, and permissions in three short steps. Useful if you skipped it or want a refresher."
      trailing={
        <button
          type="button"
          onClick={replay}
          disabled={active}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {active ? "Running…" : "Replay"}
        </button>
      }
    />
  );
}
