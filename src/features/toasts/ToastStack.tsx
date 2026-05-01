import { X } from "lucide-react";

import { useToastsStore } from "../../stores/toastsStore";

/** Bottom-right stack of dismissable toasts. Driven entirely by the store. */
export function ToastStack() {
  const toasts = useToastsStore((s) => s.toasts);
  const dismiss = useToastsStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-40 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="glass-strong pointer-events-auto flex items-center gap-3 rounded-xl px-3.5 py-2 shadow-lg"
        >
          <p className="text-[12.5px] text-[var(--text-primary)]">
            {t.message}
          </p>
          {t.action && (
            <button
              type="button"
              onClick={async () => {
                await t.action!.handler();
                dismiss(t.id);
              }}
              className="rounded-md px-2 py-0.5 text-[11.5px] font-medium text-[var(--color-accent)] hover:bg-black/5 dark:hover:bg-white/5"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="rounded-md p-0.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
            aria-label="Close"
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        </div>
      ))}
    </div>
  );
}
