/**
 * EditableTitle — small but tricky state machine: idle ↔ editing, commit on
 * Enter / blur, cancel on Escape, no commit when value unchanged or empty.
 * A regression here = silent renames, lost edits, or stuck-in-edit cards.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EditableTitle } from "./EditableTitle";

describe("<EditableTitle />", () => {
  it("renders the value as a heading and ignores single-click", () => {
    const onCommit = vi.fn();
    render(<EditableTitle value="Hello" disabled={false} onCommit={onCommit} />);
    const heading = screen.getByRole("heading", { name: "Hello" });
    fireEvent.click(heading);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("double-clicking flips into edit mode (when not disabled)", async () => {
    const onCommit = vi.fn();
    render(<EditableTitle value="Hello" disabled={false} onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByRole("heading"));
    expect(screen.getByRole("textbox")).toHaveValue("Hello");
  });

  it("disabled cards don't enter edit mode on double-click", () => {
    const onCommit = vi.fn();
    render(<EditableTitle value="Hello" disabled={true} onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByRole("heading"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Enter commits the trimmed new value and exits edit mode", async () => {
    const onCommit = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<EditableTitle value="Old" disabled={false} onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByRole("heading"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "  New  {Enter}");
    expect(onCommit).toHaveBeenCalledWith("New");
  });

  it("Escape cancels — no commit, edit mode exits", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<EditableTitle value="Old" disabled={false} onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByRole("heading"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "New");
    await user.keyboard("{Escape}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("doesn't commit when the value is unchanged after trim", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<EditableTitle value="Same" disabled={false} onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByRole("heading"));
    const input = screen.getByRole("textbox");
    await user.type(input, "{Enter}");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("doesn't commit an empty value (would visually erase the title)", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<EditableTitle value="Old" disabled={false} onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByRole("heading"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.keyboard("{Enter}");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
