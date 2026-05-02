/**
 * Keyboard-shortcuts editor. Each row shows a shortcut's current bindings
 * as small chips; clicking a chip captures the next keystroke and replaces
 * the binding. The capture flow lives in `lib/shortcuts::captureBinding`,
 * which installs a one-shot capture-phase listener so it intercepts the
 * user's next keystroke before App.tsx / SwarmView can act on it.
 *
 * The four small components below (`ShortcutGroup`, `ShortcutRow`,
 * `BindingChip`, `RecordingChip`) are kept inline because they're only
 * used by `ShortcutsSection` and splitting them into separate files would
 * add five tiny imports for no readability gain.
 */
import { Keyboard, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  SHORTCUTS,
  SHORTCUT_BY_ID,
  type Binding,
  type ShortcutId,
  captureBinding,
  formatBinding,
} from "../../../lib/shortcuts";
import {
  findConflict,
  useShortcutsStore,
} from "../../../stores/shortcutsStore";
import { Card } from "../layout";

export function ShortcutsSection() {
  const bindings = useShortcutsStore((s) => s.bindings);
  const replaceBinding = useShortcutsStore((s) => s.replaceBinding);
  const addBinding = useShortcutsStore((s) => s.addBinding);
  const removeBinding = useShortcutsStore((s) => s.removeBinding);
  const resetBindings = useShortcutsStore((s) => s.resetBindings);
  const resetAll = useShortcutsStore((s) => s.resetAll);

  // Capture state: identifies the shortcut + slot we're currently recording.
  // `index === -1` means "appending a new binding". The cleanup function from
  // captureBinding() lives in a ref so we can cancel it if the user clicks
  // a different chip mid-capture.
  type CaptureTarget = { id: ShortcutId; index: number };
  const [capturing, setCapturing] = useState<CaptureTarget | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Cancel any active capture when the section unmounts.
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const startCapture = (target: CaptureTarget) => {
    cleanupRef.current?.();
    setConflictMsg(null);
    setCapturing(target);
    cleanupRef.current = captureBinding(
      (binding) => {
        cleanupRef.current = null;
        setCapturing(null);
        const conflict = findConflict(binding, target.id);
        if (conflict) {
          // Non-blocking: persist the change but warn so the user knows
          // the same combo also fires another action. They can clear it
          // from the conflicting row if they want.
          setConflictMsg(
            `"${formatBinding(binding)}" is also bound to: ${
              SHORTCUT_BY_ID[conflict].label
            }.`,
          );
        }
        if (target.index === -1) {
          addBinding(target.id, binding);
        } else {
          replaceBinding(target.id, target.index, binding);
        }
      },
      () => {
        cleanupRef.current = null;
        setCapturing(null);
      },
    );
  };

  const isCapturing = (id: ShortcutId, index: number) =>
    capturing?.id === id && capturing.index === index;

  const globals = SHORTCUTS.filter((s) => s.scope === "global");
  const board = SHORTCUTS.filter((s) => s.scope === "board");

  return (
    <Card
      icon={
        <Keyboard
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Keyboard shortcuts"
      subtitle='Click a chip to rebind it (then press the new combo, Esc to cancel). "+" adds an extra key that triggers the same action.'
    >
      <ShortcutGroup label="Global">
        {globals.map((def) => (
          <ShortcutRow
            key={def.id}
            id={def.id}
            label={def.label}
            description={def.description}
            bindings={bindings[def.id] ?? []}
            isCapturing={isCapturing}
            onStartCapture={startCapture}
            onRemove={(idx) => removeBinding(def.id, idx)}
            onReset={() => resetBindings(def.id)}
          />
        ))}
      </ShortcutGroup>

      <ShortcutGroup label="Board">
        {board.map((def) => (
          <ShortcutRow
            key={def.id}
            id={def.id}
            label={def.label}
            description={def.description}
            bindings={bindings[def.id] ?? []}
            isCapturing={isCapturing}
            onStartCapture={startCapture}
            onRemove={(idx) => removeBinding(def.id, idx)}
            onReset={() => resetBindings(def.id)}
          />
        ))}
      </ShortcutGroup>

      {conflictMsg && (
        <p className="mt-3 font-mono text-[11px] text-amber-700 dark:text-amber-300/90">
          {conflictMsg}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            cleanupRef.current?.();
            cleanupRef.current = null;
            setCapturing(null);
            setConflictMsg(null);
            resetAll();
          }}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] hover:border-[var(--color-accent-ring)] hover:text-[var(--text-primary)]"
        >
          <RotateCcw className="size-3" strokeWidth={1.75} />
          Reset all
        </button>
      </div>
    </Card>
  );
}

function ShortcutGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 first:mt-3">
      <p className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-[var(--text-muted)] uppercase">
        {label}
      </p>
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

function ShortcutRow({
  id,
  label,
  description,
  bindings,
  isCapturing,
  onStartCapture,
  onRemove,
  onReset,
}: {
  id: ShortcutId;
  label: string;
  description?: string;
  bindings: Binding[];
  isCapturing: (id: ShortcutId, index: number) => boolean;
  onStartCapture: (target: { id: ShortcutId; index: number }) => void;
  onRemove: (index: number) => void;
  onReset: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 border-b border-[var(--glass-stroke)] py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-[var(--text-primary)]">{label}</p>
        {description && (
          <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-muted)]">
            {description}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {bindings.length === 0 && !isCapturing(id, -1) && (
          <span className="font-mono text-[10.5px] text-[var(--text-muted)] italic">
            disabled
          </span>
        )}

        {bindings.map((b, idx) =>
          isCapturing(id, idx) ? (
            <RecordingChip key={idx} />
          ) : (
            <BindingChip
              key={idx}
              binding={b}
              onClick={() => onStartCapture({ id, index: idx })}
              onRemove={
                bindings.length > 1 || isCapturing(id, -1)
                  ? () => onRemove(idx)
                  : undefined
              }
            />
          ),
        )}

        {isCapturing(id, -1) && <RecordingChip />}

        <button
          type="button"
          onClick={() => onStartCapture({ id, index: -1 })}
          aria-label="Add a binding"
          title="Add a binding"
          className="grid size-6 place-items-center rounded-md border border-dashed border-[var(--glass-stroke)] text-[var(--text-muted)] hover:border-[var(--color-accent-ring)] hover:text-[var(--text-primary)]"
        >
          <Plus className="size-3" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={onReset}
          aria-label="Reset this shortcut"
          title="Reset"
          className="grid size-6 place-items-center rounded-md text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
        >
          <RotateCcw className="size-3" strokeWidth={1.75} />
        </button>
      </div>
    </li>
  );
}

function BindingChip({
  binding,
  onClick,
  onRemove,
}: {
  binding: Binding;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-md border border-[var(--glass-stroke)] bg-black/5 dark:bg-white/5">
      <button
        type="button"
        onClick={onClick}
        title="Click to replace"
        className="px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
      >
        {formatBinding(binding)}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove this shortcut"
          title="Remove"
          className="grid h-full place-items-center border-l border-[var(--glass-stroke)] px-1 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-400"
        >
          <X className="size-2.5" strokeWidth={2} />
        </button>
      )}
    </span>
  );
}

function RecordingChip() {
  return (
    <span className="inline-flex animate-pulse items-center gap-1.5 rounded-md border border-[var(--color-accent-ring)] bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10.5px] text-[var(--text-primary)]">
      <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
      Press a key…
    </span>
  );
}
