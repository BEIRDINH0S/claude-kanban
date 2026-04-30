//! Anthropic public pricing per model (USD per **million tokens**).
//!
//! Source: <https://www.anthropic.com/pricing#api> (snapshot 2026-04). Update
//! the table when Anthropic publishes new rates — and bump the constant
//! `PRICING_TABLE_VERSION` so a future migration can decide whether to
//! recompute `cost_usd_local` on existing rows.
//!
//! Why bake this into the binary rather than calling `total_cost_usd` from
//! the SDK `result` event:
//!  - JSONL backfill (sessions ingested from `~/.claude/projects/` written
//!    by other tools / past CLI runs) doesn't have a `result` event for us
//!    to listen to. We need to compute USD from the raw token counts, which
//!    means we need a pricing table.
//!  - We want a per-message breakdown (cache_read vs cache_create vs output)
//!    that the SDK's pre-summed `total_cost_usd` doesn't give.
//!
//! The pricing here is reconciled against the SDK's `total_cost_usd` value
//! whenever both are available — a > 5 % drift surfaces as a stderr warning
//! so we know to update the table.

#[derive(Clone, Copy, Debug)]
pub struct ModelPricing {
    /// $ per million input tokens (raw, non-cached)
    pub input: f64,
    /// $ per million output tokens
    pub output: f64,
    /// $ per million cached read tokens (typical: 10 % of input price)
    pub cache_read: f64,
    /// $ per million tokens written to the **5-minute** ephemeral cache.
    /// Anthropic charges 1.25x the input price for 5m cache writes.
    pub cache_create_5m: f64,
    /// $ per million tokens written to the **1-hour** ephemeral cache.
    /// Anthropic charges 2x the input price for 1h cache writes.
    pub cache_create_1h: f64,
}

/// Bumped whenever the table values change. Stored alongside aggregates so
/// a future maintenance routine can detect stale rows.
pub const PRICING_TABLE_VERSION: u32 = 1;

/// Look up pricing by model id. Match is **prefix-based**: Anthropic ships
/// frequent variants (`claude-opus-4-5-20250929`, `claude-opus-4-7`, …) and
/// we'd rather group them under a stable family than maintain an exhaustive
/// list. Falls back to Opus pricing (the most expensive tier) when the
/// model is unknown so we err on the side of overestimating spend.
pub fn pricing_for(model: &str) -> ModelPricing {
    let m = model.to_ascii_lowercase();

    // Order matters: more specific prefixes first.
    if m.contains("haiku") {
        // claude-haiku-4-* family
        return ModelPricing {
            input: 0.80,
            output: 4.00,
            cache_read: 0.08,
            cache_create_5m: 1.00,
            cache_create_1h: 1.60,
        };
    }
    if m.contains("sonnet") {
        // claude-sonnet-4-* family (incl. 4.5)
        return ModelPricing {
            input: 3.00,
            output: 15.00,
            cache_read: 0.30,
            cache_create_5m: 3.75,
            cache_create_1h: 6.00,
        };
    }
    if m.contains("opus") {
        // claude-opus-4-* family (incl. 4.7)
        return ModelPricing {
            input: 15.00,
            output: 75.00,
            cache_read: 1.50,
            cache_create_5m: 18.75,
            cache_create_1h: 30.00,
        };
    }

    // Unknown model — be conservative (Opus rate). Log so we know to extend
    // the table rather than silently mis-pricing.
    eprintln!(
        "[usage::pricing] unknown model '{model}', falling back to Opus pricing"
    );
    ModelPricing {
        input: 15.00,
        output: 75.00,
        cache_read: 1.50,
        cache_create_5m: 18.75,
        cache_create_1h: 30.00,
    }
}

/// Compute the USD cost of a single assistant message given its token
/// breakdown and model. The 5m/1h split is OPTIONAL — when only the legacy
/// `cache_creation_input_tokens` field is present (no `cache_creation`
/// sub-object), we charge it at the 5m rate (the SDK's default and the
/// dominant case in practice).
#[allow(clippy::too_many_arguments)]
pub fn cost_for_tokens(
    model: &str,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_create_5m: u64,
    cache_create_1h: u64,
    cache_create_legacy: u64, // .usage.cache_creation_input_tokens (pre-split)
) -> f64 {
    let p = pricing_for(model);
    let m = 1_000_000.0_f64;

    // Prefer the explicit 5m/1h split when available; fall back to the legacy
    // "cache_creation_input_tokens" otherwise. We never double-count: if the
    // split is non-zero we trust it; if both split and legacy are non-zero
    // we trust the split (it's strictly more granular).
    let (c5, c1) = if cache_create_5m + cache_create_1h > 0 {
        (cache_create_5m, cache_create_1h)
    } else {
        (cache_create_legacy, 0)
    };

    (input as f64 / m) * p.input
        + (output as f64 / m) * p.output
        + (cache_read as f64 / m) * p.cache_read
        + (c5 as f64 / m) * p.cache_create_5m
        + (c1 as f64 / m) * p.cache_create_1h
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pricing_known_families_are_nonzero() {
        for model in [
            "claude-opus-4-7",
            "claude-opus-4-5-20250929",
            "claude-sonnet-4-5",
            "claude-sonnet-4-5-20250929",
            "claude-haiku-4-5",
        ] {
            let p = pricing_for(model);
            assert!(p.input > 0.0, "input for {model}");
            assert!(p.output > 0.0, "output for {model}");
            assert!(p.cache_read > 0.0, "cache_read for {model}");
            assert!(p.cache_create_5m > 0.0, "cache_create_5m for {model}");
            assert!(p.cache_create_1h > 0.0, "cache_create_1h for {model}");
        }
    }

    #[test]
    fn unknown_model_falls_back_to_opus() {
        let opus = pricing_for("claude-opus-4-7");
        let unknown = pricing_for("claude-some-future-model-9000");
        assert_eq!(opus.input, unknown.input);
        assert_eq!(opus.output, unknown.output);
    }

    #[test]
    fn cost_uses_split_when_available() {
        // 1M output tokens on opus = $75.
        let c = cost_for_tokens("claude-opus-4-7", 0, 1_000_000, 0, 0, 0, 0);
        assert!((c - 75.0).abs() < 0.001);
    }

    #[test]
    fn cost_falls_back_to_legacy_creation_field() {
        // Pre-split SDK ("cache_creation_input_tokens" only).
        // 1M tokens treated as 5m rate => $18.75 on opus.
        let c = cost_for_tokens("claude-opus-4-7", 0, 0, 0, 0, 0, 1_000_000);
        assert!((c - 18.75).abs() < 0.001);
    }

    #[test]
    fn cost_split_overrides_legacy_when_present() {
        // 100k 5m + 100k 1h => 0.1 * 18.75 + 0.1 * 30 = 4.875 (NOT the legacy 1M).
        let c = cost_for_tokens("claude-opus-4-7", 0, 0, 0, 100_000, 100_000, 1_000_000);
        assert!((c - 4.875).abs() < 0.001, "got {c}");
    }
}
