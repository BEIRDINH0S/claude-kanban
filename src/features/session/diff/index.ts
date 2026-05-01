/**
 * Diff sub-feature. Owns the worktree git-diff tab inside the zoom view.
 * The component is self-contained — fetches `git diff` via IPC, manages its
 * own base-ref override, and renders coloured pre-formatted output.
 */
export { DiffView as DiffTab } from "./DiffView";
