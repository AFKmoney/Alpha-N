//! # HTML Dashboard — Aether Engine v3.0
//!
//! Renders a self-contained HTML status page at `GET /dashboard`. The page is
//! dark-themed, monospace, has zero external resources (no JS, no CSS files,
//! no fonts, no images), and is safe to expose on a LAN. It exists so an
//! operator can `curl http://host:3004/dashboard` (or open it in a browser)
//! and instantly read the live state of every innovation without parsing
//! JSON.
//!
//! # Layout
//!
//! The dashboard surfaces a single [`DashboardData`] snapshot captured by
//! the [`handlers::dashboard`](crate::handlers::dashboard) handler:
//!
//! - **Header** — engine name + version + uptime.
//! - **Pipeline grid** — KPI cards (`requests`, `cache_hits`,
//!   `decompositions`, `atd_verdicts`) showing the cognitive pipeline's
//!   top-level counters.
//! - **Innovation grid** — KPI cards for the HCM arena (`pairs`,
//!   `capacity`, `state_bytes`) and the semantic memory graph
//!   (`node_count`, `edge_count`, `cache_size`).
//!
//! # Uptime
//!
//! [`uptime_seconds`] returns seconds since the first dashboard render. A
//! `OnceLock<Instant>` lazily captures the start time on the first call so we
//! don't need to thread a startup timestamp through `main` → `AppState` →
//! handler. The small inaccuracy (uptime is "since first dashboard hit", not
//! "since process start") is acceptable for an operator-facing status page.

use std::fmt::Write as _;
use std::sync::OnceLock;
use std::time::Instant;

/// The static start-time anchor used by [`uptime_seconds`]. Lazily
/// initialized on the first call to [`uptime_seconds`] (i.e. the first
/// dashboard render). Stored as `Instant` so the elapsed computation is
/// monotonic and unaffected by wall-clock changes.
static START: OnceLock<Instant> = OnceLock::new();

/// Return the process uptime in seconds, measured from the first call to
/// this function. See the module docs for why this is "since first dashboard
/// render" rather than "since process start".
pub fn uptime_seconds() -> u64 {
    let start = START.get_or_init(Instant::now);
    start.elapsed().as_secs()
}

/// A snapshot of the engine state captured by the
/// [`handlers::dashboard`](crate::handlers::dashboard) handler and rendered
/// into HTML by [`render_dashboard`].
///
/// All fields are owned / `Copy` so the snapshot can be assembled while the
/// various `Arc<Mutex<…>>` locks are held, then released before the HTML
/// string is built (which is a relatively expensive `format!` loop and
/// shouldn't hold locks).
pub struct DashboardData {
    /// Engine display name (always `"Aether Engine"`).
    pub engine_name: &'static str,
    /// Engine version string (currently `"3.0"`).
    pub version: &'static str,
    /// Process uptime in seconds (see [`uptime_seconds`]).
    pub uptime_seconds: u64,
    /// Total nodes in the semantic memory graph.
    pub node_count: usize,
    /// Total directed edges in the graph's adjacency list.
    pub edge_count: usize,
    /// Number of entries in the action cache.
    pub cache_size: usize,
    /// Total cognitive decompositions performed (Stats::decompositions).
    pub decompositions: u64,
    /// Total ATD verdicts issued (Stats::atd_verifications).
    pub atd_verdicts: u64,
    /// HCM arena memory footprint in bytes (always `16 * dim`).
    pub hcm_state_bytes: usize,
    /// Active (key, value) pairs folded into the HCM arena.
    pub hcm_pairs: usize,
    /// HCM theoretical capacity (`dim / 10`) before interference dominates.
    pub hcm_capacity: usize,
    /// Total chat-completion requests received.
    pub requests: u64,
    /// Number of requests served from the action cache (Stage 1 fast-path).
    pub cache_hits: u64,
}

/// Render the dashboard HTML for the given [`DashboardData`] snapshot.
///
/// The output is a complete `<!DOCTYPE html>` document with inline CSS (dark
/// theme, monospace font, no external resources). The caller wraps it in
/// `axum::response::Html(…)` to set the `text/html; charset=utf-8`
/// content-type.
pub fn render_dashboard(data: &DashboardData) -> String {
    let mut s = String::with_capacity(8 * 1024);
    write_html(&mut s, data);
    s
}

/// Write the dashboard HTML into the given string buffer.
///
/// Split out from [`render_dashboard`] so the buffer can be pre-allocated
/// once and reused across the various `write!` calls without re-sizing.
fn write_html(s: &mut String, d: &DashboardData) {
    let _ = writeln!(s, "<!DOCTYPE html>");
    let _ = writeln!(s, "<html lang=\"en\">");
    let _ = writeln!(s, "<head>");
    let _ = writeln!(s, "  <meta charset=\"utf-8\">");
    let _ = writeln!(s, "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
    let _ = writeln!(s, "  <title>{} v{}</title>", esc(d.engine_name), d.version);
    let _ = writeln!(s, "  <style>");
    let _ = writeln!(s, "    * {{ box-sizing: border-box; margin: 0; padding: 0; }}");
    let _ = writeln!(
        s,
        "    body {{ background: #0a0a0f; color: #d4d4d8; font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, monospace; padding: 32px; min-height: 100vh; }}"
    );
    let _ = writeln!(
        s,
        "    h1 {{ color: #a78bfa; font-size: 28px; margin-bottom: 4px; letter-spacing: -0.02em; }}"
    );
    let _ = writeln!(
        s,
        "    .sub {{ color: #71717a; font-size: 13px; margin-bottom: 28px; }}"
    );
    let _ = writeln!(
        s,
        "    .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }}"
    );
    let _ = writeln!(
        s,
        "    .card {{ background: #131318; border: 1px solid #27272a; border-radius: 10px; padding: 18px 20px; }}"
    );
    let _ = writeln!(
        s,
        "    .card .label {{ color: #71717a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }}"
    );
    let _ = writeln!(
        s,
        "    .card .value {{ color: #f4f4f5; font-size: 26px; font-weight: 600; }}"
    );
    let _ = writeln!(
        s,
        "    .card .unit {{ color: #52525b; font-size: 13px; margin-left: 4px; }}"
    );
    let _ = writeln!(
        s,
        "    .section {{ color: #22d3ee; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; margin: 24px 0 12px; }}"
    );
    let _ = writeln!(s, "    .footer {{ color: #52525b; font-size: 11px; margin-top: 32px; }}");
    let _ = writeln!(s, "  </style>");
    let _ = writeln!(s, "</head>");
    let _ = writeln!(s, "<body>");
    let _ = writeln!(s, "  <h1>{} v{}</h1>", esc(d.engine_name), d.version);
    let _ = writeln!(
        s,
        "  <div class=\"sub\">Alpha-OS proprietary inference middleware &middot; uptime {}s</div>",
        d.uptime_seconds
    );

    // --- Pipeline KPIs ---
    let _ = writeln!(s, "  <div class=\"section\">Cognitive Pipeline</div>");
    let _ = writeln!(s, "  <div class=\"grid\">");
    write_card(s, "Requests", &d.requests.to_string(), "");
    write_card(s, "Cache Hits", &d.cache_hits.to_string(), "");
    write_card(s, "Decompositions", &d.decompositions.to_string(), "");
    write_card(s, "ATD Verdicts", &d.atd_verdicts.to_string(), "");
    let _ = writeln!(s, "  </div>");

    // --- Innovation KPIs ---
    let _ = writeln!(s, "  <div class=\"section\">Innovations</div>");
    let _ = writeln!(s, "  <div class=\"grid\">");
    write_card(s, "Graph Nodes", &d.node_count.to_string(), "");
    write_card(s, "Graph Edges", &d.edge_count.to_string(), "");
    write_card(s, "Cache Size", &d.cache_size.to_string(), "entries");
    write_card(
        s,
        "HCM Pairs",
        &d.hcm_pairs.to_string(),
        &format!("/ {} cap", d.hcm_capacity),
    );
    write_card(s, "HCM Memory", &format_bytes(d.hcm_state_bytes), "");
    let _ = writeln!(s, "  </div>");

    let _ = writeln!(
        s,
        "  <div class=\"footer\">Rendered by Aether Engine v3.0 &middot; 10 innovations: HCM &middot; CLT &middot; ATD</div>"
    );
    let _ = writeln!(s, "</body>");
    let _ = writeln!(s, "</html>");
}

/// Write a single KPI card to the buffer. `unit_suffix` is a small label
/// rendered after the value (e.g. `"entries"`, `"/ 100 cap"`); pass an empty
/// string to omit it.
fn write_card(s: &mut String, label: &str, value: &str, unit_suffix: &str) {
    let _ = writeln!(s, "    <div class=\"card\">");
    let _ = writeln!(s, "      <div class=\"label\">{}</div>", esc(label));
    let _ = writeln!(
        s,
        "      <div class=\"value\">{}<span class=\"unit\">{}</span></div>",
        esc(value),
        esc(unit_suffix)
    );
    let _ = writeln!(s, "    </div>");
}

/// Format a byte count as a human-readable string (e.g. "16.0 KB").
fn format_bytes(bytes: usize) -> String {
    let f = bytes as f64;
    if f >= 1_048_576.0 {
        format!("{:.1} MB", f / 1_048_576.0)
    } else if f >= 1024.0 {
        format!("{:.1} KB", f / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

/// HTML-escape a string for safe interpolation into the dashboard template.
/// Only escapes the four characters that matter for HTML text content:
/// `&`, `<`, `>`, `"`. (Single quotes are left alone because we never use
/// them as attribute delimiters in this template.)
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}
