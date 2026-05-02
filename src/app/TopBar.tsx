/**
 * App-shell top bar — replaces the previous left sidebar entirely.
 *
 * Owns three things and three things only:
 *   1. The window-drag region (so the user can grab any empty area to move
 *      the window) — required because we make the macOS title bar overlay
 *      onto our content via `tauri.conf.json::titleBarStyle = "Overlay"`.
 *   2. The theme toggle — sun/moon icon, click = flip.
 *   3. The Settings + Account cluster on the right.
 *
 * Layout convention:
 *   - macOS leaves a ~78px gutter on the left for the traffic-light buttons
 *     (red/yellow/green). We pad accordingly with `pl-[80px]` on darwin.
 *   - The whole bar is a drag region by default (`data-tauri-drag-region`);
 *     interactive children opt out automatically because clicks land on
 *     them, not on the background.
 *
 * What this file does NOT own:
 *   - The actual page content (lives in the central pane).
 *   - The login flow (the account dropdown only displays state + sign out).
 *
 * Pre-Phase-2 there was a Swarm/Board segmented toggle in the centre;
 * removed when Board (legacy kanban) was deleted — Swarm is the only
 * card-display view now.
 */
import { LogOut, Moon, Settings, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { logoutFromClaude } from "../ipc/auth";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore } from "../stores/themeStore";
import { useTutorialAnchor } from "../stores/tutorialStore";
import { useUiStore } from "../stores/uiStore";

/** macOS reserves the top-left for the traffic-light buttons. We need to
 *  push our content past them when the title bar is in overlay mode. */
const IS_MAC =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
const LEFT_GUTTER = IS_MAC ? "pl-[80px]" : "pl-3";

export function TopBar() {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const settingsAnchor = useTutorialAnchor("topbar.settings");

  // The bar itself is the drag region. Buttons inside don't need to opt out
  // — Tauri only honours `data-tauri-drag-region` on the actual click
  // target, so any button click is interpreted as a button click.
  return (
    <header
      data-tauri-drag-region
      className={[
        "glass-strong z-30 flex h-11 shrink-0 items-center gap-2 border-b border-[var(--glass-stroke)] pr-3",
        LEFT_GUTTER,
      ].join(" ")}
    >
      <span
        data-tauri-drag-region
        className="text-[12px] font-semibold tracking-tight text-[var(--text-primary)] select-none"
      >
        claude-kanban
      </span>
      <div data-tauri-drag-region className="flex-1" />

      <ThemeButton />
      <button
        ref={settingsAnchor}
        type="button"
        onClick={() => setView(view === "settings" ? "swarm" : "settings")}
        aria-pressed={view === "settings"}
        title="Settings"
        aria-label="Settings"
        className={[
          "rounded-md p-1.5 transition-colors",
          view === "settings"
            ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
            : "text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5",
        ].join(" ")}
      >
        <Settings className="size-3.5" strokeWidth={1.75} />
      </button>
      <AccountMenu />
    </header>
  );
}

function ThemeButton() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggleTheme);
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"
    >
      {isDark ? (
        <Moon className="size-3.5" strokeWidth={1.75} />
      ) : (
        <Sun className="size-3.5" strokeWidth={1.75} />
      )}
    </button>
  );
}

/**
 * Account avatar + dropdown. Two visual states:
 *
 *   - logged in   → initials (or a generic glyph) on a coloured chip;
 *                   click opens a dropdown with email, plan, sign-out.
 *   - logged out  → a muted chip; click is a no-op (the AuthGate has
 *                   already replaced the AppShell with the LoginScreen,
 *                   so this state is rarely visible from here in practice).
 *
 * The dropdown closes on any outside click or on Esc. We don't bother with
 * a portal — the menu is anchored inside the top bar and lives high enough
 * in the z-stack to not be clipped.
 */
function AccountMenu() {
  const status = useAuthStore((s) => s.status);
  const details = useAuthStore((s) => s.details);
  const markLoggedOut = useAuthStore((s) => s.markLoggedOut);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSignOut = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await logoutFromClaude();
      markLoggedOut();
      setOpen(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const initials = initialsFor(details?.email);
  const loggedIn = status === "logged-in";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => loggedIn && setOpen((v) => !v)}
        title={details?.email ?? "Not signed in"}
        aria-label="Account"
        aria-expanded={open}
        className={[
          "grid size-7 place-items-center rounded-full border text-[10px] font-semibold transition-colors",
          loggedIn
            ? "border-[var(--color-accent-ring)] bg-[var(--color-accent-soft)] text-[var(--text-primary)] hover:border-[var(--color-accent)]"
            : "border-[var(--glass-stroke)] bg-transparent text-[var(--text-muted)]",
        ].join(" ")}
      >
        {initials}
      </button>
      {open && loggedIn && (
        <div className="glass-strong absolute right-0 top-full z-50 mt-1.5 w-[260px] rounded-xl border border-[var(--glass-stroke)] p-2 shadow-2xl">
          <div className="px-2 py-1.5">
            <p className="truncate text-[11.5px] font-medium text-[var(--text-primary)]">
              {details?.email ?? "Signed in"}
            </p>
            {details?.planName && (
              <p className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">
                Plan{" "}
                <span className="font-medium text-[var(--text-secondary)]">
                  {details.planName}
                </span>
                {details.organizationName &&
                  details.organizationName !== details.email && (
                    <> · {details.organizationName}</>
                  )}
              </p>
            )}
          </div>
          <div className="my-1 h-px bg-[var(--glass-stroke)]" />
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] text-[var(--text-secondary)] hover:bg-black/5 hover:text-red-600 disabled:opacity-50 dark:hover:bg-white/5 dark:hover:text-red-400"
          >
            <LogOut className="size-3.5" strokeWidth={1.75} />
            {busy ? "Signing out…" : "Sign out"}
          </button>
          {err && (
            <p className="mt-1 px-2 font-mono text-[10.5px] text-red-600 dark:text-red-400">
              {err}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** First letter of the local part of the email — gives a stable 1-char
 *  badge ("e" for `erwan@…`) without needing an avatar service. Falls
 *  back to a neutral dot when no email is available. */
function initialsFor(email: string | null | undefined): string {
  if (!email) return "·";
  const local = email.split("@")[0] ?? "";
  return (local[0] ?? email[0] ?? "·").toUpperCase();
}
