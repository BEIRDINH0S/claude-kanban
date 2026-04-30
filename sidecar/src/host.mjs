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
import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { request as httpsRequest } from "node:https";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
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
 * Detect a `claude` install on PATH purely so the front can decide whether to
 * surface the "Claude Code introuvable" banner. By default we do NOT pass
 * this to the SDK: Claude Code v2.x ships as a native binary and the SDK
 * has its own bundled copy in `@anthropic-ai/claude-agent-sdk-{platform}-{arch}/claude.exe`,
 * which it auto-resolves when `pathToClaudeCodeExecutable` is omitted. Forcing
 * a user-PATH path is brittle (npm shims aren't spawnable by Node) and provides
 * no real win since the bundled binary shares the same `~/.claude` config.
 */
function detectClaudeOnPath() {
  const cmd = process.platform === "win32" ? "where claude" : "which claude";
  try {
    const out = execSync(cmd, { encoding: "utf8" }).trim();
    return out.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

/**
 * Windows + WSL: detect a `claude` install inside the user's default WSL
 * distro. Used when the user explicitly opts into WSL mode via Settings —
 * their auth tokens, MCP servers and ~/.claude config all live on the Linux
 * side, so the SDK-bundled Windows `claude.exe` would point at a different
 * home. We generate a tiny .cmd shim that wraps `wsl claude %*` and pass
 * that path to the SDK so every session actually runs the user's WSL binary.
 *
 * Returns `{ shimPath, wslClaude }` or null if WSL is unavailable / has no
 * claude installed.
 */
function detectWslClaude() {
  if (process.platform !== "win32") return null;
  let wslClaude = null;
  try {
    // `wsl which claude` runs inside the default distro's login shell. If
    // wsl.exe itself is missing or no distro is registered, this throws.
    const out = execSync("wsl -- which claude", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    wslClaude = out.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
  if (!wslClaude) return null;

  // Generate a shim .cmd in tmpdir. Deterministic name so we don't litter
  // tmp on each restart. `.cmd` (not `.bat`) is what `process.spawn` will
  // happily exec on Windows without `shell: true`.
  const shimPath = join(tmpdir(), "claude-kanban-wsl-claude.cmd");
  try {
    writeFileSync(shimPath, "@echo off\r\nwsl claude %*\r\n", "utf8");
  } catch (err) {
    log(`wsl shim write failed: ${err?.message ?? err}`);
    return null;
  }
  return { shimPath, wslClaude };
}

/**
 * Parse `--claude-runtime=auto|native|wsl` from CLI args. Default `auto`.
 *   - `auto`   : detect native; on Windows fall back to WSL if native is
 *                missing.
 *   - `native` : never use WSL even if native is missing (let the SDK fall
 *                back to its bundled binary).
 *   - `wsl`    : force WSL mode on Windows; ignored elsewhere (no WSL).
 */
function parseRuntimeArg() {
  const raw = process.argv.find((a) => a.startsWith("--claude-runtime="));
  const v = raw ? raw.split("=", 2)[1] : "auto";
  return ["auto", "native", "wsl"].includes(v) ? v : "auto";
}

const RUNTIME_PREF = parseRuntimeArg();
const NATIVE_CLAUDE = RUNTIME_PREF === "wsl" ? null : detectClaudeOnPath();
// WSL is checked when the user explicitly asked for it, OR in `auto` mode
// when nothing native turned up. `native` mode skips WSL entirely.
const SHOULD_TRY_WSL =
  RUNTIME_PREF === "wsl" ||
  (RUNTIME_PREF === "auto" && process.platform === "win32" && !NATIVE_CLAUDE);
const WSL_CLAUDE = SHOULD_TRY_WSL ? detectWslClaude() : null;
const CLAUDE_PATH = WSL_CLAUDE?.wslClaude ?? NATIVE_CLAUDE ?? null;
// Path actually passed to the SDK. Null = let the SDK use its bundled binary.
const CLAUDE_EXEC_OVERRIDE = WSL_CLAUDE?.shimPath ?? null;
const EFFECTIVE_RUNTIME = WSL_CLAUDE ? "wsl" : "native";

log(`runtime pref: ${RUNTIME_PREF} → effective: ${EFFECTIVE_RUNTIME}`);
if (WSL_CLAUDE) {
  log(`claude via WSL: ${WSL_CLAUDE.wslClaude} (shim ${WSL_CLAUDE.shimPath})`);
} else if (RUNTIME_PREF === "wsl") {
  log("WSL mode requested but no WSL claude found — falling back to bundled");
} else {
  log("claude on PATH:", NATIVE_CLAUDE ?? "(none — using SDK-bundled binary)");
}
// Heads-up to Rust at boot: tells the front whether to surface a
// "claude not installed" banner and which runtime we ended up using.
process.nextTick(() => {
  send({
    type: "ready",
    claudeBinary: CLAUDE_PATH,
    runtime: EFFECTIVE_RUNTIME,
    runtimePref: RUNTIME_PREF,
  });
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
        // When running on Windows with a WSL-only claude install, the shim
        // generated at boot wraps `wsl claude %*`. Otherwise we leave this
        // unset so the SDK uses its bundled binary (default behaviour).
        ...(CLAUDE_EXEC_OVERRIDE
          ? { pathToClaudeCodeExecutable: CLAUDE_EXEC_OVERRIDE }
          : {}),
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

// ---------------------------------------------------------------------------
// Subscription usage (OAuth /api/oauth/usage)
// ---------------------------------------------------------------------------
//
// Anthropic exposes a *private* OAuth endpoint that returns the precise
// percentage consumption of the authenticated subscription's 5h and 7d
// windows — exactly what Claude Code's `/usage` slash shows. We hit it from
// here (the Node sidecar) because:
//   - `https` + `child_process` are already available; no new Rust deps.
//   - The reference implementation in `claude-hud` (the plugin the user is
//     using as their statusline) is in JS, so we can match its behaviour
//     port-by-port and trust the same cache/backoff semantics.
//
// Flow on `get_subscription_usage` from Rust:
//   1. Try a fresh-enough cache (5-min TTL by default).
//   2. If stale, read the OAuth bearer token (Keychain on macOS, file
//      fallback `~/.claude/.credentials.json` everywhere).
//   3. GET `api.anthropic.com/api/oauth/usage` with
//      `Authorization: Bearer …` and `anthropic-beta: oauth-2025-04-20`.
//   4. Cache the response and return it. On 429, fall back to the last
//      known good value with a `apiError: "rate-limited"` flag so the UI
//      can show "syncing" without going blank.
//
// All errors are non-throwing — we always resolve the request with an
// outcome the front can render (even if it's `apiUnavailable: true`).

const SUBSCRIPTION_CACHE_PATH = join(
  homedir(),
  ".claude",
  "cache",
  "claude-kanban-subscription-usage.json",
);
const SUBSCRIPTION_CACHE_TTL_MS = 5 * 60_000;
const SUBSCRIPTION_FAILURE_TTL_MS = 15_000;
const SUBSCRIPTION_RATE_LIMIT_BASE_MS = 60_000;
const SUBSCRIPTION_RATE_LIMIT_MAX_MS = 5 * 60_000;
const KEYCHAIN_SERVICE_NAME = "Claude Code-credentials";
const USAGE_API_TIMEOUT_MS = 15_000;

function readCache() {
  try {
    if (!existsSync(SUBSCRIPTION_CACHE_PATH)) return null;
    return JSON.parse(readFileSync(SUBSCRIPTION_CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(entry) {
  try {
    const dir = dirname(SUBSCRIPTION_CACHE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SUBSCRIPTION_CACHE_PATH, JSON.stringify(entry), "utf8");
  } catch (err) {
    log(`subscription cache write failed: ${err?.message ?? err}`);
  }
}

/** TTL window the cache should respect for the current state. */
function effectiveTtlMs(cache) {
  if (!cache) return 0;
  if (cache.data?.apiError === "rate-limited" && cache.retryAfterUntil) {
    return Math.max(0, cache.retryAfterUntil - cache.timestamp);
  }
  if (cache.data?.apiUnavailable) return SUBSCRIPTION_FAILURE_TTL_MS;
  return SUBSCRIPTION_CACHE_TTL_MS;
}

function rateLimitedBackoffMs(count) {
  return Math.min(
    SUBSCRIPTION_RATE_LIMIT_BASE_MS * Math.pow(2, Math.max(0, count - 1)),
    SUBSCRIPTION_RATE_LIMIT_MAX_MS,
  );
}

/**
 * Read OAuth credentials from macOS Keychain.
 * Service: "Claude Code-credentials". Account: user's login name.
 * Falls back to a service-only lookup (no account) for older Claude Code
 * versions that wrote the entry without one. Returns null if anything
 * fails — we then try the file fallback below.
 */
function readKeychainCredentials() {
  if (process.platform !== "darwin") return null;
  const account = (() => {
    try {
      return userInfo().username?.trim() || null;
    } catch {
      return null;
    }
  })();
  const tryRead = (args) => {
    try {
      const raw = execFileSync("/usr/bin/security", args, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 3000,
      }).trim();
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const baseArgs = ["find-generic-password", "-s", KEYCHAIN_SERVICE_NAME, "-w"];
  const data = account
    ? tryRead([
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE_NAME,
        "-a",
        account,
        "-w",
      ]) ?? tryRead(baseArgs)
    : tryRead(baseArgs);
  if (!data) return null;
  const oauth = data.claudeAiOauth;
  if (!oauth?.accessToken) return null;
  if (typeof oauth.expiresAt === "number" && oauth.expiresAt <= Date.now()) {
    return null;
  }
  return {
    accessToken: oauth.accessToken,
    subscriptionType: oauth.subscriptionType ?? "",
  };
}

function readFileCredentials() {
  const path = join(homedir(), ".claude", ".credentials.json");
  try {
    if (!existsSync(path)) return null;
    const data = JSON.parse(readFileSync(path, "utf8"));
    const oauth = data.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    if (typeof oauth.expiresAt === "number" && oauth.expiresAt <= Date.now()) {
      return null;
    }
    return {
      accessToken: oauth.accessToken,
      subscriptionType: oauth.subscriptionType ?? "",
    };
  } catch {
    return null;
  }
}

function readCredentials() {
  const keychain = readKeychainCredentials();
  if (keychain) {
    if (keychain.subscriptionType) return keychain;
    // Token from keychain, subscriptionType from file (older releases stored
    // the latter only in the file).
    const file = readFileCredentials();
    if (file?.subscriptionType) {
      return { accessToken: keychain.accessToken, subscriptionType: file.subscriptionType };
    }
    return keychain;
  }
  return readFileCredentials();
}

function planNameFor(subscriptionType) {
  const lower = (subscriptionType ?? "").toLowerCase();
  if (lower.includes("max")) return "Max";
  if (lower.includes("pro")) return "Pro";
  if (lower.includes("team")) return "Team";
  if (!subscriptionType || lower.includes("api")) return null;
  return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}

function clampUtilization(v) {
  if (v == null) return null;
  if (!Number.isFinite(v)) return null;
  return Math.round(Math.max(0, Math.min(100, v)));
}

/** Issue a single GET against the OAuth usage endpoint. */
function fetchOauthUsage(accessToken) {
  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        hostname: "api.anthropic.com",
        path: "/api/oauth/usage",
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": "claude-kanban/0.1 (+oauth-usage)",
        },
        timeout: USAGE_API_TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c.toString();
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status !== 200) {
            const error =
              status === 429
                ? "rate-limited"
                : status >= 400
                ? `http-${status}`
                : "http-error";
            const retryAfter = (() => {
              const raw = res.headers["retry-after"];
              const v = Array.isArray(raw) ? raw[0] : raw;
              if (!v) return undefined;
              const n = Number.parseInt(v, 10);
              if (Number.isFinite(n) && n > 0) return n;
              const t = Date.parse(v);
              if (!Number.isFinite(t)) return undefined;
              const sec = Math.ceil((t - Date.now()) / 1000);
              return sec > 0 ? sec : undefined;
            })();
            resolve({ ok: false, error, retryAfterSec: retryAfter });
            return;
          }
          try {
            resolve({ ok: true, data: JSON.parse(body) });
          } catch (err) {
            resolve({ ok: false, error: "parse" });
          }
        });
      },
    );
    req.on("error", () => resolve({ ok: false, error: "network" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.end();
  });
}

/**
 * Resolve the current subscription usage. Always returns an object the
 * front can render — never throws.
 *
 * `force=true` bypasses the cache (used by the explicit "refresh" button).
 */
async function getSubscriptionUsage({ force = false } = {}) {
  const now = Date.now();
  const cache = readCache();

  if (!force && cache) {
    const ttl = effectiveTtlMs(cache);
    if (now - cache.timestamp < ttl) {
      // Serve last-good when we're in a rate-limit backoff window — the data
      // was correct as of `cache.lastGoodTimestamp`, the front can warn.
      const display =
        cache.data?.apiError === "rate-limited" && cache.lastGoodData
          ? { ...cache.lastGoodData, apiError: "rate-limited" }
          : cache.data;
      return display;
    }
  }

  const credentials = readCredentials();
  if (!credentials) {
    const result = {
      planName: null,
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      apiUnavailable: true,
      apiError: "no-credentials",
    };
    writeCache({ data: result, timestamp: now });
    return result;
  }

  const planName =
    planNameFor(credentials.subscriptionType) ??
    cache?.data?.planName ??
    cache?.lastGoodData?.planName ??
    null;
  if (!planName) {
    // API user — no subscription window to report.
    return {
      planName: null,
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      apiUnavailable: false,
      apiError: "api-user",
    };
  }

  const apiResult = await fetchOauthUsage(credentials.accessToken);
  if (!apiResult.ok) {
    const isRateLimited = apiResult.error === "rate-limited";
    const prevCount = cache?.rateLimitedCount ?? 0;
    const rateLimitedCount = isRateLimited ? prevCount + 1 : 0;
    const retryAfterUntil =
      isRateLimited && apiResult.retryAfterSec
        ? now + apiResult.retryAfterSec * 1000
        : isRateLimited
        ? now + rateLimitedBackoffMs(rateLimitedCount)
        : undefined;

    const failure = {
      planName,
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      apiUnavailable: true,
      apiError: apiResult.error,
    };

    if (isRateLimited) {
      const lastGood = cache?.lastGoodData ?? cache?.data;
      const lastGoodTimestamp = cache?.lastGoodTimestamp ?? cache?.timestamp;
      const goodResult = lastGood && !lastGood.apiUnavailable ? lastGood : null;
      writeCache({
        data: failure,
        timestamp: now,
        rateLimitedCount,
        retryAfterUntil,
        lastGoodData: goodResult ?? cache?.lastGoodData,
        lastGoodTimestamp: goodResult ? lastGoodTimestamp : cache?.lastGoodTimestamp,
      });
      if (goodResult) {
        return { ...goodResult, apiError: "rate-limited" };
      }
      return failure;
    }
    writeCache({ data: failure, timestamp: now });
    return failure;
  }

  const data = apiResult.data ?? {};
  const result = {
    planName,
    fiveHour: clampUtilization(data.five_hour?.utilization),
    sevenDay: clampUtilization(data.seven_day?.utilization),
    fiveHourResetAt: data.five_hour?.resets_at ?? null,
    sevenDayResetAt: data.seven_day?.resets_at ?? null,
    apiUnavailable: false,
  };
  writeCache({
    data: result,
    timestamp: now,
    lastGoodData: result,
    lastGoodTimestamp: now,
  });
  return result;
}

// ---------------------------------------------------------------------------

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
    case "get_subscription_usage": {
      // Async — don't block the readline loop. Errors are swallowed inside
      // getSubscriptionUsage and surfaced as `apiUnavailable: true`.
      const requestId = msg.requestId;
      const force = !!msg.force;
      void getSubscriptionUsage({ force }).then((data) => {
        send({ type: "subscription_usage_result", requestId, data });
      });
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
