/**
 * Prompt templates store — JSON-encoded under a single pref row. The
 * defensive parsing matters: a corrupted pref must not brick the slash menu
 * (the user would lose their input box for a runtime issue they can't see).
 *
 * We test against the actual store with the IPC mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTemplatesStore } from "./templatesStore";

vi.mock("../ipc/prefs", () => ({
  getPref: vi.fn(async () => null),
  setPref: vi.fn(async () => {}),
  PREF_PROMPT_TEMPLATES: "prompt_templates",
}));

import { getPref, setPref } from "../ipc/prefs";

describe("templatesStore", () => {
  beforeEach(() => {
    useTemplatesStore.setState({
      templates: [],
      loaded: false,
      loading: false,
      error: null,
    });
    vi.mocked(getPref).mockReset();
    vi.mocked(setPref).mockReset();
  });

  it("load() with no stored row seeds defaults AND persists them", async () => {
    vi.mocked(getPref).mockResolvedValueOnce(null);
    vi.mocked(setPref).mockResolvedValueOnce();
    await useTemplatesStore.getState().load();
    const s = useTemplatesStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.templates.length).toBeGreaterThan(0); // seeds shipped
    expect(setPref).toHaveBeenCalled();
  });

  it("load() honours an explicitly emptied list (`[]`) — does NOT re-seed", async () => {
    vi.mocked(getPref).mockResolvedValueOnce("[]");
    await useTemplatesStore.getState().load();
    expect(useTemplatesStore.getState().templates).toEqual([]);
    // No re-seed, so setPref shouldn't have been called.
    expect(setPref).not.toHaveBeenCalled();
  });

  it("load() with corrupted JSON falls back to seeded defaults silently", async () => {
    vi.mocked(getPref).mockResolvedValueOnce("{not json");
    vi.mocked(setPref).mockResolvedValueOnce();
    await useTemplatesStore.getState().load();
    expect(useTemplatesStore.getState().error).toBeNull();
    expect(useTemplatesStore.getState().templates.length).toBeGreaterThan(0);
  });

  it("load() filters malformed entries from a partially-bad list", async () => {
    vi.mocked(getPref).mockResolvedValueOnce(
      JSON.stringify([
        { id: "1", name: "OK", body: "ok" }, // good
        { id: "2", name: "OK2" }, // missing body
        { id: 3, name: "NumId", body: "x" }, // wrong id type
        { id: "4", name: "Trim", body: "x" }, // good
      ]),
    );
    await useTemplatesStore.getState().load();
    const ids = useTemplatesStore.getState().templates.map((t) => t.id);
    expect(ids).toEqual(["1", "4"]);
  });

  it("add() prepends a new template and persists the full list", async () => {
    useTemplatesStore.setState({
      templates: [{ id: "old", name: "Old", body: "x" }],
      loaded: true,
    });
    vi.mocked(setPref).mockResolvedValueOnce();
    const tpl = await useTemplatesStore.getState().add("Fresh", "  body  ");
    expect(useTemplatesStore.getState().templates[0].id).toBe(tpl.id);
    expect(useTemplatesStore.getState().templates[0].name).toBe("Fresh");
    expect(setPref).toHaveBeenCalled();
  });

  it("update() patches name/body without touching siblings", async () => {
    useTemplatesStore.setState({
      templates: [
        { id: "a", name: "A", body: "1" },
        { id: "b", name: "B", body: "2" },
      ],
      loaded: true,
    });
    vi.mocked(setPref).mockResolvedValueOnce();
    await useTemplatesStore
      .getState()
      .update("a", { name: "  AA  " });
    const t = useTemplatesStore
      .getState()
      .templates.find((x) => x.id === "a")!;
    expect(t.name).toBe("AA"); // trimmed
    expect(t.body).toBe("1"); // unchanged
    expect(
      useTemplatesStore.getState().templates.find((x) => x.id === "b"),
    ).toEqual({ id: "b", name: "B", body: "2" });
  });

  it("remove() drops by id and persists", async () => {
    useTemplatesStore.setState({
      templates: [
        { id: "a", name: "A", body: "1" },
        { id: "b", name: "B", body: "2" },
      ],
      loaded: true,
    });
    vi.mocked(setPref).mockResolvedValueOnce();
    await useTemplatesStore.getState().remove("a");
    expect(
      useTemplatesStore.getState().templates.map((t) => t.id),
    ).toEqual(["b"]);
  });
});
