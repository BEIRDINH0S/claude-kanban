import { ChevronRight, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DisplayItem, SdkEvent } from "../../types/chat";
import { asBlocks, formatToolUse } from "./format";

const REMARK_PLUGINS = [remarkGfm];

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
  | { kind: "tool-use"; key: string; name: string; input: unknown }
  | { kind: "tool-result"; key: string; content: string; isError: boolean };

/**
 * Turn a DisplayItem into 0..N rendered rows. We:
 *  - keep user-input as user-text rows
 *  - keep assistant text + tool_use blocks
 *  - render tool_results as collapsed rows (click to expand)
 *  - drop everything else (system, status, result, hooks, …)
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
    const rows: Row[] = [];
    blocks.forEach((b, i) => {
      if (b.type === "text") {
        const text = (b as { text?: string }).text?.trim();
        if (text) rows.push({ kind: "user-text", key: `${id}-${i}`, text });
      } else if (b.type === "tool_result") {
        const tr = b as {
          content?: unknown;
          is_error?: boolean;
        };
        rows.push({
          kind: "tool-result",
          key: `${id}-${i}`,
          content: stringifyToolResult(tr.content),
          isError: !!tr.is_error,
        });
      }
    });
    return rows;
  }

  return [];
}

/** Tool results can be a plain string or an array of `{type:'text', text}`
 * blocks (the Anthropic content-block shape). Collapse both to a single
 * string so the row renderer doesn't care. */
function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object" && "text" in b) {
          return String((b as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("\n");
  }
  return "";
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
      <div className="md-prose font-mono text-[12.5px] leading-relaxed text-[var(--text-primary)]">
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
          {row.text}
        </ReactMarkdown>
      </div>
    );
  }
  if (row.kind === "tool-result") {
    return <ToolResultRow content={row.content} isError={row.isError} />;
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

/** Collapsible tool result. Closed by default — most of the time the
 * assistant's follow-up summarises whatever was returned. Click the chevron
 * (or the row) to reveal the raw payload. */
function ToolResultRow({
  content,
  isError,
}: {
  content: string;
  isError: boolean;
}) {
  const [open, setOpen] = useState(false);
  const preview = content.split("\n")[0]?.slice(0, 80) ?? "";
  return (
    <div className="self-start max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-lg border border-[var(--glass-stroke)] px-2.5 py-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
          isError ? "text-red-400" : "text-[var(--text-muted)]"
        }`}
        aria-expanded={open}
      >
        <ChevronRight
          className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={1.75}
        />
        <span className="font-mono text-[11px]">
          {isError ? "tool error" : "tool result"}
          {!open && preview && (
            <span className="ml-1.5 text-[var(--text-muted)]">· {preview}</span>
          )}
        </span>
      </button>
      {open && (
        <pre className="mt-1.5 max-h-64 overflow-auto rounded-lg border border-[var(--glass-stroke)] bg-black/5 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--text-secondary)] dark:bg-white/5">
          {content || "(empty)"}
        </pre>
      )}
    </div>
  );
}
