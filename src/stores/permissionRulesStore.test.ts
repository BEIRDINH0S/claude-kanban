/**
 * Permission rules store — CRUD over the auto-approve table. Pessimistic
 * writes (we await IPC), so the contract is mostly: "did the IPC call land
 * with the right args, and does the local list reflect the response?"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePermissionRulesStore } from "./permissionRulesStore";

vi.mock("../ipc/permissions", () => ({
  listPermissionRules: vi.fn(async () => []),
  addPermissionRule: vi.fn(async (pattern: string) => ({
    id: `id-${pattern}`,
    pattern,
    createdAt: 0,
  })),
  removePermissionRule: vi.fn(async () => {}),
}));

import {
  addPermissionRule,
  listPermissionRules,
  removePermissionRule,
} from "../ipc/permissions";

describe("permissionRulesStore", () => {
  beforeEach(() => {
    usePermissionRulesStore.setState({
      rules: [],
      loaded: false,
      loading: false,
      error: null,
    });
    vi.mocked(listPermissionRules).mockReset();
    vi.mocked(addPermissionRule).mockReset();
    vi.mocked(removePermissionRule).mockReset();
  });

  it("load() seeds rules and flips loaded=true", async () => {
    vi.mocked(listPermissionRules).mockResolvedValueOnce([
      { id: "1", pattern: "Read", createdAt: 0 },
    ]);
    await usePermissionRulesStore.getState().load();
    const s = usePermissionRulesStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.rules).toEqual([{ id: "1", pattern: "Read", createdAt: 0 }]);
  });

  it("load() is a no-op while another load is in flight (no double IPC)", async () => {
    let resolve: (v: unknown[]) => void = () => {};
    vi.mocked(listPermissionRules).mockImplementationOnce(
      () => new Promise((r) => (resolve = r as (v: unknown[]) => void)),
    );
    const first = usePermissionRulesStore.getState().load();
    // Second concurrent call should bail without queuing another IPC.
    void usePermissionRulesStore.getState().load();
    expect(listPermissionRules).toHaveBeenCalledTimes(1);
    resolve([]);
    await first;
  });

  it("add() prepends new rules", async () => {
    usePermissionRulesStore.setState({
      rules: [{ id: "old", pattern: "Read", createdAt: 0 }],
    });
    vi.mocked(addPermissionRule).mockResolvedValueOnce({
      id: "new",
      pattern: "Bash(npm *)",
      createdAt: 1,
    });
    await usePermissionRulesStore.getState().add("Bash(npm *)");
    expect(
      usePermissionRulesStore.getState().rules.map((r) => r.id),
    ).toEqual(["new", "old"]);
  });

  it("add() with an existing id replaces in place (server-deduped pattern)", async () => {
    usePermissionRulesStore.setState({
      rules: [{ id: "1", pattern: "old", createdAt: 0 }],
    });
    vi.mocked(addPermissionRule).mockResolvedValueOnce({
      id: "1",
      pattern: "fresh",
      createdAt: 5,
    });
    await usePermissionRulesStore.getState().add("ignored-by-mock");
    expect(usePermissionRulesStore.getState().rules).toEqual([
      { id: "1", pattern: "fresh", createdAt: 5 },
    ]);
  });

  it("remove() drops the rule by id and forwards the IPC call", async () => {
    usePermissionRulesStore.setState({
      rules: [
        { id: "a", pattern: "Read", createdAt: 0 },
        { id: "b", pattern: "Edit", createdAt: 0 },
      ],
    });
    vi.mocked(removePermissionRule).mockResolvedValueOnce();
    await usePermissionRulesStore.getState().remove("a");
    expect(removePermissionRule).toHaveBeenCalledWith("a");
    expect(
      usePermissionRulesStore.getState().rules.map((r) => r.id),
    ).toEqual(["b"]);
  });
});
