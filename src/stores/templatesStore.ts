import { create } from "zustand";

import { getPref, PREF_PROMPT_TEMPLATES, setPref } from "../ipc/prefs";

/**
 * A reusable prompt snippet the user can pull into the message input via
 * the slash menu. `name` is the searchable label shown in the menu;
 * `body` is the actual text that lands in the textarea.
 */
export interface PromptTemplate {
  id: string;
  name: string;
  body: string;
}

/**
 * Templates seeded on first run so the feature isn't a blank slate. Kept
 * minimal — anything more opinionated belongs to the user. The Settings
 * page lets them add / edit / remove freely.
 */
const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: "seed-implement",
    name: "Implémenter une feature",
    body:
      "Lis le code concerné, propose un plan court (3–5 étapes), puis " +
      "implémente. Ne commit pas avant que je valide.",
  },
  {
    id: "seed-review",
    name: "Review du diff",
    body:
      "Fais une review du diff actuel : qualité, edge cases, risques. " +
      "Pointe les fichiers / lignes précises. Pas de fix automatique.",
  },
  {
    id: "seed-tests",
    name: "Écrire des tests",
    body:
      "Ajoute des tests pour la dernière modif. Couvre le happy path + au " +
      "moins 2 cas limites. Lance la suite et corrige ce qui casse.",
  },
];

interface State {
  templates: PromptTemplate[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  add: (name: string, body: string) => Promise<PromptTemplate>;
  update: (id: string, patch: Partial<Omit<PromptTemplate, "id">>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * Generate an opaque id. We avoid `crypto.randomUUID` direct dependency
 * so the same code path works in older webviews — falls back to a
 * timestamp + random suffix which is plenty unique for a per-user list.
 */
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Defensive parse: tolerate any shape from disk (older builds, manual
 * edits) by filtering anything that doesn't match the contract. We never
 * throw on malformed JSON — the user shouldn't lose their input box just
 * because a pref got corrupted.
 */
function parseStored(raw: string | null): PromptTemplate[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    const cleaned: PromptTemplate[] = [];
    for (const it of v) {
      if (
        it &&
        typeof it === "object" &&
        typeof (it as PromptTemplate).id === "string" &&
        typeof (it as PromptTemplate).name === "string" &&
        typeof (it as PromptTemplate).body === "string"
      ) {
        cleaned.push({
          id: (it as PromptTemplate).id,
          name: (it as PromptTemplate).name,
          body: (it as PromptTemplate).body,
        });
      }
    }
    return cleaned;
  } catch {
    return null;
  }
}

async function persist(templates: PromptTemplate[]): Promise<void> {
  await setPref(PREF_PROMPT_TEMPLATES, JSON.stringify(templates));
}

export const useTemplatesStore = create<State>((set, get) => ({
  templates: [],
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const raw = await getPref(PREF_PROMPT_TEMPLATES);
      const parsed = parseStored(raw);
      // First run (no row at all) → seed with defaults and persist so the
      // user can edit them next time. An explicitly emptied list (`"[]"`)
      // is honoured: parsed is `[]`, distinct from `null`.
      if (parsed === null) {
        set({ templates: DEFAULT_TEMPLATES, loaded: true, loading: false });
        try {
          await persist(DEFAULT_TEMPLATES);
        } catch {
          // Best-effort seed — we'll re-seed next boot if it failed.
        }
      } else {
        set({ templates: parsed, loaded: true, loading: false });
      }
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  add: async (name, body) => {
    const tpl: PromptTemplate = {
      id: newId(),
      name: name.trim(),
      body,
    };
    const next = [tpl, ...get().templates];
    await persist(next);
    set({ templates: next });
    return tpl;
  },

  update: async (id, patch) => {
    const next = get().templates.map((t) =>
      t.id === id
        ? {
            ...t,
            ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
            ...(patch.body !== undefined ? { body: patch.body } : {}),
          }
        : t,
    );
    await persist(next);
    set({ templates: next });
  },

  remove: async (id) => {
    const next = get().templates.filter((t) => t.id !== id);
    await persist(next);
    set({ templates: next });
  },
}));
