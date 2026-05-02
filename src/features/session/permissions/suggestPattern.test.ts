/**
 * `suggestPattern` — the auto-approve rule the "Always allow" button proposes.
 *
 * Critical security invariant: for Bash, the suggested pattern MUST scope to
 * the first command word, not the whole tool. A bare `Bash` rule would
 * whitelist `rm -rf /`. The test pins this so a future refactor that
 * "simplifies" the function gets a red light.
 */
import { describe, expect, it } from "vitest";

import { suggestPattern } from "./usePermissionActions";

describe("suggestPattern", () => {
  it("Bash → scoped to the first command word, NEVER bare 'Bash'", () => {
    expect(suggestPattern("Bash", { command: "npm install" })).toBe(
      "Bash(npm *)",
    );
    expect(suggestPattern("Bash", { command: "git status" })).toBe(
      "Bash(git *)",
    );
  });

  it("Bash with empty command falls back to bare tool name (no false-positive *)", () => {
    expect(suggestPattern("Bash", { command: "" })).toBe("Bash");
    expect(suggestPattern("Bash", {})).toBe("Bash");
  });

  it("non-Bash tools use the bare tool name", () => {
    expect(suggestPattern("Read", { file_path: "/a/b" })).toBe("Read");
    expect(suggestPattern("Edit", {})).toBe("Edit");
    expect(suggestPattern("Glob", { pattern: "**/*.ts" })).toBe("Glob");
  });

  it("doesn't crash on null / undefined input", () => {
    expect(suggestPattern("Read", null)).toBe("Read");
    expect(suggestPattern("Read", undefined)).toBe("Read");
  });
});
