/**
 * `selectByColumn` — the kanban's only public pure helper. The board uses it
 * for rendering, the parent uses it for header counts, and the optimistic
 * move logic in cardsStore uses it implicitly. If positions get out of order
 * here, every card on the board is in the wrong slot.
 */
import { describe, expect, it } from "vitest";

import type { Card } from "../../types/card";
import { selectByColumn } from "./KanbanBoard";

function card(id: string, column: Card["column"], position: number): Card {
  // Minimum-viable Card — only fields that selectByColumn touches matter, the
  // rest are filled with type-correct stubs to keep TS happy.
  return {
    id,
    title: id,
    column,
    position,
    sessionId: null,
    projectPath: "/tmp/p",
    projectId: "p",
    createdAt: 0,
    updatedAt: 0,
    lastState: null,
    tags: "",
    worktreePath: null,
    model: null,
    permissionMode: null,
    systemPromptAppend: null,
    maxTurns: null,
    additionalDirectories: null,
  };
}

describe("selectByColumn", () => {
  it("filters by column and sorts ascending by position", () => {
    const cards = [
      card("a", "todo", 2),
      card("b", "in_progress", 0),
      card("c", "todo", 0),
      card("d", "todo", 1),
    ];
    const result = selectByColumn(cards, "todo");
    expect(result.map((c) => c.id)).toEqual(["c", "d", "a"]);
  });

  it("returns an empty array when no card lives in the column", () => {
    const cards = [card("a", "todo", 0)];
    expect(selectByColumn(cards, "done")).toEqual([]);
  });

  it("doesn't mutate the input array (board re-renders rely on this)", () => {
    const cards = [card("a", "todo", 1), card("b", "todo", 0)];
    const snapshot = cards.map((c) => c.id);
    selectByColumn(cards, "todo");
    expect(cards.map((c) => c.id)).toEqual(snapshot);
  });
});
