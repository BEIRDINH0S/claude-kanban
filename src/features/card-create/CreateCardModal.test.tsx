/**
 * CreateCardModal — single-component feature. Coverage focuses on the small
 * but high-value invariants:
 *
 *   - Submit gating (title required, folder required, active project required)
 *   - Folder picker → state update
 *   - Worktree default off + pref hydration to on
 *   - Esc / backdrop close
 *   - Submit calls cardsStore.create with the right args, then closes
 *   - Submit error stays inline and re-enables the button
 */
import { open } from "@tauri-apps/plugin-dialog";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { useCardsStore } from "../../stores/cardsStore";
import { useUiStore } from "../../stores/uiStore";
import { CreateCardModal } from "./CreateCardModal";

// Stub the prefs IPC — getPref returns null by default ("no pref set").
// Individual tests override per-call to test the hydration branch.
vi.mock("../../ipc/prefs", () => ({
  getPref: vi.fn(async () => null),
  setPref: vi.fn(async () => {}),
  PREF_DEFAULT_WORKTREE: "default_create_worktree",
}));

// Local handle on the mocked getPref so tests can `mockResolvedValueOnce`.
import { getPref } from "../../ipc/prefs";
const mockedGetPref = vi.mocked(getPref);

describe("<CreateCardModal />", () => {
  // Mock<TFunc> typing keeps both: the function-call shape (so `onClose`
  // satisfies `() => void` props) AND the .mockRejectedValueOnce helpers.
  // ReturnType<typeof vi.fn> would lose the former.
  let create: Mock<
    (
      title: string,
      projectPath: string,
      projectId: string,
      useWorktree?: boolean,
    ) => Promise<{ id: string }>
  >;
  let onClose: Mock<() => void>;

  beforeEach(() => {
    create = vi.fn(async () => ({ id: "new" }));
    onClose = vi.fn();
    // Inject our mocks into the actual stores. The component reads
    // `cardsStore.create` and `uiStore.activeProjectId` via selectors, so
    // setting state here is enough.
    useCardsStore.setState({ create: create as unknown as never });
    useUiStore.setState({ activeProjectId: "project-1" });
    mockedGetPref.mockResolvedValue(null);
  });

  afterEach(() => {
    useUiStore.setState({ activeProjectId: null });
  });

  it("Create is disabled until title + folder are both set", async () => {
    const user = userEvent.setup();
    render(<CreateCardModal onClose={onClose} />);
    const submit = screen.getByRole("button", { name: /create/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/short label/i), "My task");
    expect(submit).toBeDisabled(); // still no folder

    vi.mocked(open).mockResolvedValueOnce("/Users/me/repo");
    await user.click(screen.getByText(/Pick a folder/i));
    await waitFor(() => {
      expect(screen.getByText("/Users/me/repo")).toBeInTheDocument();
    });
    expect(submit).toBeEnabled();
  });

  it("Create stays disabled when no project is active (board not bound yet)", async () => {
    useUiStore.setState({ activeProjectId: null });
    const user = userEvent.setup();
    render(<CreateCardModal onClose={onClose} />);
    await user.type(screen.getByPlaceholderText(/short label/i), "Task");
    vi.mocked(open).mockResolvedValueOnce("/tmp/x");
    await user.click(screen.getByText(/Pick a folder/i));
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });

  it("submit calls cardsStore.create with trimmed args and closes the modal", async () => {
    const user = userEvent.setup();
    render(<CreateCardModal onClose={onClose} />);
    await user.type(screen.getByPlaceholderText(/short label/i), "  Hello  ");
    vi.mocked(open).mockResolvedValueOnce("/tmp/repo");
    await user.click(screen.getByText(/Pick a folder/i));
    await waitFor(() => {
      expect(screen.getByText("/tmp/repo")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /create/i }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      "Hello",
      "/tmp/repo",
      "project-1",
      false,
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("worktree checkbox forwards true to create when ticked", async () => {
    const user = userEvent.setup();
    render(<CreateCardModal onClose={onClose} />);
    await user.type(screen.getByPlaceholderText(/short label/i), "T");
    vi.mocked(open).mockResolvedValueOnce("/tmp/r");
    await user.click(screen.getByText(/Pick a folder/i));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /create/i }));
    expect(create).toHaveBeenCalledWith("T", "/tmp/r", "project-1", true);
  });

  it("hydrates the worktree checkbox to ON when the pref is '1'", async () => {
    mockedGetPref.mockResolvedValueOnce("1");
    render(<CreateCardModal onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByRole("checkbox")).toBeChecked();
    });
  });

  it("leaves the worktree checkbox OFF when the pref is missing or '0'", async () => {
    mockedGetPref.mockResolvedValueOnce(null);
    render(<CreateCardModal onClose={onClose} />);
    // Wait one microtask so the async pref load has a chance to land.
    await waitFor(() => {
      expect(screen.getByRole("checkbox")).not.toBeChecked();
    });
  });

  it("Esc closes the modal", () => {
    render(<CreateCardModal onClose={onClose} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop closes; clicking the form does not", () => {
    const { container } = render(<CreateCardModal onClose={onClose} />);
    // The form has a fixed inset backdrop wrapper. Clicking the wrapper
    // (event.target === currentTarget) closes; clicking inside the form
    // bubbles up but target !== currentTarget so it doesn't.
    const backdrop = container.querySelector(".fixed.inset-0") as HTMLElement;
    expect(backdrop).toBeInTheDocument();
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);

    const form = container.querySelector("form") as HTMLElement;
    fireEvent.mouseDown(form);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("create() failure surfaces inline and re-enables the Create button", async () => {
    create.mockRejectedValueOnce(new Error("boom"));
    const user = userEvent.setup();
    render(<CreateCardModal onClose={onClose} />);
    await user.type(screen.getByPlaceholderText(/short label/i), "T");
    vi.mocked(open).mockResolvedValueOnce("/tmp/r");
    await user.click(screen.getByText(/Pick a folder/i));
    await user.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByText(/boom/)).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /create/i })).toBeEnabled();
  });
});
