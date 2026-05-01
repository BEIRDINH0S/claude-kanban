import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { rebuildUsageIndex } from "../../ipc/usage";
import { useUsageIndexStore } from "../../stores/usageIndexStore";

import { formatCost, formatTokens, shortModel, shortProjectName } from "./format";
import { SubscriptionMeter } from "./SubscriptionMeter";
import { UsageBreakdown } from "./UsageBreakdown";
import { UsageHeadline } from "./UsageHeadline";
import { UsageRangeSwitcher } from "./UsageRangeSwitcher";

/**
 * Full-screen Usage view. Inspired by what `ccusage` and
 * `claude-code-usage-monitor` show in their CLI dashboards: total spend,
 * cache efficiency, and a breakdown by model / project / card so you can
 * answer "what cost me the most this week".
 *
 * Lives at `view === "usage"` in the central pane. Listens to the
 * `usage-changed` Tauri event (App.tsx) to refresh whenever a JSONL
 * append lands.
 */
export function UsagePage() {
  const range = useUsageIndexStore((s) => s.range);
  const setRange = useUsageIndexStore((s) => s.setRange);
  const data = useUsageIndexStore((s) => s.data);
  const isLoading = useUsageIndexStore((s) => s.isLoading);
  const error = useUsageIndexStore((s) => s.error);
  const refresh = useUsageIndexStore((s) => s.refresh);
  const lastUpdatedAt = useUsageIndexStore((s) => s.lastUpdatedAt);

  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);

  // First-load + 60 s safety refresh. The watcher → `usage-changed`
  // listener (in App.tsx) handles event-driven updates; this catches
  // the case where the watcher isn't running (rare).
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleRebuild = async () => {
    if (rebuilding) return;
    setRebuilding(true);
    setRebuildMsg(null);
    try {
      const inserted = await rebuildUsageIndex();
      setRebuildMsg(`Index reconstruit · ${inserted.toLocaleString()} messages indexés.`);
      await refresh();
    } catch (e) {
      setRebuildMsg(`Erreur · ${String(e)}`);
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="flex flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[960px] px-6 py-6">
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
              Usage
            </p>
            <h1 className="mt-1 text-[15px] font-semibold text-[var(--text-primary)]">
              Abonnement Claude
            </h1>
            <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">
              Pourcentage exact des fenêtres 5h / 7j, lu via l'endpoint
              OAuth qu'utilise <code className="font-mono text-[11px]">/usage</code>.
            </p>
          </div>
        </header>

        {/* Subscription meter — the headline metric -------------------- */}
        <div className="mt-5">
          <SubscriptionMeter />
        </div>

        {/* Where does my plan time go? --------------------------------- */}
        <header className="mt-8 flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
              Détail
            </p>
            <h2 className="mt-1 text-[14px] font-semibold text-[var(--text-primary)]">
              Où va ta consommation ?
              {data?.pricingVersion && (
                <span className="ml-2 font-mono text-[10.5px] text-[var(--text-muted)]">
                  pricing v{data.pricingVersion}
                </span>
              )}
            </h2>
            <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">
              Tokens locaux indexés depuis{" "}
              <code className="font-mono text-[11px]">~/.claude/projects/**</code>.
              Ne change pas ton % d'abonnement — c'est juste pour comprendre
              quels projets / modèles te coûtent le plus.
            </p>
          </div>
          <UsageRangeSwitcher range={range} onChange={setRange} />
        </header>

        {error && (
          <p className="mt-4 rounded-xl border border-red-500/40 bg-red-100/60 px-3 py-2 font-mono text-[11px] text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
            Erreur de chargement · {error}
          </p>
        )}

        {/* Headline KPIs ------------------------------------------------- */}
        <div className="mt-5">
          {data ? (
            <UsageHeadline summary={data.summary} />
          ) : (
            <SkeletonHeadline />
          )}
        </div>

        {/* Breakdowns -------------------------------------------------- */}
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <UsageBreakdown
            title="Par modèle"
            rows={
              data?.byModel.map((m) => ({
                key: m.model,
                label: shortModel(m.model),
                sublabel:
                  m.summary.cacheCreation1h > 0
                    ? `${formatTokens(m.summary.cacheCreation1h)} cache 1h`
                    : undefined,
                summary: m.summary,
              })) ?? []
            }
          />

          <UsageBreakdown
            title="Par projet"
            rows={
              data?.byProject.map((p) => ({
                key: p.projectPath,
                label: shortProjectName(p.projectPath),
                sublabel: p.projectPath,
                summary: p.summary,
              })) ?? []
            }
          />
        </div>

        <div className="mt-5">
          <UsageBreakdown
            title="Top cartes"
            rows={
              data?.byCard.map((c) => ({
                key: c.cardId,
                label: c.cardTitle ?? "(carte supprimée)",
                summary: c.summary,
              })) ?? []
            }
            emptyHint="Aucune carte n'a consommé sur cette plage."
          />
        </div>

        {/* Recent sessions list -------------------------------------- */}
        {data && data.recentSessions.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-[10.5px] font-semibold tracking-[0.18em] text-[var(--text-muted)] uppercase">
              Sessions récentes
            </h2>
            <ul className="flex flex-col gap-1">
              {data.recentSessions.slice(0, 10).map((s) => {
                const totalTokens =
                  s.summary.inputTokens +
                  s.summary.outputTokens +
                  s.summary.cacheReadTokens +
                  s.summary.cacheCreationTokens;
                return (
                  <li
                    key={s.sessionId}
                    className="flex items-baseline justify-between gap-3 rounded-lg border border-[var(--glass-stroke)] px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                        {s.cardTitle ?? `session ${s.sessionId.slice(0, 8)}`}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--text-muted)]">
                        {shortProjectName(s.projectPath)} ·{" "}
                        {new Date(s.lastActivityAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-2 font-mono tabular-nums">
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {formatTokens(totalTokens)} tok
                      </span>
                      <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                        {formatCost(s.summary.costUsd)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Rebuild --------------------------------------------------- */}
        <section className="mt-8 rounded-xl border border-[var(--glass-stroke)] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-[var(--text-primary)]">
                Reconstruire l'index
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
                Re-parse l'intégralité des fichiers JSONL dans
                <code className="font-mono text-[11px]"> ~/.claude/projects </code>
                et recalcule tokens + coût avec la table de prix actuelle.
                Utile après une mise à jour qui change les tarifs Anthropic.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleRebuild()}
              disabled={rebuilding || isLoading}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw
                className={`size-3.5 ${rebuilding ? "animate-spin" : ""}`}
                strokeWidth={1.75}
              />
              {rebuilding ? "Reconstruction…" : "Rescan"}
            </button>
          </div>
          {rebuildMsg && (
            <p className="mt-2 font-mono text-[11px] text-[var(--text-secondary)]">
              {rebuildMsg}
            </p>
          )}
        </section>

        {/* Footer status line ---------------------------------------- */}
        <p className="mt-6 font-mono text-[10.5px] text-[var(--text-muted)]">
          {isLoading
            ? "Mise à jour…"
            : lastUpdatedAt
            ? `Dernière mise à jour ${new Date(lastUpdatedAt).toLocaleTimeString()}`
            : "Premier chargement…"}
        </p>
      </div>
    </div>
  );
}

function SkeletonHeadline() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-[var(--glass-stroke)] px-4 py-3"
        >
          <div className="h-3 w-12 rounded bg-black/10 dark:bg-white/10" />
          <div className="mt-2 h-7 w-20 rounded bg-black/10 dark:bg-white/10" />
        </div>
      ))}
    </div>
  );
}
