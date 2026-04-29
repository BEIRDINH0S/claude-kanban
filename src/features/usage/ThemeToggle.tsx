import { Moon, Sun } from "lucide-react";

import { useThemeStore } from "../../stores/themeStore";

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggleTheme);
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? "Passer en clair" : "Passer en sombre"}
      aria-label={isDark ? "Passer en clair" : "Passer en sombre"}
      className="glass grid size-9 shrink-0 place-items-center rounded-xl text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--color-accent-ring)]"
    >
      {isDark ? (
        <Moon className="size-4" strokeWidth={1.75} />
      ) : (
        <Sun className="size-4" strokeWidth={1.75} />
      )}
    </button>
  );
}
