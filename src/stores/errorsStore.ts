import { create } from "zustand";

/**
 * Runtime the sidecar actually resolved at boot. Surfaced by the `binary-
 * status` event so Settings can show "currently running via WSL" etc.
 * Distinct from the persisted user pref (which lives in app_prefs).
 */
export type EffectiveRuntime = "native" | "wsl";

interface ErrorsState {
  /** Latest user-facing error per card. Null = card is healthy. */
  byCard: Record<string, string>;
  /** App-level: claude binary location, or null when not installed. */
  claudeBinary: string | null | undefined;
  /** Runtime the sidecar resolved at boot — used by Settings to confirm
   *  whether a WSL pref change has taken effect (visible after restart). */
  runtime: EffectiveRuntime | undefined;

  setForCard: (cardId: string, message: string) => void;
  clearForCard: (cardId: string) => void;
  setBinaryStatus: (path: string | null, runtime: EffectiveRuntime | null) => void;
}

export const useErrorsStore = create<ErrorsState>((set) => ({
  byCard: {},
  claudeBinary: undefined, // undefined = not yet known, null = confirmed missing
  runtime: undefined,

  setForCard: (cardId, message) =>
    set((s) => ({ byCard: { ...s.byCard, [cardId]: message } })),

  clearForCard: (cardId) =>
    set((s) => {
      if (!s.byCard[cardId]) return {};
      const next = { ...s.byCard };
      delete next[cardId];
      return { byCard: next };
    }),

  setBinaryStatus: (path, runtime) =>
    set({ claudeBinary: path, runtime: runtime ?? undefined }),
}));
