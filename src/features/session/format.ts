/**
 * Best-effort one-line summary of a tool_use block. The shape of `input`
 * varies by tool; we recognise the common ones and fall back to JSON for the rest.
 */
export function formatToolUse(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "Read":
      return `Read ${truncate(String(i.file_path ?? ""), 80)}`;
    case "Write":
      return `Write ${truncate(String(i.file_path ?? ""), 80)}`;
    case "Edit":
      return `Edit ${truncate(String(i.file_path ?? ""), 80)}`;
    case "Bash":
      return `Bash › ${truncate(String(i.command ?? ""), 100)}`;
    case "Glob":
      return `Glob ${truncate(String(i.pattern ?? ""), 80)}`;
    case "Grep":
      return `Grep "${truncate(String(i.pattern ?? ""), 60)}"`;
    case "Task":
      return `Task › ${String(i.subagent_type ?? "agent")} — ${truncate(
        String(i.description ?? i.prompt ?? ""),
        80,
      )}`;
    case "TodoWrite":
      return `TodoWrite (${Array.isArray(i.todos) ? i.todos.length : "?"} items)`;
    case "WebFetch":
      return `WebFetch ${truncate(String(i.url ?? ""), 80)}`;
    case "WebSearch":
      return `WebSearch "${truncate(String(i.query ?? ""), 60)}"`;
    default: {
      try {
        const json = JSON.stringify(i);
        return `${name} ${truncate(json, 100)}`;
      } catch {
        return name;
      }
    }
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

interface TextBlock { type: "text"; text: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: unknown }
type Block = TextBlock | ToolUseBlock | { type: string; [k: string]: unknown };

export function asBlocks(content: unknown): Block[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as Block[];
  return [];
}
