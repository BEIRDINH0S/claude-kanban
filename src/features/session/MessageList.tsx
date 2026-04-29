import { Wrench } from "lucide-react";
import { useEffect, useRef } from "react";

import type { DisplayItem, SdkEvent } from "../../types/chat";
import { asBlocks, formatToolUse } from "./format";

interface Props {
  items: DisplayItem[];
}

export function MessageList({ items }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new items.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length]);

  const renderable = items.flatMap(toRenderable);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-[760px] flex-col gap-5">
        {renderable.map((r, idx) => (
          <RenderedRow key={`${r.key}-${idx}`} row={r} />
        ))}
        {renderable.length === 0 && (
          <p className="text-center font-mono text-xs text-[var(--text-muted)]">
            En attente du premier événement…
          </p>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

type Row =
  | { kind: "user-text"; key: string; text: string }
  | { kind: "assistant-text"; key: string; text: string }
  | { kind: "tool-use"; key: string; name: string; input: unknown };

/**
 * Turn a DisplayItem into 0..N rendered rows. We:
 *  - keep user-input as user-text rows
 *  - keep assistant text + tool_use blocks
 *  - drop everything else (system, status, result, hooks, tool_results, …)
 */
function toRenderable(item: DisplayItem): Row[] {
  if (item.kind === "user-input") {
    return [{ kind: "user-text", key: item.id, text: item.text }];
  }
  return fromSdk(item.id, item.event);
}

function fromSdk(id: string, event: SdkEvent): Row[] {
  if (event.type === "assistant") {
    const blocks = asBlocks(event.message?.content);
    const rows: Row[] = [];
    blocks.forEach((b, i) => {
      if (b.type === "text" && (b as { text?: string }).text?.trim()) {
        rows.push({
          kind: "assistant-text",
          key: `${id}-${i}`,
          text: (b as { text: string }).text,
        });
      } else if (b.type === "tool_use") {
        const tu = b as { name: string; input: unknown };
        rows.push({
          kind: "tool-use",
          key: `${id}-${i}`,
          name: tu.name,
          input: tu.input,
        });
      }
    });
    return rows;
  }

  if (event.type === "user") {
    const blocks = asBlocks(event.message?.content);
    // Only surface plain-text user messages. tool_results stay hidden — the
    // assistant's next turn will reference them implicitly.
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n")
      .trim();
    if (!text) return [];
    return [{ kind: "user-text", key: id, text }];
  }

  return [];
}

function RenderedRow({ row }: { row: Row }) {
  if (row.kind === "user-text") {
    return (
      <div className="flex justify-end">
        <div className="glass-strong max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
          {row.text}
        </div>
      </div>
    );
  }
  if (row.kind === "assistant-text") {
    return (
      <div className="font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
        {row.text}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 self-start rounded-lg border border-[var(--glass-stroke)] bg-black/5 px-2.5 py-1.5 dark:bg-white/5">
      <Wrench className="size-3 shrink-0 text-[var(--text-muted)]" strokeWidth={1.5} />
      <span className="font-mono text-[11.5px] text-[var(--text-secondary)]">
        {formatToolUse(row.name, row.input)}
      </span>
    </div>
  );
}
