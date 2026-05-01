export type RateLimitType =
  | "five_hour"
  | "seven_day"
  | "seven_day_opus"
  | "seven_day_sonnet"
  | "overage";

export interface RateLimitInfo {
  status: "allowed" | "allowed_warning" | "rejected";
  rateLimitType?: RateLimitType;
  /** 0..1 — fraction consumed of the window. Sparse: the SDK omits this
   *  when the user is well below any warning threshold. */
  utilization?: number;
  /** Threshold (0..1) the user just crossed — last meaningful usage signal
   *  the API gave us. We use it as a floor estimate when `utilization` is
   *  missing. */
  surpassedThreshold?: number;
  /** Unix timestamp (seconds) when the window resets. */
  resetsAt?: number;
  isUsingOverage?: boolean;
}

// ---------------------------------------------------------------------------
// Token-precise usage index (driven by the SQLite-backed `usage_messages`
// table, populated from `~/.claude/projects/**/*.jsonl`). Mirrors the
// serde-camelCase shapes returned by the Rust commands in
// `src-tauri/src/commands/usage.rs`.
// ---------------------------------------------------------------------------

export type TimeRange =
  | { kind: "today" }
  | { kind: "last24h" }
  | { kind: "last7d" }
  | { kind: "last30d" }
  | { kind: "allTime" }
  | { kind: "custom"; from: number; to: number };

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
  webSearchRequests: number;
  webFetchRequests: number;
  costUsd: number;
  messageCount: number;
}

export interface ModelStats {
  model: string;
  summary: UsageSummary;
}

export interface ProjectStats {
  projectPath: string;
  summary: UsageSummary;
}

export interface CardStats {
  cardId: string;
  cardTitle: string | null;
  summary: UsageSummary;
}

export interface SessionStats {
  sessionId: string;
  cardId: string | null;
  cardTitle: string | null;
  projectPath: string;
  startedAt: number;
  lastActivityAt: number;
  summary: UsageSummary;
}

export interface DailyPoint {
  /** YYYY-MM-DD in UTC. */
  day: string;
  summary: UsageSummary;
}

export interface UsageRollingWindows {
  /** Last 5 hours (matches Anthropic's session limit window). */
  last5h: UsageSummary;
  /** Last 7 days (matches Anthropic's weekly limit window). */
  last7d: UsageSummary;
}

export interface UsageOverview {
  summary: UsageSummary;
  byModel: ModelStats[];
  byProject: ProjectStats[];
  byCard: CardStats[];
  recentSessions: SessionStats[];
  rolling: UsageRollingWindows;
  daily: DailyPoint[];
  pricingVersion: number;
}

/** Empty-state object for stores that need a non-null default. */
export const EMPTY_USAGE_SUMMARY: UsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cacheCreation5m: 0,
  cacheCreation1h: 0,
  webSearchRequests: 0,
  webFetchRequests: 0,
  costUsd: 0,
  messageCount: 0,
};

// ---------------------------------------------------------------------------
// Subscription usage. Historically we hit `api.anthropic.com/api/oauth/usage`
// from the sidecar; that endpoint is reserved for the official `claude` CLI
// and impersonating it from a third-party app risks the user's account, so
// the sidecar now returns a stub `claude-only-policy` and the front renders
// a friendly disabled message. The shape stays the same so re-enabling
// later (if Anthropic exposes a documented public endpoint) is a one-line
// change.
// ---------------------------------------------------------------------------

/** Stable machine-readable error codes the sidecar may return. */
export type SubscriptionApiError =
  | "claude-only-policy"
  | "rate-limited"
  | "network"
  | "timeout"
  | "no-credentials"
  | "api-user"
  | "parse"
  | `http-${number}`
  | "http-error";

export interface SubscriptionUsage {
  /** "Pro" / "Max" / "Team" — null for API-only users (no subscription). */
  planName: string | null;
  /** 0..100 percentage, or null when unavailable. */
  fiveHour: number | null;
  /** 0..100 percentage, or null when unavailable. */
  sevenDay: number | null;
  /** ISO 8601 timestamp when the 5h window resets — display-only. */
  fiveHourResetAt: string | null;
  /** ISO 8601 timestamp when the 7d window resets — display-only. */
  sevenDayResetAt: string | null;
  /** True when we couldn't reach the API or the user isn't on a plan. */
  apiUnavailable: boolean;
  /** Detail on why `apiUnavailable` is true; rendered as a status hint. */
  apiError?: SubscriptionApiError;
}
