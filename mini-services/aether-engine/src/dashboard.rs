//! # Dashboard — the self-contained HTML status page.
//!
//! [`render_dashboard`] produces the `GET /dashboard` response: a single
//! HTML document with a dark, terminal-inspired aesthetic, **zero external
//! resources** (no CDN, no fonts, no images — every byte of CSS is inline
//! in one `<style>` block), so the page renders identically online and
//! offline, in a browser and in `curl`.
//!
//! # Design tokens
//!
//! - background `#0a0a0f`, cards `#131318` with `#27272a` borders
//! - `h1` in `#a78bfa` (violet), section labels in `#22d3ee` (cyan)
//! - monospace font stack: SF Mono → JetBrains Mono → Fira Code → Consolas
//!
//! # Snapshot flow
//!
//! The `GET /dashboard` handler in `handlers.rs` briefly locks each
//! `Arc<Mutex<…>>` of [`AppState`](crate::AppState), fills a
//! [`DashboardData`] value, and hands it here. This module holds no state
//! of its own except [`PROGRAM_START`], the lazy program-start `Instant`
//! behind [`uptime_seconds`].

use std::fmt::Write as _;
use std::sync::OnceLock;
use std::time::Instant;

/// Program start, captured lazily on the first [`uptime_seconds`] call
/// (within milliseconds of process start, since the dashboard renders the
/// uptime card on every request).
static PROGRAM_START: OnceLock<Instant> = OnceLock::new();

// ---------------------------------------------------------------------------
// DashboardData
// ---------------------------------------------------------------------------

/// One point-in-time snapshot of the engine's observable state, gathered
/// by the `GET /dashboard` handler and rendered by
/// [`render_dashboard`]. Field types mirror exactly what the handler
/// reads out of [`AppState`](crate::AppState).
#[derive(Debug, Clone)]
pub struct DashboardData {
    /// Engine display name (`"Aether Engine"`).
    pub engine_name: &'static str,
    /// Engine version string (`"3.0"`).
    pub version: &'static str,
    /// Seconds since process start (see [`uptime_seconds`]).
    pub uptime_seconds: u64,
    /// Nodes in the semantic memory graph.
    pub node_count: usize,
    /// Directed edges in the graph adjacency list.
    pub edge_count: usize,
    /// Entries across both cache tiers.
    pub cache_size: usize,
    /// Cognitive decompositions performed (Moderate + Complex runs).
    pub decompositions: u64,
    /// ATD verdicts issued (Stage-8 verifications, including retries).
    pub atd_verdicts: u64,
    /// Serialized size of the HCM arena in bytes.
    pub hcm_state_bytes: usize,
    /// Pairs currently retained in the HCM arena.
    pub hcm_pairs: usize,
    /// Maximum pairs the HCM arena retains.
    pub hcm_capacity: usize,
    /// Total chat-completion requests served.
    pub requests: u64,
    /// Action-cache hits served (Stage-1 short-circuits).
    pub cache_hits: u64,
}

// ---------------------------------------------------------------------------
// Uptime
// ---------------------------------------------------------------------------

/// Seconds elapsed since program start. The start `Instant` is captured
/// lazily via a [`OnceLock`] so the module needs no constructor and no
/// `static_init` machinery.
pub fn uptime_seconds() -> u64 {
    PROGRAM_START.get_or_init(Instant::now).elapsed().as_secs()
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/// Render a full standalone dark-theme HTML page for `data`.
///
/// Every `writeln!` result is explicitly bound to `let _ =` (formatting
/// into a `String` is infallible, but `fmt::Write` still returns
/// `Result`), and every literal `{`/`}` inside `writeln!` format strings
/// is escaped as `{{`/`}}` — most notably in the CSS block.
pub fn render_dashboard(data: &DashboardData) -> String {
    let mut html = String::with_capacity(8 * 1024);

    let _ = writeln!(html, "<!DOCTYPE html>");
    let _ = writeln!(html, "<html lang=\"en\">");
    write_html(&mut html, "<head>");
    write_html(&mut html, "<meta charset=\"utf-8\">");
    write_html(&mut html, "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
    write_html(&mut html, "<title>Aether Engine — status</title>");
    write_html(&mut html, "<style>");
    let _ = writeln!(html, "  body {{ margin: 0; background: #0a0a0f; color: #e4e4e7; font-family: \"SF Mono\", \"JetBrains Mono\", \"Fira Code\", Consolas, monospace; padding: 32px 24px; }}");
    let _ = writeln!(html, "  h1 {{ color: #a78bfa; font-size: 22px; margin: 0 0 4px 0; letter-spacing: 0.5px; }}");
    let _ = writeln!(html, "  .sub {{ color: #71717a; font-size: 12px; margin: 0 0 28px 0; }}");
    let _ = writeln!(html, "  h2 {{ color: #22d3ee; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; margin: 28px 0 10px 0; border-bottom: 1px solid #27272a; padding-bottom: 6px; }}");
    let _ = writeln!(html, "  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }}");
    let _ = writeln!(html, "  .card {{ background: #131318; border: 1px solid #27272a; border-radius: 6px; padding: 12px 14px; }}");
    let _ = writeln!(html, "  .card .label {{ color: #71717a; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }}");
    let _ = writeln!(html, "  .card .value {{ color: #e4e4e7; font-size: 18px; margin-top: 4px; word-break: break-all; }}");
    write_html(&mut html, "</style>");
    write_html(&mut html, "</head>");
    write_html(&mut html, "<body>");

    // Header.
    write_html(&mut html, &format!("<h1>{}</h1>", esc(data.engine_name)));
    let (h, m, s) = (
        data.uptime_seconds / 3600,
        (data.uptime_seconds % 3600) / 60,
        data.uptime_seconds % 60,
    );
    write_html(
        &mut html,
        &format!(
            "<p class=\"sub\">v{} · uptime {}h {}m {}s · self-contained status page</p>",
            esc(data.version),
            h,
            m,
            s
        ),
    );

    // Memory graph section.
    write_html(&mut html, "<h2>Memory graph</h2>");
    write_html(&mut html, "<div class=\"grid\">");
    write_card(&mut html, "nodes", &data.node_count.to_string());
    write_card(&mut html, "edges (directed)", &data.edge_count.to_string());
    write_html(&mut html, "</div>");

    // Caches section.
    write_html(&mut html, "<h2>Caches</h2>");
    write_html(&mut html, "<div class=\"grid\">");
    write_card(&mut html, "cache entries", &data.cache_size.to_string());
    write_card(&mut html, "cache hits", &data.cache_hits.to_string());
    write_html(&mut html, "</div>");

    // Cognitive pipeline section.
    write_html(&mut html, "<h2>Cognitive pipeline</h2>");
    write_html(&mut html, "<div class=\"grid\">");
    write_card(&mut html, "requests", &data.requests.to_string());
    write_card(&mut html, "decompositions", &data.decompositions.to_string());
    write_card(&mut html, "atd verdicts", &data.atd_verdicts.to_string());
    write_html(&mut html, "</div>");

    // Holographic memory section.
    write_html(&mut html, "<h2>Holographic memory (HCM)</h2>");
    write_html(&mut html, "<div class=\"grid\">");
    write_card(&mut html, "state size", &format_bytes(data.hcm_state_bytes as u64));
    write_card(
        &mut html,
        "pairs",
        &format!("{} / {}", data.hcm_pairs, data.hcm_capacity),
    );
    write_card(&mut html, "capacity", &data.hcm_capacity.to_string());
    write_html(&mut html, "</div>");

    write_html(&mut html, "</body>");
    write_html(&mut html, "</html>");
    html
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Append one pre-rendered HTML line (no format placeholders involved), so
/// the renderer body stays free of `push_str(&format!(…))` noise.
fn write_html(out: &mut String, html: &str) {
    out.push_str(html);
    out.push('\n');
}

/// Append one stat card: a labeled value inside the shared `.card` style.
fn write_card(out: &mut String, label: &str, value: &str) {
    let _ = writeln!(
        out,
        "<div class=\"card\"><div class=\"label\">{}</div><div class=\"value\">{}</div></div>",
        esc(label),
        esc(value)
    );
}

/// Human-readable byte size: `B`, `KiB`, `MiB`, `GiB` (one decimal place
/// above 1 KiB). Used for the HCM state-size card.
fn format_bytes(n: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KiB", "MiB", "GiB"];
    let mut size = n as f64;
    let mut unit = 0usize;
    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{n} {}", UNITS[unit])
    } else {
        format!("{size:.1} {}", UNITS[unit])
    }
}

/// HTML-escape `s` (`&`, `<`, `>`, `"`, `'`) so any engine- or
/// caller-controlled string can be embedded safely. The dashboard's own
/// labels and values are trusted today, but escaping is cheap insurance
/// against a future field carrying memory text.
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
    out
}
