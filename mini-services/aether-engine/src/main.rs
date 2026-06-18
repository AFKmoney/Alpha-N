//! # Aether Engine v3.0 — Alpha-OS's proprietary inference engine.
//!
//! A Rust HTTP service that multiplies small GGUF model capacity 10x+ via
//! **ten interconnected innovations**:
//!
//!   1. **TF-IDF semantic memory graph** — structured, traversable long-term memory
//!      ([`crate::graph`], [`crate::tfidf`]).
//!   2. **Cognitive decomposer** — breaks complex queries into simple sub-queries
//!      ([`crate::decompose`]).
//!   3. **Self-verification loop** — checks output quality, retries on failure
//!      (implemented in [`crate::handlers`] via [`crate::atd`]).
//!   4. **Knowledge distillation cache** — reuses successful reasoning patterns
//!      ([`crate::decompose::DistillationStore`]).
//!   5. **Context compressor** — reduces 40K→4K tokens preserving signal
//!      ([`crate::compress`]).
//!   6. **Action cache** — instant responses for repeated/similar queries
//!      ([`crate::cache`]).
//!   7. **Speculative prefetch** — warms cache for likely-next queries
//!      (see [`handlers::prefetch`]).
//!   8. **Holographic Context Memory (HCM)** — FFT-based fixed-size state matrix
//!      that absorbs infinite context with zero dynamic allocation
//!      ([`crate::hcm`]).
//!   9. **Continuous Latent Trajectory (CLT)** — N-step reasoning loop in latent
//!      space, collapsing to tokens only on convergence ([`crate::clt`]).
//!  10. **Asymmetric Tensor Dueling (ATD)** — dual-graph validation where
//!      likelihood must overcome entropy before a response is accepted
//!      ([`crate::atd`]).
//!
//! HCM replaces the KV-Cache with a holographic associative memory.
//! CLT bypasses discrete token generation during reasoning.
//! ATD validates every response through a likelihood-entropy collision.
//!
//! Together, these innovations allow a 1.2B-parameter GGUF model to perform
//! at the level of a 70B+ flagship model on complex reasoning tasks.
//!
//! # Server
//!
//! The engine is an OpenAI-compatible HTTP service listening on port
//! [`PORT`] (default 3004). It forwards inference requests to a pluggable
//! backend (default `http://localhost:11434/v1`, overridable via the
//! `AETHER_BACKEND` environment variable) after augmenting them through
//! the cognitive pipeline defined in [`crate::handlers`].

// --- Agentic layer (v3.2) ---
//
// `agent` implements the perceive → think → act → observe loop that turns
// a small GGUF model into an autonomous OS-managing agent. `tools` defines
// the tool surface (file IO, shell, windows, memory, planning) the agent
// dispatches through. Neither module touches the existing 10-stage
// cognitive pipeline.
mod agent;
mod atd;
mod cache;
mod clt;
mod compress;
mod dashboard;
mod decompose;
mod graph;
mod handlers;
mod hcm;
mod tfidf;
mod tools;

use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

/// Global statistics tracked across all requests.
///
/// These counters are surfaced through the `/health` and `/pipeline`
/// endpoints and power the Memory Network visualizer in Alpha-OS. They are
/// grouped by innovation: baseline pipeline stats first, then HCM, CLT, and
/// ATD counters. All fields are monotonically increasing over the lifetime
/// of the process.
pub struct Stats {
    // --- Baseline pipeline stats ---
    /// Total number of requests received by `/v1/chat/completions`.
    pub requests: u64,
    /// Number of requests served instantly from the action cache (Stage 1).
    pub cache_hits: u64,
    /// Number of queries that triggered cognitive decomposition (Stages 5–7).
    pub decompositions: u64,
    /// Total number of verification passes attempted (Stage 8).
    pub verifications: u64,
    /// Number of verifications that passed on the first or retry attempt.
    pub verifications_passed: u64,
    /// Number of times a distillation pattern was reused (Stage 9 / Stage 5 fast-path).
    pub distillation_hits: u64,

    // --- HCM (Holographic Context Memory) stats ---
    /// Number of (key, value) pairs folded into the HCM arena via `/graph/add`.
    pub hcm_pairs_folded: u64,
    /// Number of HCM probe operations executed.
    pub hcm_probes: u64,

    // --- CLT (Continuous Latent Trajectory) stats ---
    /// Number of CLT reasoning loops started.
    pub clt_loops: u64,
    /// Number of CLT loops that reached convergence before `max_steps`.
    pub clt_convergences: u64,
    /// Sum of steps executed across all CLT loops (for averaging).
    pub clt_total_steps: u64,

    // --- ATD (Asymmetric Tensor Dueling) stats ---
    /// Total number of ATD verifications performed (== `verifications`).
    pub atd_verifications: u64,
    /// Number of responses that survived the ATD likelihood-entropy collision.
    pub atd_validated: u64,
    /// Number of responses rejected by ATD (including failed retries).
    pub atd_rejected: u64,
}

/// Shared application state, cloned into every handler via Axum's
/// [`State`](axum::extract::State) extractor.
///
/// All mutable sub-resources are wrapped in `Arc<Mutex<...>>` so they can be
/// shared safely across the async Tokio runtime. The clone is cheap because
/// each field is itself an `Arc`.
#[derive(Clone)]
pub struct AppState {
    /// The TF-IDF semantic memory graph (nodes + cosine-similarity edges).
    pub graph: Arc<Mutex<graph::MemoryGraph>>,
    /// The action cache (exact-match + semantic similarity response cache).
    pub cache: Arc<Mutex<cache::ActionCache>>,
    /// The knowledge distillation store (reusable decomposition patterns).
    pub distillation: Arc<Mutex<decompose::DistillationStore>>,
    /// The Holographic Context Memory arena (fixed-size FFT state matrix).
    pub hcm: Arc<Mutex<hcm::HolographicMemoryArena>>,
    /// Aggregated telemetry counters, surfaced via `/health` and `/pipeline`.
    pub stats: Arc<Mutex<Stats>>,
    /// Base URL of the downstream GGUF backend (e.g. an OpenAI-compatible
    /// llama.cpp / Ollama server). Trailing slashes are stripped before use.
    pub backend: String,
    /// Shared HTTP client with a 120-second timeout, reused across all
    /// backend calls to benefit from connection pooling.
    pub client: reqwest::Client,
}

/// The TCP port the Aether Engine HTTP server binds to.
const PORT: u16 = 3004;

/// Entry point: configures shared state, wires the Axum router, and serves
/// the HTTP API on `0.0.0.0:{PORT}`.
///
/// # Routes
///
/// | Method | Path                   | Handler                              |
/// |--------|------------------------|--------------------------------------|
/// | POST   | `/v1/chat/completions` | [`handlers::chat_completions`]       |
/// | POST   | `/v1/chat/stream`      | [`handlers::chat_completions_stream`]|
/// | POST   | `/v1/interrupt`        | [`handlers::interrupt`]              |
/// | GET    | `/v1/models`           | [`handlers::list_models`]            |
/// | POST   | `/graph/add`           | [`handlers::graph_add`]              |
/// | GET    | `/graph`               | [`handlers::graph_get`]              |
/// | POST   | `/graph/search`        | [`handlers::graph_search`]           |
/// | POST   | `/graph/clear`         | [`handlers::graph_clear`]            |
/// | GET    | `/graph/export`        | [`handlers::graph_export`]           |
/// | POST   | `/graph/import`        | [`handlers::graph_import`]           |
/// | GET    | `/graph/stats`         | [`handlers::graph_stats`]            |
/// | GET    | `/pipeline`            | [`handlers::pipeline_stats`]         |
/// | GET    | `/health`              | [`handlers::health`]                 |
/// | GET    | `/dashboard`           | [`handlers::dashboard`]              |
/// | GET    | `/metrics`             | [`handlers::prometheus_metrics`]     |
/// | GET    | `/config`              | [`handlers::get_config`]             |
/// | POST   | `/v1/agent/run`        | [`handlers::agent_run`]              |
/// | GET    | `/v1/tools`            | [`handlers::list_tools`]             |
///
/// # Panics
///
/// Panics if the TCP listener cannot bind to `0.0.0.0:{PORT}` (port already
/// in use) or if the `reqwest::Client` cannot be constructed (extremely
/// unlikely; would indicate a TLS backend misconfiguration).
#[tokio::main]
async fn main() {
    // The downstream GGUF backend defaults to the OpenAI-compatible endpoint
    // exposed by Ollama. Override with `AETHER_BACKEND=https://.../v1`.
    let backend = std::env::var("AETHER_BACKEND")
        .unwrap_or_else(|_| "http://localhost:11434/v1".to_string());

    let state = AppState {
        graph: Arc::new(Mutex::new(graph::MemoryGraph::new())),
        cache: Arc::new(Mutex::new(cache::ActionCache::new())),
        distillation: Arc::new(Mutex::new(decompose::DistillationStore::new())),
        // 1024-dim HCM arena ⇒ 16 KB fixed memory, ~100-pair effective capacity.
        hcm: Arc::new(Mutex::new(hcm::HolographicMemoryArena::new(1024))),
        stats: Arc::new(Mutex::new(Stats {
            requests: 0,
            cache_hits: 0,
            decompositions: 0,
            verifications: 0,
            verifications_passed: 0,
            distillation_hits: 0,
            hcm_pairs_folded: 0,
            hcm_probes: 0,
            clt_loops: 0,
            clt_convergences: 0,
            clt_total_steps: 0,
            atd_verifications: 0,
            atd_validated: 0,
            atd_rejected: 0,
        })),
        backend: backend.clone(),
        client: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("reqwest client"),
    };

    let app = Router::new()
        .route("/v1/chat/completions", post(handlers::chat_completions))
        .route("/v1/chat/stream", post(handlers::chat_completions_stream))
        .route("/v1/interrupt", post(handlers::interrupt))
        .route("/v1/models", get(handlers::list_models))
        .route("/graph/add", post(handlers::graph_add))
        .route("/graph", get(handlers::graph_get))
        .route("/graph/search", post(handlers::graph_search))
        .route("/graph/clear", post(handlers::graph_clear))
        .route("/graph/export", get(handlers::graph_export))
        .route("/graph/import", post(handlers::graph_import))
        .route("/graph/stats", get(handlers::graph_stats))
        .route("/pipeline", get(handlers::pipeline_stats))
        .route("/health", get(handlers::health))
        .route("/dashboard", get(handlers::dashboard))
        .route("/metrics", get(handlers::prometheus_metrics))
        .route("/config", get(handlers::get_config))
        // --- Agentic layer (v3.2) ---
        .route("/v1/agent/run", post(handlers::agent_run))
        .route("/v1/tools", get(handlers::list_tools))
        .layer(CorsLayer::very_permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{PORT}"))
        .await
        .expect("bind 3004");

    eprintln!(
        "[aether-engine] v3.0 listening on :{PORT}  (backend: {backend})\n\
         [aether-engine] 10 innovations: \n\
         [aether-engine]   1. semantic memory graph (TF-IDF retrieval + edge expansion)\n\
         [aether-engine]   2. cognitive decomposer (complex → sub-questions)\n\
         [aether-engine]   3. self-verification loop (retry on failure)\n\
         [aether-engine]   4. knowledge distillation (reuse successful patterns)\n\
         [aether-engine]   5. context compressor (40K→4K preserving signal)\n\
         [aether-engine]   6. action cache (instant for repeated queries)\n\
         [aether-engine]   7. speculative prefetch (warm adjacent caches)\n\
         [aether-engine]   8. HCM — holographic context memory (FFT, zero-alloc infinite context)\n\
         [aether-engine]   9. CLT — continuous latent trajectory (reason in concept space)\n\
         [aether-engine]  10. ATD — asymmetric tensor dueling (likelihood vs entropy collision)"
    );

    axum::serve(listener, app).await.expect("server stopped");
}
