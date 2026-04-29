/**
 * Claude Agent SDK host. Single long-running Node process owned by the Tauri
 * Rust side. Talks JSON-lines over stdin/stdout, multiplexes one or more live
 * Claude Code sessions in memory.
 *
 * Inbound (Rust → here):
 *   { type: "start_session", requestId, cardId, title, projectPath }
 *   { type: "send_message",  sessionId, text }                           (step 6)
 *   { type: "stop_session",  sessionId }                                 (step 11)
 *
 * Outbound (here → Rust):
 *   { type: "ready" }
 *   { type: "session_started", requestId, cardId, sessionId }
 *   { type: "session_event",   sessionId, event }   // raw SDK message
 *   { type: "session_ended",   sessionId, reason }
 *   { type: "error",           requestId?, sessionId?, message }
 *
 * The SDK's `query` is consumed in streaming-input mode so the same session
 * can receive follow-up messages (step 6) without a respawn.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "node:child_process";
import readline from "node:readline";

const stdout = process.stdout;
function send(msg) {
  stdout.write(JSON.stringify(msg) + "\n");
}

// Anything we log internally goes to stderr — Rust forwards/inherits it.
function log(...args) {
  process.stderr.write(`[sidecar] ${args.join(" ")}\n`);
}

/**
 * The SDK looks for its bundled native binary first; if Claude Code was
 * installed manually (e.g. ~/.local/bin/claude on macOS) the bundled binary
 * isn't there, so we resolve the user's claude via PATH and hand it back.
 */
function resolveClaudePath() {
  const cmd = process.platform === "win32" ? "where claude" : "which claude";
  try {
    const out = execSync(cmd, { encoding: "utf8" }).trim();
    return out.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

const CLAUDE_PATH = resolveClaudePath();
log("claude binary:", CLAUDE_PATH ?? "(not found on PATH)");
// Heads-up to Rust at boot: tells the front whether to surface a
// "claude not installed" banner.
process.nextTick(() => {
  send({ type: "ready", claudeBinary: CLAUDE_PATH });
});

const sessionsById = new Map(); // sessionId  → SessionHandle (after init)
const pendingByRequest = new Map(); // requestId → SessionHandle (before init)
/**
 * Pending tool-permission requests keyed by their requestId. The value is the
 * `resolve` of the Promise the SDK is awaiting in canUseTool. The Rust side
 * must reply via `permission_response` to unblock the tool call.
 */
const pendingPermissions = new Map();

class SessionHandle {
  constructor({ requestId, cardId, title, projectPath, resumeSessionId }) {
    this.requestId = requestId;
    this.cardId = cardId;
    // For a resume we pre-seed sessionId so events emitted before the new
    // init are still associated with the right card on the Rust side.
    this.sessionId = resumeSessionId ?? null;

    // Buffered queue between us and the SDK's prompt iterable.
    /** @type {{type:'user', message:{role:'user', content:string}, parent_tool_use_id:null}[]} */
    this.queue = [];
    /** @type {((m:any)=>void)|null} */
    this.resolveNext = null;
    this.endedInput = false;

    const self = this;
    const promptIterable = (async function* () {
      while (!self.endedInput) {
        const next = await new Promise((resolve) => {
          if (self.queue.length > 0) {
            resolve(self.queue.shift());
          } else {
            self.resolveNext = resolve;
          }
        });
        if (next === null) return; // poison pill = end of stream
        yield next;
      }
    })();

    // Always push a first message — the SDK in streaming-input mode won't
    // emit `init` (or anything) until at least one user message is queued.
    // For fresh starts this is the card title. For resumes this is the
    // follow-up the user typed in the chat input.
    this.push(title);

    this.q = query({
      prompt: promptIterable,
      options: {
        cwd: projectPath,
        permissionMode: "default",
        // Every tool use gets routed through here; we ask the user via the UI.
        canUseTool: (toolName, input) => self.askPermission(toolName, input),
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        ...(CLAUDE_PATH ? { pathToClaudeCodeExecutable: CLAUDE_PATH } : {}),
      },
    });

    this.consume();
  }

  push(text) {
    const msg = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    };
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r(msg);
    } else {
      this.queue.push(msg);
    }
  }

  /**
   * Called by the SDK before each tool execution. We return a Promise that
   * resolves only when Rust replies with `permission_response`. Until then
   * the SDK is paused for this session (Claude is waiting on us).
   */
  askPermission(toolName, input) {
    return new Promise((resolve) => {
      const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Stash the original input alongside resolve: when Rust replies with
      // `allow` it doesn't (need to) echo the input back, but the SDK still
      // expects an `updatedInput` to forward to the tool — falling back to
      // `{}` would silently break Bash/Edit/etc.
      pendingPermissions.set(requestId, { resolve, input });
      log(`canUseTool ${toolName} req=${requestId}`);
      send({
        type: "permission_request",
        requestId,
        sessionId: this.sessionId,
        cardId: this.cardId,
        toolName,
        input,
      });
    });
  }

  endInput() {
    this.endedInput = true;
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r(null);
    }
  }

  async consume() {
    log(`consume start req=${this.requestId} cwd=${this.q ? "ok" : "??"}`);
    // On resume we already know the sessionId; register the handle now so the
    // first send_message after resume routes correctly.
    if (this.sessionId && !sessionsById.has(this.sessionId)) {
      sessionsById.set(this.sessionId, this);
    }
    try {
      for await (const event of this.q) {
        log(
          `event type=${event.type}${
            event.subtype ? ` subtype=${event.subtype}` : ""
          } sid=${this.sessionId ?? "-"}`,
        );
        if (event.type === "rate_limit_event") {
          log(`rate_limit raw: ${JSON.stringify(event)}`);
        }
        // First system "init" carries the assigned session_id (or the same
        // one we asked to resume).
        if (event.type === "system" && event.subtype === "init") {
          const newSid = event.session_id;
          // Resume keeps the same id by default (forkSession=false). If we're
          // already tracked under that id this is a no-op.
          if (newSid && newSid !== this.sessionId) {
            if (this.sessionId) sessionsById.delete(this.sessionId);
            this.sessionId = newSid;
            sessionsById.set(this.sessionId, this);
          } else if (newSid && !this.sessionId) {
            this.sessionId = newSid;
            sessionsById.set(this.sessionId, this);
          }
          pendingByRequest.delete(this.requestId);
          send({
            type: "session_started",
            requestId: this.requestId,
            cardId: this.cardId,
            sessionId: this.sessionId,
          });
        }
        send({
          type: "session_event",
          sessionId: this.sessionId,
          cardId: this.cardId,
          event,
        });
        // `result` marks the end of one Claude turn. In streaming-input mode
        // the iterator stays open for follow-up input, but the kanban should
        // already drop the card from In Progress to Idle here.
        if (event.type === "result") {
          send({
            type: "session_turn_complete",
            sessionId: this.sessionId,
            cardId: this.cardId,
            subtype: event.subtype,
          });
        }
      }
      log(`consume done req=${this.requestId} sid=${this.sessionId ?? "-"}`);
      send({
        type: "session_ended",
        sessionId: this.sessionId,
        reason: "completed",
      });
    } catch (err) {
      const message = err?.stack || err?.message || String(err);
      log(`consume error req=${this.requestId}:`, message);
      send({
        type: "error",
        requestId: this.requestId,
        sessionId: this.sessionId,
        message,
      });
      send({
        type: "session_ended",
        sessionId: this.sessionId,
        reason: "error",
      });
    } finally {
      if (this.sessionId) sessionsById.delete(this.sessionId);
      pendingByRequest.delete(this.requestId);
    }
  }
}

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    send({ type: "error", message: `bad json: ${err.message}` });
    return;
  }

  log(`<<`, msg.type, msg.requestId ?? msg.sessionId ?? "");

  switch (msg.type) {
    case "start_session": {
      try {
        const handle = new SessionHandle(msg);
        pendingByRequest.set(msg.requestId, handle);
      } catch (err) {
        log(`start_session sync error:`, err?.stack || err);
        send({
          type: "error",
          requestId: msg.requestId,
          message: err?.stack || err?.message || String(err),
        });
      }
      return;
    }
    case "send_message": {
      const handle = sessionsById.get(msg.sessionId);
      if (!handle) {
        send({
          type: "error",
          sessionId: msg.sessionId,
          message: `no live session: ${msg.sessionId}`,
        });
        return;
      }
      handle.push(msg.text);
      return;
    }
    case "stop_session": {
      const handle = sessionsById.get(msg.sessionId);
      if (handle) handle.endInput();
      return;
    }
    case "permission_response": {
      const entry = pendingPermissions.get(msg.requestId);
      if (!entry) {
        log(`permission_response with unknown requestId=${msg.requestId}`);
        return;
      }
      pendingPermissions.delete(msg.requestId);
      const { resolve, input: originalInput } = entry;
      if (msg.decision === "allow") {
        // updatedInput defaults to whatever the SDK originally proposed; we
        // pass it through unchanged unless Rust supplied a new one.
        resolve({
          behavior: "allow",
          updatedInput: msg.updatedInput ?? originalInput ?? {},
        });
      } else {
        resolve({
          behavior: "deny",
          message: msg.message ?? "Refusé par l'utilisateur",
          interrupt: !!msg.interrupt,
        });
      }
      return;
    }
    default:
      send({ type: "error", message: `unknown message type: ${msg.type}` });
  }
});

rl.on("close", () => {
  log("stdin closed, exiting");
  process.exit(0);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
process.on("uncaughtException", (err) => {
  send({ type: "error", message: `uncaught: ${err?.stack || err}` });
});
process.on("unhandledRejection", (err) => {
  send({ type: "error", message: `unhandled: ${err?.stack || err}` });
});

// Note: the rich `ready` message above (with claudeBinary) replaces the
// historical bare ready emit.
