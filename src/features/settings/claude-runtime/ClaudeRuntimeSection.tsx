import { Terminal } from "lucide-react";
import { useEffect, useState } from "react";

import {
  PREF_CLAUDE_RUNTIME,
  type ClaudeRuntimePref,
  getPref,
  setPref,
} from "../../../ipc/prefs";
import { useErrorsStore } from "../../../stores/errorsStore";
import { Card } from "../layout";

/**
 * The Claude runtime selector only matters on Windows: WSL doesn't exist
 * elsewhere, and on Mac/Linux `auto` and `native` resolve to the same
 * thing (= use the SDK-bundled binary unless one is on PATH). Detected
 * via the webview's userAgent — cheap, no extra plugin dep needed. The
 * orchestrator uses this flag to decide whether to mount the section at
 * all.
 */
export function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Windows/i.test(navigator.userAgent);
}

const RUNTIME_OPTIONS: {
  value: ClaudeRuntimePref;
  label: string;
  hint: string;
}[] = [
  {
    value: "auto",
    label: "Auto",
    hint:
      "Use the native claude if found, otherwise fall back to WSL (Windows).",
  },
  {
    value: "native",
    label: "Native",
    hint:
      "Force the claude binary shipped with the SDK or installed on the host system.",
  },
  {
    value: "wsl",
    label: "WSL",
    hint:
      "Force the claude installed inside WSL. The sidecar generates a `wsl claude %*` shim on the fly — no manual `claude.bat` needed.",
  },
];

export function ClaudeRuntimeSection() {
  const claudeBinary = useErrorsStore((s) => s.claudeBinary);
  const effectiveRuntime = useErrorsStore((s) => s.runtime);

  // Persisted user preference — read once, then optimistic-update on change.
  const [pref, setPrefState] = useState<ClaudeRuntimePref | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPref(PREF_CLAUDE_RUNTIME)
      .then((v) => {
        if (cancelled) return;
        const parsed: ClaudeRuntimePref =
          v === "native" || v === "wsl" || v === "auto" ? v : "auto";
        setPrefState(parsed);
      })
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = async (value: ClaudeRuntimePref) => {
    if (saving || pref === value) return;
    setSaving(true);
    setErr(null);
    const previous = pref;
    setPrefState(value); // optimistic
    try {
      await setPref(PREF_CLAUDE_RUNTIME, value);
    } catch (e) {
      setPrefState(previous);
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  // Effective ≠ pref happens when the user picked WSL but no WSL claude was
  // found (sidecar silently fell back), or before they saved their first
  // pref and the sidecar booted with the default.
  const showRestartHint =
    pref !== null && effectiveRuntime && pref !== "auto" && pref !== effectiveRuntime;

  return (
    <Card
      icon={
        <Terminal
          className="size-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
      }
      title="Claude runtime"
      subtitle="Pick which claude binary the sidecar should use. Mainly relevant on Windows when your install lives inside WSL (auth, MCP servers, ~/.claude config all on the Linux side)."
    >
      <div className="mt-3 flex flex-col gap-1.5">
        {RUNTIME_OPTIONS.map((opt) => {
          const selected = pref === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => void handleSelect(opt.value)}
              disabled={saving || pref === null}
              className={[
                "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                selected
                  ? "border-[var(--color-accent-ring)] bg-[var(--color-accent)]/10"
                  : "border-[var(--glass-stroke)] hover:border-[var(--color-accent-ring)]",
              ].join(" ")}
            >
              <span
                className={[
                  "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border",
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                    : "border-[var(--glass-stroke)]",
                ].join(" ")}
              >
                {selected && (
                  <span className="size-1.5 rounded-full bg-white" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-[var(--text-primary)]">
                  {opt.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
                  {opt.hint}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Status line — what the sidecar actually resolved at boot. */}
      <div className="mt-3 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5">
        <p className="font-mono text-[11px] text-[var(--text-muted)]">
          Boot state ·{" "}
          <span className="text-[var(--text-secondary)]">
            runtime = {effectiveRuntime ?? "?"}
          </span>{" "}
          ·{" "}
          <span className="text-[var(--text-secondary)]">
            binary ={" "}
            {claudeBinary === undefined
              ? "?"
              : claudeBinary === null
              ? "(SDK bundled)"
              : claudeBinary}
          </span>
        </p>
        {showRestartHint && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300/90">
            Restart the app to apply the new runtime ({pref}).
          </p>
        )}
      </div>

      {err && (
        <p className="mt-2 font-mono text-[11px] text-red-700 dark:text-red-400 break-words">
          {err}
        </p>
      )}
    </Card>
  );
}
