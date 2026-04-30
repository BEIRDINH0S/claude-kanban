/**
 * Render a session transcript (the same DisplayItem[] the chat panel shows)
 * to a self-contained Markdown document. Used by the per-session export
 * action in ZoomView.
 *
 * Design choices:
 * - One "Tour N" header per `result` event so long sessions are scannable.
 * - User messages, assistant text, and tool_use blocks each get a clear
 *   visual treatment. tool_result blocks (which Claude sees as user-role
 *   payloads) are folded into blockquotes — they're noisy but skipping
 *   them entirely loses too much context.
 * - We keep the formatting close to what one would type by hand. No
 *   collapsibles, no HTML — pure Markdown so it renders anywhere.
 */

import type { Card } from "../../types/card";
import type { DisplayItem } from "../../types/chat";
import { asBlocks, formatToolUse } from "./format";

interface ResultEvent {
  type: "result";
  subtype?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Best-effort: extract a tool_result block's text content for blockquoting. */
function extractToolResultText(block: Record<string, unknown>): string {
  const c = block.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((b) => {
        if (isObj(b) && typeof b.text === "string") return b.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

function fmtCost(c?: number): string {
  return typeof c === "number" ? `$${c.toFixed(4)}` : "—";
}

function indent(s: string, prefix = "> "): string {
  return s
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

export function transcriptToMarkdown(
  card: Card,
  items: DisplayItem[],
): string {
  const out: string[] = [];

  // Header — small, machine-friendly metadata block at the top.
  out.push(`# ${card.title}`);
  out.push("");
  out.push(`- **Projet:** \`${card.projectPath}\``);
  if (card.sessionId) out.push(`- **Session:** \`${card.sessionId}\``);
  out.push(`- **Colonne:** ${card.column}`);
  out.push(`- **Exporté le:** ${fmtDate(Date.now())}`);
  out.push("");
  out.push("---");
  out.push("");

  let turn = 1;

  for (const item of items) {
    if (item.kind === "user-input") {
      // Locally-echoed user input (typed in the input box). The SDK doesn't
      // emit these back as events in streaming-input mode.
      out.push(`### Tour ${turn} · vous`);
      out.push("");
      out.push(item.text);
      out.push("");
      continue;
    }

    const ev = item.event;
    const evType = ev.type;

    if (evType === "user") {
      // Either a fresh user prompt or a tool_result wrap. Distinguish by
      // looking at the content blocks.
      const blocks = asBlocks(ev.message?.content);
      const toolResults = blocks.filter(
        (b) => isObj(b) && b.type === "tool_result",
      );
      const text = blocks
        .filter((b) => isObj(b) && b.type === "text")
        .map((b) => String((b as { text?: unknown }).text ?? ""))
        .join("\n");

      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          const txt = extractToolResultText(tr as Record<string, unknown>);
          if (!txt.trim()) continue;
          out.push(indent(txt.trim()));
          out.push("");
        }
      } else if (text.trim()) {
        out.push(`### Tour ${turn} · vous`);
        out.push("");
        out.push(text.trim());
        out.push("");
      } else if (typeof ev.message?.content === "string") {
        // Plain string content (the shape we push from sidecar host.mjs).
        out.push(`### Tour ${turn} · vous`);
        out.push("");
        out.push(ev.message.content as string);
        out.push("");
      }
      continue;
    }

    if (evType === "assistant") {
      const blocks = asBlocks(ev.message?.content);
      const text = blocks
        .filter((b) => isObj(b) && b.type === "text")
        .map((b) => String((b as { text?: unknown }).text ?? ""))
        .join("\n\n")
        .trim();
      const toolUses = blocks.filter(
        (b) => isObj(b) && b.type === "tool_use",
      );

      if (text || toolUses.length > 0) {
        out.push(`### Tour ${turn} · claude`);
        out.push("");
      }
      if (text) {
        out.push(text);
        out.push("");
      }
      for (const tu of toolUses) {
        const tuObj = tu as { name?: string; input?: unknown };
        out.push("```");
        out.push(formatToolUse(tuObj.name ?? "Tool", tuObj.input));
        out.push("```");
        out.push("");
      }
      continue;
    }

    if (evType === "result") {
      const r = ev as unknown as ResultEvent;
      const cost = fmtCost(r.total_cost_usd);
      const turns =
        typeof r.num_turns === "number" ? `${r.num_turns} messages` : "";
      const dur =
        typeof r.duration_ms === "number"
          ? `${(r.duration_ms / 1000).toFixed(1)}s`
          : "";
      const meta = [cost, turns, dur].filter(Boolean).join(" · ");
      out.push(`_Tour ${turn} terminé — ${meta}_`);
      out.push("");
      out.push("---");
      out.push("");
      turn += 1;
      continue;
    }

    if (evType === "auto_approved") {
      const tn = String((ev as { tool_name?: unknown }).tool_name ?? "?");
      out.push(`_(auto-approuvé · ${tn})_`);
      out.push("");
      continue;
    }

    // Unknown / system / init events are skipped — they're not user-facing.
  }

  return out.join("\n");
}

/** Slug derived from a card title: safe filename, lowercased dashes. */
export function defaultMarkdownFilename(card: Card): string {
  const slug = card.title
    .replace(/[^\w\d-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  const safe = slug || "session";
  return `${safe}.md`;
}
