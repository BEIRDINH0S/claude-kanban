/**
 * Kanban-private store — search box, selection cursor, Done collapse. Small
 * piece, but two invariants matter:
 *   - closing the search clears the query (so the user can't end up with a
 *     hidden filter that "loses" their cards on next open),
 *   - toggleDoneCollapsed persists to localStorage (the whole point of the
 *     toggle living in a store rather than just in component state).
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useKanbanStore } from "./state";

const DONE_KEY = "claude-kanban-done-collapsed";

describe("kanban state store", () => {
  beforeEach(() => {
    // Reset to a neutral state for each test. The initial doneCollapsed
    // value is read from localStorage at module load (one-shot), which is
    // out of our reach here — we set it explicitly instead. The setup file's
    // afterEach already clears the localStorage polyfill between tests.
    useKanbanStore.setState({
      searchQuery: "",
      searchOpen: false,
      selectedCardId: null,
      doneCollapsed: true,
    });
  });

  it("setSearchQuery sets the query verbatim", () => {
    useKanbanStore.getState().setSearchQuery("hello");
    expect(useKanbanStore.getState().searchQuery).toBe("hello");
  });

  it("closing the search box clears the query — no hidden filter survives", () => {
    useKanbanStore.setState({ searchOpen: true, searchQuery: "bug" });
    useKanbanStore.getState().setSearchOpen(false);
    const s = useKanbanStore.getState();
    expect(s.searchOpen).toBe(false);
    expect(s.searchQuery).toBe("");
  });

  it("opening the search box keeps the existing query (rarely set, but safe)", () => {
    useKanbanStore.setState({ searchOpen: false, searchQuery: "kept" });
    useKanbanStore.getState().setSearchOpen(true);
    const s = useKanbanStore.getState();
    expect(s.searchOpen).toBe(true);
    expect(s.searchQuery).toBe("kept");
  });

  it("setSelectedCardId persists the cursor (and accepts null)", () => {
    useKanbanStore.getState().setSelectedCardId("card-1");
    expect(useKanbanStore.getState().selectedCardId).toBe("card-1");
    useKanbanStore.getState().setSelectedCardId(null);
    expect(useKanbanStore.getState().selectedCardId).toBeNull();
  });

  it("toggleDoneCollapsed flips the boolean and writes to localStorage", () => {
    useKanbanStore.setState({ doneCollapsed: true });
    useKanbanStore.getState().toggleDoneCollapsed();
    expect(useKanbanStore.getState().doneCollapsed).toBe(false);
    expect(localStorage.getItem(DONE_KEY)).toBe("0");
    useKanbanStore.getState().toggleDoneCollapsed();
    expect(useKanbanStore.getState().doneCollapsed).toBe(true);
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
  });
});
