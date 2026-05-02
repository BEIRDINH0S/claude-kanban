/**
 * `transcriptToMarkdown` + `defaultMarkdownFilename` — both pure. The
 * markdown export is one of the headers' user-visible actions; if it
 * silently drops messages, users export "empty" sessions.
 */
import { describe, expect, it } from "vitest";

import type { Card } from "../../types/card";
import type { DisplayItem } from "../../types/chat";
import {
  defaultMarkdownFilename,
  transcriptToMarkdown,
} from "./markdownExport";

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "c1",
    title: "My Card",
    column: "in_progress",
    position: 0,
    sessionId: "session-abc",
    projectPath: "/repo",
    projectId: "p1",
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
    ...overrides,
  };
}

describe("defaultMarkdownFilename", () => {
  it("slugifies a title and appends .md", () => {
    expect(defaultMarkdownFilename(card({ title: "Hello World!" }))).toBe(
      "hello-world.md",
    );
  });

  it("falls back to 'session.md' when the slug is empty (special chars only)", () => {
    expect(defaultMarkdownFilename(card({ title: "!!!" }))).toBe("session.md");
  });

  it("clamps very long titles to 60 chars", () => {
    const long = "a".repeat(120);
    const name = defaultMarkdownFilename(card({ title: long }));
    expect(name).toBe(`${"a".repeat(60)}.md`);
  });
});

describe("transcriptToMarkdown", () => {
  it("renders a header with project, session, column", () => {
    const md = transcriptToMarkdown(card(), []);
    expect(md).toContain("# My Card");
    expect(md).toContain("**Project:** `/repo`");
    expect(md).toContain("**Session:** `session-abc`");
    expect(md).toContain("**Column:** in_progress");
  });

  it("emits a 'Turn N · you' block for user-input items", () => {
    const items: DisplayItem[] = [
      { id: "1", kind: "user-input", text: "What's up?", ts: 0 },
    ];
    const md = transcriptToMarkdown(card(), items);
    expect(md).toContain("### Turn 1 · you");
    expect(md).toContain("What's up?");
  });

  it("emits assistant text + tool_use code blocks", () => {
    const items: DisplayItem[] = [
      {
        id: "1",
        kind: "sdk",
        ts: 0,
        event: {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Reading the file." },
              {
                type: "tool_use",
                id: "tu1",
                name: "Read",
                input: { file_path: "/a/b.ts" },
              },
            ],
          },
        },
      },
    ];
    const md = transcriptToMarkdown(card(), items);
    expect(md).toContain("### Turn 1 · claude");
    expect(md).toContain("Reading the file.");
    expect(md).toContain("```\nRead /a/b.ts\n```");
  });

  it("increments turn numbering on each result event", () => {
    const items: DisplayItem[] = [
      { id: "1", kind: "user-input", text: "first", ts: 0 },
      {
        id: "2",
        kind: "sdk",
        ts: 0,
        event: { type: "result", total_cost_usd: 0.012, num_turns: 3 },
      },
      { id: "3", kind: "user-input", text: "second", ts: 0 },
    ];
    const md = transcriptToMarkdown(card(), items);
    expect(md).toContain("### Turn 1 · you");
    expect(md).toContain("_Turn 1 ended — $0.0120 · 3 messages_");
    expect(md).toContain("### Turn 2 · you");
  });

  it("blockquotes tool_result content from user events", () => {
    const items: DisplayItem[] = [
      {
        id: "1",
        kind: "sdk",
        ts: 0,
        event: {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                content: "stdout from a tool\nsecond line",
              },
            ],
          },
        },
      },
    ];
    const md = transcriptToMarkdown(card(), items);
    expect(md).toContain("> stdout from a tool");
    expect(md).toContain("> second line");
  });
});
