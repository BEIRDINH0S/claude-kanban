/**
 * Embeddable session panel — header + tab bar + tab body. The orchestrator
 * for the session feature: composes the sub-features (header, chat, diff,
 * config, permissions) into the surface that fills the swarm view's right
 * pane.
 *
 * Lives at the feature root (alongside `format.ts` / `markdownExport.ts`)
 * because it composes several sub-features and would violate isolation if
 * placed inside any one of them.
 *
 *   SwarmView.renderDetail
 *      └── SessionPanel (header + tabs + body)         ← this file
 *             ├── ZoomHeader (sub-feature: header)
 *             ├── ChatTab    (sub-feature: chat) + permissionSlot
 *             ├── DiffTab    (sub-feature: diff)
 *             └── ConfigTab  (sub-feature: config)
 *
 * The ChatTab's permission slot is filled here with `<PermissionPanel />`
 * — it's a sub-feature → sub-feature bridge that has to live in the
 * orchestrator. The `onClose` prop is vestigial from the pre-Phase-2 modal
 * wrapper (`ZoomView`) and currently unused; kept on the type so a future
 * "expand to fullscreen" affordance can wire it without a public-API change.
 */
import { useState } from "react";

import type { Card } from "../../types/card";
import { ChatTab } from "./chat";
import { ConfigTab } from "./config";
import { DiffTab } from "./diff";
import { ZoomHeader } from "./header";
import { PermissionPanel } from "./permissions";

interface Props {
  card: Card;
  /** Forwarded to the header — when set, a X button appears on the far
   *  right of the toolbar. Currently unused (the panel is always inline);
   *  kept on the type as the future hook for an "expand to fullscreen"
   *  affordance. */
  onClose?: () => void;
}

export function SessionPanel({ card, onClose }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ZoomHeader card={card} onClose={onClose} />
      <Body card={card} />
    </div>
  );
}

type SessionTab = "chat" | "diff" | "config";

function Body({ card }: { card: Card }) {
  // Tab switcher between the chat transcript, the worktree diff, and the
  // per-card session config. Diff is hidden entirely for cards without a
  // worktree (nothing to show). Config is always visible. Default = chat.
  const [tab, setTab] = useState<SessionTab>("chat");
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
  value: SessionTab;
  onChange: (v: SessionTab) => void;
  showDiff: boolean;
  configBadge: boolean;
}) {
  const tabs: { id: SessionTab; label: string; badge?: boolean }[] = [
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
