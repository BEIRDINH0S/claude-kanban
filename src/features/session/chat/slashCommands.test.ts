/**
 * Slash commands — the only piece of CLI-shaped UX in the chat. The parser
 * MUST recognise aliases, MUST split off the args correctly, and MUST validate
 * before persisting (so a bad `/model foo` doesn't write garbage on the card).
 *
 * We test the parser + filter exhaustively (pure functions) and a handful of
 * commands' run() with mocks to ensure the patch flows through to the card
 * store. We don't try to render the slash menu UI here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCardsStore } from "../../../stores/cardsStore";
import { useMessagesStore } from "../../../stores/messagesStore";
import { useToastsStore } from "../../../stores/toastsStore";
import { useUiStore } from "../../../stores/uiStore";
import type { Card } from "../../../types/card";
import {
  filterSlashCommands,
  parseSlashCommand,
  SLASH_COMMANDS,
} from "./slashCommands";

vi.mock("../../../ipc/sessions", () => ({
  stopSession: vi.fn(async () => {}),
}));
import { stopSession as ipcStopSession } from "../../../ipc/sessions";

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "c1",
    title: "T",
    column: "todo",
    position: 0,
    sessionId: null,
    projectPath: "/p",
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

describe("parseSlashCommand", () => {
  it("matches a bare command", () => {
    const r = parseSlashCommand("/clear");
    expect(r?.command.name).toBe("clear");
    expect(r?.args).toBe("");
  });

  it("matches a command with arguments — keeps multi-word args intact", () => {
    const r = parseSlashCommand("/model claude-sonnet-4-5");
    expect(r?.command.name).toBe("model");
    expect(r?.args).toBe("claude-sonnet-4-5");
  });

  it("recognises aliases (/? → /help)", () => {
    expect(parseSlashCommand("/?")?.command.name).toBe("help");
    expect(parseSlashCommand("/maxTurns 10")?.command.name).toBe("max-turns");
  });

  it("returns null for unknown commands", () => {
    expect(parseSlashCommand("/nope")).toBeNull();
  });

  it("returns null when the text isn't a slash command", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("  ")).toBeNull();
  });

  it("trims leading whitespace before the slash", () => {
    expect(parseSlashCommand("   /clear")?.command.name).toBe("clear");
  });
});

describe("filterSlashCommands", () => {
  it("returns the full registry on empty query", () => {
    expect(filterSlashCommands("").length).toBe(SLASH_COMMANDS.length);
  });

  it("substring-matches by name (case-insensitive)", () => {
    const names = filterSlashCommands("MODE").map((c) => c.name);
    expect(names).toContain("default-mode");
  });

  it("substring-matches by alias", () => {
    const names = filterSlashCommands("maxTurns").map((c) => c.name);
    expect(names).toContain("max-turns");
  });
});

describe("slash commands — run() side effects", () => {
  beforeEach(() => {
    // Wire fakeable stubs into the live stores so commands can interact with
    // them without exploding on missing infra.
    useCardsStore.setState({
      setSessionConfig: vi.fn(async (_id: string, _cfg: unknown) => ({})) as unknown as never,
    });
    useMessagesStore.setState({
      appendSdkEvent: vi.fn(),
      clear: vi.fn(),
    } as unknown as never);
    useToastsStore.setState({ push: vi.fn() } as unknown as never);
    useUiStore.setState({ liveSessionIds: new Set() });
    vi.mocked(ipcStopSession).mockClear();
  });

  it("/model rejects an invalid alias before persisting", async () => {
    const r = parseSlashCommand("/model nope");
    expect(r).not.toBeNull();
    await expect(r!.command.run(r!.args, card())).rejects.toThrow(
      /Invalid model/,
    );
    expect(useCardsStore.getState().setSessionConfig).not.toHaveBeenCalled();
  });

  it("/model accepts sonnet/opus/haiku and the claude- prefix", async () => {
    for (const model of ["sonnet", "opus", "haiku", "claude-sonnet-4-5"]) {
      const r = parseSlashCommand(`/model ${model}`)!;
      await r.command.run(r.args, card());
    }
    expect(useCardsStore.getState().setSessionConfig).toHaveBeenCalledTimes(4);
  });

  it("/model with empty arg resets to null (SDK default)", async () => {
    const r = parseSlashCommand("/model")!;
    await r.command.run(r.args, card({ model: "opus" }));
    expect(useCardsStore.getState().setSessionConfig).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ model: null }),
    );
  });

  it("/max-turns rejects non-integers and non-positives", async () => {
    const r = parseSlashCommand("/max-turns abc")!;
    await expect(r.command.run(r.args, card())).rejects.toThrow(
      /Invalid max-turns/,
    );
    const r2 = parseSlashCommand("/max-turns -5")!;
    await expect(r2.command.run(r2.args, card())).rejects.toThrow(
      /Invalid max-turns/,
    );
  });

  it("/max-turns accepts positive integers", async () => {
    const r = parseSlashCommand("/max-turns 12")!;
    await r.command.run(r.args, card());
    expect(useCardsStore.getState().setSessionConfig).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ maxTurns: 12 }),
    );
  });

  it("/stop fails loudly when there's no live session", async () => {
    const r = parseSlashCommand("/stop")!;
    await expect(r.command.run(r.args, card({ sessionId: null }))).rejects.toThrow(
      /No live session/,
    );
    expect(ipcStopSession).not.toHaveBeenCalled();
  });

  it("/stop calls IPC when the card's session is live", async () => {
    useUiStore.setState({ liveSessionIds: new Set(["s1"]) });
    const r = parseSlashCommand("/stop")!;
    await r.command.run(r.args, card({ sessionId: "s1" }));
    expect(ipcStopSession).toHaveBeenCalledWith("c1");
  });

  it("/clear wipes the messages store for the card and pushes a toast", async () => {
    const r = parseSlashCommand("/clear")!;
    await r.command.run(r.args, card());
    expect(useMessagesStore.getState().clear).toHaveBeenCalledWith("c1");
    expect(useToastsStore.getState().push).toHaveBeenCalled();
  });

  it("/plan switches permissionMode to 'plan'", async () => {
    const r = parseSlashCommand("/plan")!;
    await r.command.run(r.args, card());
    expect(useCardsStore.getState().setSessionConfig).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ permissionMode: "plan" }),
    );
  });
});
