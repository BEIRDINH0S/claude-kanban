import { create } from "zustand";

export type Theme = "light" | "dark";

const STORAGE_KEY = "claude-kanban-theme";

function readPref(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // ignore
  }
  // First-time default: follow the OS preference once, then we own the choice.
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore quota errors etc.
  }
}

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readPref(),

  toggleTheme: () => {
    const next: Theme = get().theme === "light" ? "dark" : "light";
    apply(next);
    set({ theme: next });
  },
}));
