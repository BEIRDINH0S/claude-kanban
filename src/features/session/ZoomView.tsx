/**
 * Zoom view orchestrator. Owns three things and three things only:
 *
 *   1. The modal frame + the Esc-to-close handler.
 *   2. The active-tab state (chat / diff / config) + the small badge that
 *      decorates the Config tab when the card has any non-default option.
 *   3. The composition: ZoomHeader + TabBar + the right tab body, with the
 *      cross-sub-feature plumbing (chat tab gets a permission slot we fill
 *      with `<PermissionPanel>`).
 *
 * Each tab body is a self-contained sub-feature that doesn't know about the
 * others. The sub-features that this orchestrator is aware of:
 *   - `header/`        — top bar (always rendered)
 *   - `chat/`          — chat tab; we hand it the permission slot
 *   - `permissions/`   — fills the chat tab's slot
 *   - `diff/`          — diff tab (only when a worktree exists)
 *   - `config/`        — config tab
 *
 * If you add a tab, this is the only file in the session feature you need
 * to touch. Every other sub-feature ignores its existence.
 */
import { useEffect, useState } from "react";

import { useCardsStore } from "../../stores/cardsStore";
import { useUiStore } from "../../stores/uiStore";
import type { Card } from "../../types/card";
import { ChatTab } from "./chat";
import { ConfigTab } from "./config";
import { DiffTab } from "./diff";
import { ZoomHeader } from "./header";
import { PermissionPanel } from "./permissions";

export function ZoomView() {
  const zoomedCardId = useUiStore((s) => s.zoomedCardId);
  const closeZoom = useUiStore((s) => s.closeZoom);
  const card = useCardsStore((s) =>
    s.cards.find((c) => c.id === zoomedCardId),
  );

  // Esc closes; mounted only when open.
  useEffect(() => {
    if (!zoomedCardId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeZoom();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomedCardId, closeZoom]);

  if (!zoomedCardId || !card) return null;

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeZoom();
      }}
    >
      <div className="animate-zoom-in glass-strong flex h-[85vh] w-full max-w-[900px] flex-col overflow-hidden rounded-2xl shadow-2xl">
        <ZoomHeader card={card} onClose={closeZoom} />
        <Body card={card} />
      </div>
    </div>
  );
}

type ZoomTab = "chat" | "diff" | "config";

function Body({ card }: { card: Card }) {
  // Tab switcher between the chat transcript, the worktree diff, and the
  // per-card session config. Diff is hidden entirely for cards without a
  // worktree (nothing to show). Config is always visible. Default = chat.
  const [tab, setTab] = useState<ZoomTab>("chat");
  const showDiffTab = !!card.worktreePath;

  // Surface a small badge next to the tab when the card has any non-default
  // session option set — lets the user spot at a glance that this card has
  // been customised (e.g. plan mode, custom system prompt, …).
  const hasCustomConfig =
    !!card.model ||
    !!card.permissionMode ||
    !!card.systemPromptAppend ||
    card.maxTurns != null ||
    !!card.additionalDirectories;

  return (
    <>
      <TabBar
        value={tab}
        onChange={setTab}
        showDiff={showDiffTab}
        configBadge={hasCustomConfig}
      />
      {tab === "diff" && showDiffTab ? (
        <DiffTab cardId={card.id} />
      ) : tab === "config" ? (
        <ConfigTab card={card} />
      ) : (
        <ChatTab
          card={card}
          permissionSlot={<PermissionPanel cardId={card.id} />}
        />
      )}
    </>
  );
}

/**
 * Slim tab bar above the body. Always shows Chat + Config; the Diff tab
 * is mounted only when the card has a worktree (otherwise there's nothing
 * to render). `configBadge` adds a small accent dot next to the Config
 * label whenever the card has any non-default session option, so the
 * user can spot a customised card at a glance.
 */
function TabBar({
  value,
  onChange,
  showDiff,
  configBadge,
}: {
  value: ZoomTab;
  onChange: (v: ZoomTab) => void;
  showDiff: boolean;
  configBadge: boolean;
}) {
  const tabs: { id: ZoomTab; label: string; badge?: boolean }[] = [
    { id: "chat", label: "Chat" },
    ...(showDiff ? [{ id: "diff" as const, label: "Diff" }] : []),
    { id: "config", label: "Config", badge: configBadge },
  ];
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-[var(--glass-stroke)] px-6 py-1.5">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={[
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              active
                ? "bg-[var(--color-accent-soft)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5",
            ].join(" ")}
          >
            {t.label}
            {t.badge && (
              <span
                aria-hidden
                className="inline-block size-1.5 rounded-full bg-[var(--color-accent)]"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
