/**
 * Command palette — search, arrow nav, Enter to run + close. We test from
 * the user's perspective: open the palette, type, see filtered results,
 * press Enter, the action fires and the palette closes.
 *
 * The filter logic (multi-token AND-match) is the most regression-prone
 * part — a future "let's simplify with includes(query)" would silently
 * break "two-word" searches like `proj alpha`.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCardsStore } from "../../stores/cardsStore";
import { useProjectsStore } from "../../stores/projectsStore";
import { useThemeStore } from "../../stores/themeStore";
import { useUiStore } from "../../stores/uiStore";
import { CommandPalette } from "./CommandPalette";

describe("<CommandPalette />", () => {
  beforeEach(() => {
    useUiStore.setState({
      paletteOpen: true,
      // Fake setters that record the call so we can assert.
      setPaletteOpen: vi.fn(),
      setView: vi.fn(),
      setActiveProjectId: vi.fn(),
      openZoom: vi.fn(),
    } as unknown as never);
    useProjectsStore.setState({
      projects: [
        {
          id: "alpha",
          name: "Alpha Project",
          createdAt: 0,
          updatedAt: 0,
          archived: false,
          position: 0,
        },
        {
          id: "beta",
          name: "Beta",
          createdAt: 0,
          updatedAt: 0,
          archived: true,
          position: 1,
        },
      ],
    });
    useCardsStore.setState({
      cards: [
        {
          id: "c1",
          title: "Refactor router",
          column: "todo",
          position: 0,
          sessionId: null,
          projectPath: "/repo",
          projectId: "alpha",
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
        },
      ],
    });
    useThemeStore.setState({
      theme: "dark",
      toggleTheme: vi.fn(),
    } as unknown as never);
  });

  afterEach(() => {
    useUiStore.setState({ paletteOpen: false });
  });

  it("renders the static actions + projects + cards on open", () => {
    render(<CommandPalette />);
    expect(screen.getByText("New task")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Refactor router")).toBeInTheDocument();
  });

  it("returns null when paletteOpen is false", () => {
    useUiStore.setState({ paletteOpen: false } as unknown as never);
    const { container } = render(<CommandPalette />);
    expect(container).toBeEmptyDOMElement();
  });

  it("filters via multi-token AND-match (each whitespace-separated piece must hit)", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(/Search/);
    await user.type(input, "alpha proj");
    // "Alpha Project" has both tokens → still visible.
    expect(screen.getByText("Alpha Project")).toBeInTheDocument();
    // "Beta" has neither → filtered out.
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("Enter runs the selected item and closes the palette", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(/Search/);
    // Type to narrow the list to the Settings action so cursor=0 means it.
    await user.type(input, "settings");
    await user.keyboard("{Enter}");
    expect(useUiStore.getState().setView).toHaveBeenCalledWith("settings");
    expect(useUiStore.getState().setPaletteOpen).toHaveBeenCalledWith(false);
  });

  it("Escape closes without running anything", () => {
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(/Search/);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useUiStore.getState().setPaletteOpen).toHaveBeenCalledWith(false);
    expect(useUiStore.getState().setView).not.toHaveBeenCalled();
  });

  it("Empty filter shows the 'No matches.' empty state", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(/Search/);
    await user.type(input, "zzzzz-nope");
    expect(screen.getByText(/No matches/)).toBeInTheDocument();
  });
});
