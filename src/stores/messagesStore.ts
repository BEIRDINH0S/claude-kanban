import { create } from "zustand";

import { asBlocks } from "../features/session/format";
import type { DisplayItem, SdkEvent } from "../types/chat";

export interface PreviewLine {
  author: "user" | "claude";
  text: string;
}

interface MessagesState {
  byCard: Record<string, DisplayItem[]>;
  appendUserInput: (cardId: string, text: string) => void;
  appendSdkEvent: (cardId: string, event: SdkEvent) => void;
  /** Replace the entire transcript for a card — used when hydrating history
   *  from disk on resume. */
  replaceForCard: (cardId: string, events: SdkEvent[]) => void;
  clear: (cardId: string) => void;
}

let counter = 0;
const nextId = () => `${Date.now()}-${counter++}`;

export const useMessagesStore = create<MessagesState>((set) => ({
  byCard: {},

  appendUserInput: (cardId, text) =>
    set((s) => {
      const existing = s.byCard[cardId] ?? [];
      return {
        byCard: {
          ...s.byCard,
          [cardId]: [
            ...existing,
            { id: nextId(), kind: "user-input", text, ts: Date.now() },
          ],
        },
      };
    }),

  appendSdkEvent: (cardId, event) =>
    set((s) => {
      const existing = s.byCard[cardId] ?? [];
      return {
        byCard: {
          ...s.byCard,
          [cardId]: [
            ...existing,
            { id: nextId(), kind: "sdk", event, ts: Date.now() },
          ],
        },
      };
    }),

  replaceForCard: (cardId, events) =>
    set((s) => {
      const items: DisplayItem[] = events.map((event, i) => ({
        id: `hist-${cardId}-${i}`,
        kind: "sdk",
        event,
        ts: 0,
      }));
      return { byCard: { ...s.byCard, [cardId]: items } };
    }),

  clear: (cardId) =>
    set((s) => {
      const next = { ...s.byCard };
      delete next[cardId];
      return { byCard: next };
    }),
}));

/**
 * Derive the last `n` user/assistant text lines for the card preview on the
 * board. tool_use chips, tool_results and SDK system/status/result events are
 * filtered out — we only want what a human would call "messages".
 *
 * Returns `null` when nothing renderable yet, so the caller can fall back to
 * a placeholder preview without an empty mono block.
 */
export function selectLatestPreview(
  items: DisplayItem[] | undefined,
  n: number,
): PreviewLine[] | null {
  if (!items || items.length === 0) return null;
  const lines: PreviewLine[] = [];
  // Walk from newest backward to collect at most `n` lines.
  for (let i = items.length - 1; i >= 0 && lines.length < n; i--) {
    const it = items[i];
    if (it.kind === "user-input") {
      lines.unshift({ author: "user", text: it.text });
      continue;
    }
    const event = it.event;
    if (event.type === "assistant") {
      const text = asBlocks(event.message?.content)
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n")
        .trim();
      if (text) lines.unshift({ author: "claude", text });
    } else if (event.type === "user") {
      const text = asBlocks(event.message?.content)
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n")
        .trim();
      if (text) lines.unshift({ author: "user", text });
    }
    // Other event types (system, result, tool_*, hook_*) are skipped.
  }
  return lines.length > 0 ? lines : null;
}
