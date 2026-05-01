/**
 * Shared decoder for the SDK message-content shape. Lives in `lib/` (pure,
 * framework-free) because both the store layer (`messagesStore`) and the
 * session feature use it — the data structure is part of the SDK contract,
 * not of any one feature's presentation logic.
 *
 * The SDK occasionally serialises a single text message as a plain string
 * instead of `[{ type: "text", text: "…" }]`; `asBlocks` normalises both
 * shapes so callers don't have to branch.
 */

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
export type Block =
  | TextBlock
  | ToolUseBlock
  | { type: string; [k: string]: unknown };

export function asBlocks(content: unknown): Block[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as Block[];
  return [];
}
