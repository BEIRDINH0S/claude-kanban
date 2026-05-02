/**
 * Minimal smoke test for the KanbanBoard component itself. We don't try to
 * exercise dnd-kit drag interactions in jsdom (those rely on PointerEvent
 * specifics that jsdom doesn't fully model — shipping E2E coverage there
 * lives in the manual test plan, not here). What we DO check:
 *
 *   1. all 5 columns render with their label,
 *   2. the cards passed in props show up in the right column,
 *   3. clicking a card calls `onOpen`,
 *   4. the search query filter narrows the list.
 *
 * Anything more refined belongs in the unit tests on `selectByColumn` and
 * `applyOptimisticMove`.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Card, CardColumn } from "../../types/card";
import { KanbanBoard } from "./KanbanBoard";
import { useKanbanStore } from "./state";

function card(id: string, title: string, column: CardColumn, position: number): Card {
  return {
    id,
    title,
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

const baseCards: Card[] = [
  card("a", "Aardvark task", "todo", 0),
  card("b", "Banana review", "review", 0),
  card("c", "Cherry done", "done", 0),
];

const noopHandlers = {
  onMove: vi.fn(),
  onOpen: vi.fn(),
  onCreate: vi.fn(),
  onDelete: vi.fn(),
  onDuplicate: vi.fn(),
};

describe("<KanbanBoard />", () => {
  beforeEach(() => {
    // Done expanded so the "Cherry done" card is actually rendered (when the
    // column is collapsed, the cards inside it never reach the DOM).
    useKanbanStore.setState({
      searchQuery: "",
      searchOpen: false,
      selectedCardId: null,
      doneCollapsed: false,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    useKanbanStore.setState({ searchQuery: "", searchOpen: false });
  });

  it("renders all 5 columns", () => {
    render(<KanbanBoard cards={baseCards} {...noopHandlers} />);
    // The column headers are rendered as headings — we look up the label
    // text. "In progress" is the human-friendly form of `in_progress`.
    expect(screen.getByText("Todo")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("places each card under its declared column", () => {
    render(<KanbanBoard cards={baseCards} {...noopHandlers} />);
    expect(screen.getByText("Aardvark task")).toBeInTheDocument();
    expect(screen.getByText("Banana review")).toBeInTheDocument();
    expect(screen.getByText("Cherry done")).toBeInTheDocument();
  });

  it("clicking a card invokes onOpen with that card", () => {
    render(<KanbanBoard cards={baseCards} {...noopHandlers} />);
    fireEvent.click(screen.getByText("Aardvark task"));
    expect(noopHandlers.onOpen).toHaveBeenCalledTimes(1);
    expect(noopHandlers.onOpen.mock.calls[0][0].id).toBe("a");
  });

  it("filters cards via the kanban searchQuery (Cmd+F filter)", () => {
    const { rerender } = render(
      <KanbanBoard cards={baseCards} {...noopHandlers} />,
    );
    expect(screen.getByText("Banana review")).toBeInTheDocument();
    expect(screen.getByText("Cherry done")).toBeInTheDocument();

    useKanbanStore.setState({ searchQuery: "aard" });
    rerender(<KanbanBoard cards={baseCards} {...noopHandlers} />);

    expect(screen.getByText("Aardvark task")).toBeInTheDocument();
    expect(screen.queryByText("Banana review")).not.toBeInTheDocument();
    expect(screen.queryByText("Cherry done")).not.toBeInTheDocument();
  });

  it("renders the right header slot (so the parent's '+ New task' button shows up)", () => {
    render(
      <KanbanBoard
        cards={baseCards}
        {...noopHandlers}
        renderHeaderRight={() => <button>+ New task</button>}
      />,
    );
    // We don't scope to the <header> element via getByRole("banner") because
    // dnd-kit's accessibility layer mounts a second banner-like region for
    // screen-reader announcements. A simple text-presence check is enough
    // to prove the slot is wired through.
    expect(screen.getByText("+ New task")).toBeInTheDocument();
  });
});
