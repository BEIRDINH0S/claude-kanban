import { create } from "zustand";

import {
  addPermissionRule,
  listPermissionRules,
  removePermissionRule,
  type PermissionRule,
} from "../ipc/permissions";

interface State {
  rules: PermissionRule[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  add: (pattern: string) => Promise<PermissionRule>;
  remove: (id: string) => Promise<void>;
}

export const usePermissionRulesStore = create<State>((set, get) => ({
  rules: [],
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const rules = await listPermissionRules();
      set({ rules, loaded: true, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  add: async (pattern) => {
    const rule = await addPermissionRule(pattern);
    set((s) => {
      // Replace if same id (same pattern was already there) else prepend.
      const existing = s.rules.find((r) => r.id === rule.id);
      const next = existing
        ? s.rules.map((r) => (r.id === rule.id ? rule : r))
        : [rule, ...s.rules];
      return { rules: next };
    });
    return rule;
  },

  remove: async (id) => {
    await removePermissionRule(id);
    set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
  },
}));
