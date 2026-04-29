import { Plus } from "lucide-react";

import { useCardsStore } from "../../stores/cardsStore";
import {
  selectSessionLimit,
  selectWeeklyLimit,
  useUsageStore,
} from "../../stores/usageStore";
import { RateLimitMeter } from "./RateLimitMeter";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  onCreate: () => void;
}

export function TopBar({ onCreate }: Props) {
  const cardsCount = useCardsStore((s) => s.cards.length);
  const byType = useUsageStore((s) => s.byType);
  const session = selectSessionLimit(byType);
  const weekly = selectWeeklyLimit(byType);
  const hasAny = !!session || !!weekly;

  return (
    <header className="glass-strong z-30 flex items-center gap-6 px-6 py-3">
      <div className="min-w-0 shrink-0">
        <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
          claude-kanban
        </p>
        <p className="mt-0.5 text-[12px] font-medium text-[var(--text-primary)]">
          {cardsCount} {cardsCount === 1 ? "tâche" : "tâches"}
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center gap-7">
        {!hasAny && (
          <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
            usage · en attente du premier event
          </span>
        )}
        {session && (
          <RateLimitMeter label="session" info={session} />
        )}
        {weekly && <RateLimitMeter label="weekly" info={weekly} />}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />
        <button
          type="button"
          onClick={onCreate}
          className="glass flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)]"
        >
          <Plus className="size-4" strokeWidth={1.75} />
          Nouvelle tâche
        </button>
      </div>
    </header>
  );
}
