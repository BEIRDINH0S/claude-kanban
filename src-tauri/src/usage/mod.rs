//! Token-precise usage tracking. Reads `~/.claude/projects/**/*.jsonl`,
//! parses every assistant message's `usage` block, persists tokens + USD
//! to SQLite (`usage_messages`), and exposes aggregations for the front.
//!
//! See `parser.rs` for the JSONL → row mapping, `ingest.rs` for the
//! incremental file scanner, `pricing.rs` for the Anthropic pricing table,
//! and `queries.rs` for the read-side aggregations exposed via Tauri
//! commands (in `crate::commands::usage`).

pub mod ingest;
pub mod parser;
pub mod pricing;
pub mod queries;
