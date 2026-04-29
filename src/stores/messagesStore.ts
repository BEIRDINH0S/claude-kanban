import { create } from "zustand";

import { asBlocks } from "../features/session/format";
import type { DisplayItem, SdkEvent } from "../types/chat";

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

export interface ToolUseSummary {
  name: string;
  input: unknown;
}

/** Most recent assistant tool_use block in the transcript, if any. */
export function findLatestToolUse(
  items: DisplayItem[] | undefined,
): ToolUseSummary | null {
  if (!items) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== "sdk" || it.event.type !== "assistant") continue;
    const blocks = asBlocks(it.event.message?.content);
    const tu = blocks.find((b) => b.type === "tool_use");
    if (tu) {
      const t = tu as { name: string; input: unknown };
      return { name: t.name, input: t.input };
    }
  }
  return null;
}

/** Most recent assistant text block (joined), if any. */
export function findLatestAssistantText(
  items: DisplayItem[] | undefined,
): string | null {
  if (!items) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== "sdk" || it.event.type !== "assistant") continue;
    const blocks = asBlocks(it.event.message?.content);
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return null;
}
