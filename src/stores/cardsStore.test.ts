/**
 * `applyOptimisticMove` — same algorithm as the Rust position renumberer.
 * The CLAUDE.md anti-patterns explicitly call out this function: "do NOT
 * skip the close-hole / open-hole pass on intra-column moves. Tempting but
 * it breaks adjacent positions." These tests pin the contract so the next
 * person who tries to "simplify" it gets a red light immediately.
 *
 * Conventions: the array result is returned in arbitrary order — callers
 * sort by position when rendering. Tests therefore always re-group by
 * column and sort by position before asserting.
 */
import { describe, expect, it } from "vitest";

import type { Card, CardColumn } from "../types/card";
import { applyOptimisticMove } from "./cardsStore";

function card(id: string, column: CardColumn, position: number): Card {
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

/** Re-group by column and sort by position — exercises the renumberer the
 *  same way a UI would when reading the store after a move. */
function layout(cards: Card[]): Record<CardColumn, string[]> {
  const out: Record<CardColumn, string[]> = {
    todo: [],
    in_progress: [],
    review: [],
    idle: [],
    done: [],
  };
  for (const c of [...cards].sort((a, b) => a.position - b.position)) {
    out[c.column].push(c.id);
  }
  return out;
}

describe("applyOptimisticMove", () => {
  it("returns the input unchanged when the moved id doesn't exist", () => {
    const before = [card("a", "todo", 0), card("b", "todo", 1)];
    const after = applyOptimisticMove(before, "ghost", "done", 0);
    expect(after).toBe(before);
  });

  it("intra-column move forward: re-numbers positions densely (0..n-1)", () => {
    // [a, b, c, d] in todo → move a from 0 to 2 → [b, c, a, d]
    const before = [
      card("a", "todo", 0),
      card("b", "todo", 1),
      card("c", "todo", 2),
      card("d", "todo", 3),
    ];
    const after = applyOptimisticMove(before, "a", "todo", 2);
    expect(layout(after).todo).toEqual(["b", "c", "a", "d"]);
    // Positions must be 0..3 with no holes — Rust enforces this server-side
    // and we mirror it locally so the optimistic preview matches.
    const positions = after
      .filter((c) => c.column === "todo")
      .map((c) => c.position)
      .sort((x, y) => x - y);
    expect(positions).toEqual([0, 1, 2, 3]);
  });

  it("intra-column move backward: re-numbers positions densely", () => {
    const before = [
      card("a", "todo", 0),
      card("b", "todo", 1),
      card("c", "todo", 2),
      card("d", "todo", 3),
    ];
    const after = applyOptimisticMove(before, "d", "todo", 1);
    expect(layout(after).todo).toEqual(["a", "d", "b", "c"]);
  });

  it("cross-column move: source closes its hole, target opens at insert index", () => {
    // todo: [a, b, c]   in_progress: [x, y]
    // move b → in_progress at index 1
    // expected: todo: [a, c]   in_progress: [x, b, y]
    const before = [
      card("a", "todo", 0),
      card("b", "todo", 1),
      card("c", "todo", 2),
      card("x", "in_progress", 0),
      card("y", "in_progress", 1),
    ];
    const after = applyOptimisticMove(before, "b", "in_progress", 1);
    const seen = layout(after);
    expect(seen.todo).toEqual(["a", "c"]);
    expect(seen.in_progress).toEqual(["x", "b", "y"]);
  });

  it("cross-column move into an empty column lands at position 0", () => {
    const before = [card("a", "todo", 0), card("b", "todo", 1)];
    const after = applyOptimisticMove(before, "a", "done", 0);
    const seen = layout(after);
    expect(seen.todo).toEqual(["b"]);
    expect(seen.done).toEqual(["a"]);
    expect(after.find((c) => c.id === "a")?.position).toBe(0);
  });

  it("clamps targetIndex larger than column length to append", () => {
    const before = [
      card("a", "todo", 0),
      card("b", "todo", 1),
      card("x", "in_progress", 0),
    ];
    const after = applyOptimisticMove(before, "a", "in_progress", 99);
    expect(layout(after).in_progress).toEqual(["x", "a"]);
  });

  it("clamps negative targetIndex to 0 (drop above first card)", () => {
    const before = [
      card("a", "todo", 0),
      card("b", "todo", 1),
      card("x", "in_progress", 0),
    ];
    const after = applyOptimisticMove(before, "a", "in_progress", -5);
    expect(layout(after).in_progress).toEqual(["a", "x"]);
  });

  it("source column ends up dense after a cross-column extraction", () => {
    // Pulling out the middle card must close the hole — otherwise the next
    // optimistic move uses stale positions and reorders the wrong neighbours.
    const before = [
      card("a", "todo", 0),
      card("b", "todo", 1),
      card("c", "todo", 2),
      card("d", "todo", 3),
    ];
    const after = applyOptimisticMove(before, "b", "done", 0);
    const todoPositions = after
      .filter((c) => c.column === "todo")
      .map((c) => c.position)
      .sort((x, y) => x - y);
    expect(todoPositions).toEqual([0, 1, 2]);
    expect(layout(after).todo).toEqual(["a", "c", "d"]);
  });
});
