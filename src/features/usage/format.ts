/**
 * Display helpers for token / cost values in the Usage views. Shared
 * between the page, the BoardHeader, and the Settings summary so we
 * never have two different ways of writing "1.2 M tokens".
 */

/** "1.2 M" / "345 k" / "678" — never more than 4 visible chars. */
export function formatTokens(n: number): string {
  if (n < 1_000) return n.toFixed(0);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)} k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)} M`;
  return `${(n / 1_000_000_000).toFixed(2)} B`;
}

/** "$12.34" or "$0.0042" — adapts precision so small spends are visible. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd < 1_000) return `$${usd.toFixed(2)}`;
  return `$${(usd / 1_000).toFixed(2)} k`;
}

/** "87 %" — for cache hit ratio. */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${Math.round(ratio * 100)} %`;
}

/**
 * Cache hit ratio = cache_read / (cache_read + input_tokens). Output
 * tokens are excluded — they're never cacheable.
 */
export function cacheHitRatio(s: {
  inputTokens: number;
  cacheReadTokens: number;
}): number {
  const denom = s.inputTokens + s.cacheReadTokens;
  if (denom === 0) return 0;
  return s.cacheReadTokens / denom;
}

/**
 * Friendly project label from a path like `/Users/x/code/my-project`.
 * Just the trailing segment, with a fallback for edge cases (no slash,
 * trailing slash, …).
 */
export function shortProjectName(path: string): string {
  if (!path) return "(inconnu)";
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Short model label, used when we don't want to display the full
 * `claude-opus-4-7-20251002` SKU. Family + minor.
 */
export function shortModel(model: string): string {
  // Strip the trailing date stamp if present.
  return model.replace(/-\d{8}$/, "");
}
