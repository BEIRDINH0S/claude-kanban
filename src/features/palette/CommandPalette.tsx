import {
  CornerDownLeft,
  FolderKanban,
  IdCard,
  Moon,
  Plus,
  Settings,
  Sun,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCardsStore } from "../../stores/cardsStore";
import { useProjectsStore } from "../../stores/projectsStore";
import { useThemeStore } from "../../stores/themeStore";
import { useUiStore } from "../../stores/uiStore";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  /** Anything searchable that isn't already in `label`. */
  keywords?: string[];
  run: () => void;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const setView = useUiStore((s) => s.setView);
  const setActiveProjectId = useUiStore((s) => s.setActiveProjectId);
  const openZoom = useUiStore((s) => s.openZoom);
  const projects = useProjectsStore((s) => s.projects);
  const cards = useCardsStore((s) => s.cards);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build the command list freshly each time the palette opens; it's small
  // (projects + active-project cards + a handful of actions) and cheap to
  // recompute on every render.
  const items: CommandItem[] = useMemo(() => {
    const out: CommandItem[] = [];
    out.push({
      id: "new-task",
      label: "Nouvelle tâche",
      icon: <Plus className="size-3.5" strokeWidth={1.75} />,
      hint: "Action",
      run: () => {
        setView("board");
        // Tiny side-channel: the BoardHeader's create button is the only
        // owner of the modal. We dispatch a custom DOM event it can listen
        // for. Cleaner than threading another store flag through.
        window.dispatchEvent(new CustomEvent("claude-kanban:new-task"));
      },
    });
    out.push({
      id: "projects",
      label: "Projets · gérer / créer",
      icon: <FolderKanban className="size-3.5" strokeWidth={1.75} />,
      hint: "Aller à",
      keywords: ["nouveau", "projet", "create"],
      run: () => setView("projects"),
    });
    out.push({
      id: "usage",
      label: "Usage · tokens & coût",
      icon: <TrendingUp className="size-3.5" strokeWidth={1.75} />,
      hint: "Aller à",
      keywords: ["consommation", "token", "cost", "spend", "claude", "anthropic"],
      run: () => setView("usage"),
    });
    out.push({
      id: "settings",
      label: "Paramètres",
      icon: <Settings className="size-3.5" strokeWidth={1.75} />,
      hint: "Aller à",
      run: () => setView("settings"),
    });
    out.push({
      id: "theme",
      label: theme === "dark" ? "Passer en clair" : "Passer en sombre",
      icon:
        theme === "dark" ? (
          <Sun className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Moon className="size-3.5" strokeWidth={1.75} />
        ),
      hint: "Action",
      keywords: ["theme", "thème", "dark", "light", "sombre", "clair"],
      run: () => toggleTheme(),
    });
    for (const p of projects) {
      out.push({
        id: `project-${p.id}`,
        label: p.name,
        icon: <FolderKanban className="size-3.5" strokeWidth={1.75} />,
        hint: p.archived ? "Projet · archivé" : "Projet",
        keywords: [p.archived ? "archivé archive" : ""],
        run: () => setActiveProjectId(p.id),
      });
    }
    for (const c of cards) {
      out.push({
        id: `card-${c.id}`,
        label: c.title,
        icon: <IdCard className="size-3.5" strokeWidth={1.75} />,
        hint: "Carte",
        keywords: [c.column, c.projectPath],
        run: () => openZoom(c.id),
      });
    }
    return out;
  }, [
    projects,
    cards,
    theme,
    setView,
    setActiveProjectId,
    openZoom,
    toggleTheme,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => {
      const hay = (
        i.label +
        " " +
        (i.keywords?.join(" ") ?? "")
      ).toLowerCase();
      return q.split(/\s+/).every((tok) => hay.includes(tok));
    });
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // Focus a tick after render so the input is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  const run = (idx: number) => {
    const it = filtered[idx];
    if (!it) return;
    it.run();
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="glass-strong mt-[14vh] w-full max-w-[560px] overflow-hidden rounded-2xl shadow-2xl">
        <div className="border-b border-[var(--glass-stroke)] px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) =>
                  filtered.length === 0
                    ? 0
                    : Math.min(c + 1, filtered.length - 1),
                );
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(cursor);
              }
            }}
            placeholder="Cherche un projet, une carte, une action…"
            className="w-full bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>

        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-[12px] text-[var(--text-muted)]">
              Rien ne correspond.
            </li>
          )}
          {filtered.map((it, idx) => {
            const active = idx === cursor;
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(idx)}
                  onClick={() => run(idx)}
                  className={[
                    "flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors",
                    active
                      ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)]",
                  ].join(" ")}
                >
                  <span className="text-[var(--text-muted)]">{it.icon}</span>
                  <span className="flex-1 truncate text-[12.5px]">
                    {it.label}
                  </span>
                  {it.hint && (
                    <span className="font-mono text-[10.5px] text-[var(--text-muted)] tabular-nums">
                      {it.hint}
                    </span>
                  )}
                  {active && (
                    <CornerDownLeft
                      className="size-3 text-[var(--text-muted)]"
                      strokeWidth={1.75}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
