import { create } from "zustand";

export interface PendingPermission {
  requestId: string;
  cardId: string;
  sessionId: string | null;
  toolName: string;
  input: unknown;
}

interface PermissionsState {
  /** One pending permission per card at most — Claude can't ask two tools at
   *  once on the same session. */
  byCard: Record<string, PendingPermission>;
  set: (p: PendingPermission) => void;
  clearForCard: (cardId: string) => void;
}

export const usePermissionsStore = create<PermissionsState>((set) => ({
  byCard: {},
  set: (p) =>
    set((s) => ({ byCard: { ...s.byCard, [p.cardId]: p } })),
  clearForCard: (cardId) =>
    set((s) => {
      const next = { ...s.byCard };
      delete next[cardId];
      return { byCard: next };
    }),
}));
