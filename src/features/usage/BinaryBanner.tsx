import { TriangleAlert } from "lucide-react";

import { useErrorsStore } from "../../stores/errorsStore";

export function BinaryBanner() {
  const claudeBinary = useErrorsStore((s) => s.claudeBinary);
  if (claudeBinary !== null) return null;

  return (
    <div className="flex items-center gap-2.5 border-b border-amber-500/50 bg-amber-100/60 px-6 py-2.5 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300/90">
      <TriangleAlert className="size-4 shrink-0" strokeWidth={1.75} />
      <span className="text-[12px] font-medium">
        Claude Code introuvable sur ton PATH.
      </span>
      <span className="text-[12px] text-amber-700/80 dark:text-amber-200/70">
        Installe-le pour pouvoir démarrer ou reprendre une session — les
        cartes restent navigables et supprimables.
      </span>
    </div>
  );
}
