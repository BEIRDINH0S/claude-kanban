/**
 * Column registry — frozen lifecycle order. The board renders columns in
 * COLUMNS order, sessions auto-transition between them, and isColumnId is
 * the type guard at the dnd-kit boundary. A regression here = wrong columns
 * on the board, or a drop landing in nowhere.
 */
import { describe, expect, it } from "vitest";

import type { CardColumn } from "../../types/card";
import { COLUMNS, isColumnId } from "./columns";

describe("kanban columns", () => {
  it("ships exactly the 5 lifecycle columns in display order", () => {
    expect(COLUMNS.map((c) => c.id)).toEqual([
      "todo",
      "in_progress",
      "review",
      "idle",
      "done",
    ]);
  });

  it("each column has a label and a dot class — the renderer needs both", () => {
    for (const c of COLUMNS) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.dotClass.length).toBeGreaterThan(0);
    }
  });

  it("column ids are unique (a duplicate would silently break drag-and-drop)", () => {
    const ids = COLUMNS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("isColumnId accepts every CardColumn value", () => {
    const all: CardColumn[] = ["todo", "in_progress", "review", "idle", "done"];
    for (const id of all) expect(isColumnId(id)).toBe(true);
  });

  it("isColumnId rejects bogus strings (drop targets must be guarded)", () => {
    expect(isColumnId("done ")).toBe(false);
    expect(isColumnId("DONE")).toBe(false);
    expect(isColumnId("archived")).toBe(false);
    expect(isColumnId("")).toBe(false);
  });
});
