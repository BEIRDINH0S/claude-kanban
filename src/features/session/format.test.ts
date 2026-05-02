/**
 * `formatToolUse` — one-line summary of a tool_use block. Used in the chat
 * MessageList, the PermissionPanel, and the markdown export. Each tool has
 * a recognised shape with a free-form fallback for unknown ones.
 */
import { describe, expect, it } from "vitest";

import { formatToolUse } from "./format";

describe("formatToolUse", () => {
  it("renders Read / Write / Edit with the file_path", () => {
    expect(formatToolUse("Read", { file_path: "/a/b.ts" })).toBe(
      "Read /a/b.ts",
    );
    expect(formatToolUse("Write", { file_path: "/a/b.ts" })).toBe(
      "Write /a/b.ts",
    );
    expect(formatToolUse("Edit", { file_path: "/a/b.ts" })).toBe(
      "Edit /a/b.ts",
    );
  });

  it("renders Bash with the command separator", () => {
    expect(formatToolUse("Bash", { command: "ls -la" })).toBe("Bash › ls -la");
  });

  it("renders Glob / Grep with their patterns", () => {
    expect(formatToolUse("Glob", { pattern: "**/*.ts" })).toBe("Glob **/*.ts");
    expect(formatToolUse("Grep", { pattern: "TODO" })).toBe('Grep "TODO"');
  });

  it("renders Task with subagent + description", () => {
    expect(
      formatToolUse("Task", {
        subagent_type: "Explore",
        description: "find auth code",
      }),
    ).toBe("Task › Explore — find auth code");
  });

  it("renders TodoWrite with item count", () => {
    expect(
      formatToolUse("TodoWrite", { todos: [{ id: 1 }, { id: 2 }] }),
    ).toBe("TodoWrite (2 items)");
    expect(formatToolUse("TodoWrite", {})).toBe("TodoWrite (? items)");
  });

  it("renders WebFetch / WebSearch", () => {
    expect(formatToolUse("WebFetch", { url: "https://x" })).toBe(
      "WebFetch https://x",
    );
    expect(formatToolUse("WebSearch", { query: "tauri sqlite" })).toBe(
      'WebSearch "tauri sqlite"',
    );
  });

  it("falls back to JSON for unknown tools", () => {
    expect(formatToolUse("MysteryTool", { foo: 1 })).toBe(
      'MysteryTool {"foo":1}',
    );
  });

  it("doesn't crash on null / undefined input — returns the bare name with empty payload", () => {
    expect(formatToolUse("Custom", null)).toBe("Custom {}");
    expect(formatToolUse("Custom", undefined)).toBe("Custom {}");
  });

  it("truncates very long strings with an ellipsis", () => {
    const longCmd = "a".repeat(200);
    const out = formatToolUse("Bash", { command: longCmd });
    // 100 chars cap (the constant in the source) — last char becomes "…".
    expect(out.length).toBeLessThanOrEqual("Bash › ".length + 100);
    expect(out.endsWith("…")).toBe(true);
  });
});
