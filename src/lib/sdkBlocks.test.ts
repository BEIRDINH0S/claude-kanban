/**
 * `asBlocks` — the SDK content normaliser. The SDK serialises a single text
 * message as either a string or an array; without this normaliser the rest
 * of the pipeline would have to branch on every read. A regression here =
 * lost messages in the chat panel.
 */
import { describe, expect, it } from "vitest";

import { asBlocks } from "./sdkBlocks";

describe("asBlocks", () => {
  it("wraps a bare string into a single text block", () => {
    expect(asBlocks("hello")).toEqual([{ type: "text", text: "hello" }]);
  });

  it("returns the array as-is when it's already shaped (cast through, no copy)", () => {
    const arr = [
      { type: "text", text: "a" },
      { type: "tool_use", id: "1", name: "Read", input: {} },
    ];
    expect(asBlocks(arr)).toBe(arr);
  });

  it("returns an empty array for unknown / null / undefined content", () => {
    expect(asBlocks(null)).toEqual([]);
    expect(asBlocks(undefined)).toEqual([]);
    expect(asBlocks(42)).toEqual([]);
    expect(asBlocks({ random: true })).toEqual([]);
  });
});
