//! # Aether Engine — OpenAI-compatible semantic-memory LLM proxy.
//!
//! Aether Engine fronts a small OpenAI-compatible GGUF backend (default
//! `http://localhost:11434/v1`, i.e. Ollama) and multiplies its effective
//! capacity with a 10-stage cognitive pipeline (see `handlers.rs`): action
//! caching, TF-IDF graph retrieval, context compression, complexity
//! analysis, decomposition with dependency-ordered solving, ATD
//! verification, knowledge distillation and speculative prefetch.
//!
//! # Layout
//!
//! | Module | Role |
//! |---|---|
//! | [`handlers`] | all HTTP handlers + the 10-stage pipeline |
//! | [`agent`] / [`tools`] | autonomous OS-management agentic loop |
//! | [`graph`] / [`tfidf`] | semantic memory graph and its vectors |
//! | [`cache`] | two-tier retrieval cache |
//! | [`compress`] | signal-preserving context compression |
//! | [`decompose`] | question decomposition + distillation |
//! | [`hcm`] | holographic context memory arena |
//! | [`atd`] | Asymmetric Tensor Dueling verifier |
//! | [`clt`] | dormant CLT refinement scaffolding |
//! | [`dashboard`] | self-contained HTML status page |
//! | [`engine`] | native (in-process) GGUF engine |
//!
//! # Runtime configuration
//!
//! - `AETHER_BACKEND` — base URL of the OpenAI-compatible backend
//!   (default `http://localhost:11434/v1`).
//! - `AETHER_MODEL` — `.gguf` file for the native engine; set at runtime
//!   by `POST /admin/reload`.
//! - `AETHER_TOKEN` — optional auth token, snapshotted into
//!   [`AppState`] at startup so no request path reads the environment
//!   (see the THREAD-SAFETY note in `admin_reload`).
//!
//! The server listens on `0.0.0.0:3004` (see [`PORT`]) with permissive
//! CORS so the Alpha-OS Next.js layer can call it from the browser.

mod agent;
mod atd;
mod cache;
mod clt;
mod compress;
mod dashboard;
mod decompose;
mod engine;
mod graph;
mod handlers;
mod hcm;
mod tfidf;
mod tools;

use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use cache::ActionCache;
use decompose::DistillationStore;
use engine::NativeEngine;
use graph::MemoryGraph;
use hcm::Hcm;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Instant;
use tower_http::cors::CorsLayer;

/// TCP port the engine listens on (`0.0.0.0:3004`). Mirrored as the
/// `port` field of `GET /config`.
const PORT: u16 = 3004;

/// Default OpenAI-compatible backend base URL (Ollama's local server).
const DEFAULT_BACKEND: &str = "http://localhost:11434/v1";

/// Context window the native engine is loaded with. Mirrors the `2048`
/// passed by `POST /admin/reload`.
const NATIVE_CONTEXT_SIZE: u32 = 2048;

/// File the `/hcm/save` and `/hcm/load` endpoints persist the HCM arena
/// to (relative to the engine's working directory).
const HCM_STATE_PATH: &str = "hcm-state.json";

/// Character budget for context blocks produced by the `/cache/prefetch`
/// warmer — the same 6000 the pipeline's Stage 3 uses.
const PREFETCH_CONTEXT_BUDGET: usize = 6000;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

/// Global counters for every observable pipeline behavior, surfaced on
/// `/health`, `/pipeline`, `/metrics` and `/dashboard`. All fields are
/// monotonically increasing totals since process start.
#[derive(Debug, Clone, Default)]
pub struct Stats {
    /// Chat-completion requests served (both endpoints).
    pub requests: u64,
    /// Action-cache hits that short-circuited the pipeline (Stage 1).
    pub cache_hits: u64,
    /// Decompositions run (Moderate two-step + Complex pipelines).
    pub decompositions: u64,
    /// Verification passes (first attempt + retry combined).
    pub verifications: u64,
    /// Verifications that passed.
    pub verifications_passed: u64,
    /// Distillation-store lookups that hit a reusable pattern.
    pub distillation_hits: u64,
    /// `(hash(id), hash(text))` pairs folded into the HCM arena.
    pub hcm_pairs_folded: u64,
    /// HCM probe() invocations (resonance lookups).
    pub hcm_probes: u64,
    /// CLT refinement loops started (dormant — see `clt.rs`).
    pub clt_loops: u64,
    /// CLT loops that reached convergence (dormant).
    pub clt_convergences: u64,
    /// Total CLT iteration steps across loops (dormant).
    pub clt_total_steps: u64,
    /// ATD verdicts issued (Stage 8 first attempts).
    pub atd_verifications: u64,
    /// Responses ATD validated (first attempt or retry).
    pub atd_validated: u64,
    /// Responses ATD rejected (both attempts failed).
    pub atd_rejected: u64,
}

/// Shared engine state, cloned into every handler via axum's `State`
/// extractor (every field is an `Arc`, so the clone is shallow).
///
/// Locking discipline: every field is an independent
/// `Arc<tokio::sync::Mutex<…>>`; handlers take them one at a time and
/// never hold two guards at once (the pipeline code in `handlers.rs`
/// documents this explicitly at its Stage-1 cache check).
#[derive(Clone)]
pub struct AppState {
    /// The semantic memory graph (Akasha).
    pub graph: Arc<tokio::sync::Mutex<MemoryGraph>>,
    /// The two-tier retrieval cache (responses + context blocks).
    pub cache: Arc<tokio::sync::Mutex<ActionCache>>,
    /// Global counters (see [`Stats`]).
    pub stats: Arc<tokio::sync::Mutex<Stats>>,
    /// Distilled decomposition patterns for Complex queries.
    pub distillation: Arc<tokio::sync::Mutex<DistillationStore>>,
    /// The Holographic Context Memory arena.
    pub hcm: Arc<tokio::sync::Mutex<Hcm>>,
    /// The native (in-process) GGUF engine, when one is loaded. The outer
    /// mutex is the hot-swap lock held across `/admin/reload`; the inner
    /// `Arc<tokio::sync::Mutex<…>>` is the generation lock acquired
    /// inside `spawn_blocking` by `call_backend`.
    pub native_engine:
        Arc<tokio::sync::Mutex<Option<Arc<tokio::sync::Mutex<NativeEngine>>>>>,
    /// Base URL of the OpenAI-compatible HTTP backend.
    pub backend: String,
    /// Shared HTTP client for backend calls (connection-pooled).
    pub client: reqwest::Client,
    /// `AETHER_TOKEN` snapshotted at startup, if set. Kept here (rather
    /// than read per request) so the process's only environment mutation
    /// — `/admin/reload` setting `AETHER_MODEL` — can never race an
    /// `env::var` read on a request path.
    pub token: Option<String>,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    // Environment snapshot (the only env reads on the startup path).
    let backend =
        std::env::var("AETHER_BACKEND").unwrap_or_else(|_| DEFAULT_BACKEND.to_string());
    let token = std::env::var("AETHER_TOKEN").ok();

    let state = AppState {
        graph: Arc::new(tokio::sync::Mutex::new(MemoryGraph::new())),
        cache: Arc::new(tokio::sync::Mutex::new(ActionCache::new())),
        stats: Arc::new(tokio::sync::Mutex::new(Stats::default())),
        distillation: Arc::new(tokio::sync::Mutex::new(DistillationStore::new())),
        hcm: Arc::new(tokio::sync::Mutex::new(Hcm::new(hcm::HCM_DIM))),
        native_engine: Arc::new(tokio::sync::Mutex::new(None)),
        backend: backend.clone(),
        client: reqwest::Client::new(),
        token: token.clone(),
    };

    // Best-effort native engine load at startup. Same discipline as
    // `/admin/reload`: the (blocking) file work runs on a dedicated
    // blocking thread, and no connection is served until it settles.
    match tokio::task::spawn_blocking(|| NativeEngine::load(NATIVE_CONTEXT_SIZE)).await {
        Ok(Ok(engine)) => {
            *state.native_engine.lock().await =
                Some(Arc::new(tokio::sync::Mutex::new(engine)));
        }
        Ok(Err(reason)) => {
            eprintln!(
                "[aether-engine] native engine unavailable: {reason} \
                 (serving via HTTP backend {backend})"
            );
        }
        Err(e) => {
            eprintln!("[aether-engine] native engine load task failed: {e}");
        }
    }

    // Auth-token snapshot confirmation (reads the AppState field, never
    // the environment — see the field docs).
    match &state.token {
        Some(_) => eprintln!("[aether-engine] AETHER_TOKEN: configured (snapshot taken)"),
        None => eprintln!("[aether-engine] AETHER_TOKEN: not set"),
    }

    let app = Router::new()
        // --- OpenAI-compatible surface ---
        .route("/v1/chat/completions", post(handlers::chat_completions))
        .route("/v1/chat/stream", post(handlers::chat_completions_stream))
        .route("/v1/models", get(handlers::list_models))
        .route("/v1/interrupt", post(handlers::interrupt))
        // --- agentic layer (v3.2) ---
        .route("/v1/agent/run", post(handlers::agent_run))
        .route("/v1/tools", get(handlers::list_tools))
        // --- status & telemetry ---
        .route("/health", get(handlers::health))
        .route("/pipeline", get(handlers::pipeline_stats))
        .route("/dashboard", get(handlers::dashboard))
        .route("/metrics", get(handlers::prometheus_metrics))
        .route("/config", get(handlers::get_config))
        // --- admin ---
        .route("/admin/reload", post(handlers::admin_reload))
        // --- memory graph ---
        .route("/graph", get(handlers::graph_get))
        .route("/graph/add", post(handlers::graph_add))
        .route("/graph/search", post(handlers::graph_search))
        .route("/graph/clear", post(handlers::graph_clear))
        .route("/graph/export", get(handlers::graph_export))
        .route("/graph/import", post(handlers::graph_import))
        .route("/graph/stats", get(handlers::graph_stats))
        // --- cache / decompose / HCM / ATD introspection (this module) ---
        .route("/cache/stats", get(cache_stats))
        .route("/cache/clear", post(cache_clear))
        .route("/cache/prefetch", post(cache_prefetch))
        .route("/decompose", post(decompose_query))
        .route("/hcm/stats", post(hcm_stats))
        .route("/hcm/save", post(hcm_save))
        .route("/hcm/load", post(hcm_load))
        .route("/atd/verify", post(atd_verify))
        .with_state(state)
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", PORT))
        .await
        .unwrap_or_else(|e| panic!("[aether-engine] cannot bind 0.0.0.0:{PORT}: {e}"));
    println!("[aether-engine] v3.0 listening on http://0.0.0.0:{PORT} (backend {backend})");
    if let Err(e) = axum::serve(listener, app).await {
        panic!("[aether-engine] server error: {e}");
    }
}

// ===========================================================================
// Additional introspection endpoints (cache / decompose / HCM / ATD).
//
// These routes predate the v3.x handler layout and live here, next to the
// router, rather than in `handlers.rs`. They are pure reads or explicit
// maintenance actions over AppState — none of them touches the 10-stage
// pipeline.
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /cache/stats
// ---------------------------------------------------------------------------

/// Two-tier cache statistics: per-tier entry counts and the compiled-in
/// similarity thresholds (mirroring `GET /config`).
async fn cache_stats(State(state): State<AppState>) -> impl IntoResponse {
    let c = state.cache.lock().await;
    Json(json!({
        "ok": true,
        "total_entries": c.len(),
        "action_entries": c.action_len(),
        "retrieval_entries": c.retrieval_len(),
        "action_threshold": cache::ACTION_SIMILARITY_THRESHOLD,
        "retrieval_threshold": cache::RETRIEVAL_SIMILARITY_THRESHOLD,
    }))
}

// ---------------------------------------------------------------------------
// POST /cache/clear
// ---------------------------------------------------------------------------

/// Wipe both cache tiers (actions + retrieval contexts). Returns the
/// number of entries that were cleared. Does not touch the graph, the HCM
/// arena or the distillation store.
async fn cache_clear(State(state): State<AppState>) -> impl IntoResponse {
    let mut c = state.cache.lock().await;
    let cleared = c.len();
    c.clear();
    Json(json!({ "ok": true, "cleared": cleared }))
}

// ---------------------------------------------------------------------------
// POST /cache/prefetch
// ---------------------------------------------------------------------------

/// Explicitly warm the retrieval cache. Accepts either
/// `{ "queries": ["…", "…"] }` or a single `{ "query": "…" }`.
///
/// For every query this runs the same Stage-2 + Stage-3 work the pipeline
/// would (graph retrieval + compression) and writes the context block
/// into the retrieval tier, so the next matching request skips straight
/// past the compressor. This is the manual counterpart of the pipeline's
/// Stage-10 speculative prefetcher.
async fn cache_prefetch(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let mut queries: Vec<String> = Vec::new();
    if let Some(list) = body.get("queries").and_then(|q| q.as_array()) {
        for q in list {
            if let Some(s) = q.as_str() {
                if !s.trim().is_empty() {
                    queries.push(s.to_string());
                }
            }
        }
    } else if let Some(q) = body.get("query").and_then(|q| q.as_str()) {
        if !q.trim().is_empty() {
            queries.push(q.to_string());
        }
    }

    let mut warmed = 0usize;
    for q in &queries {
        let (qvec, context) = {
            let g = state.graph.lock().await;
            let qv = g.vectorizer.vectorize(q);
            let retrieved = g.retrieve(q, 8);
            (qv, compress::compress(&retrieved, q, PREFETCH_CONTEXT_BUDGET))
        };
        state.cache.lock().await.put_retrieval(q, qvec, context);
        warmed += 1;
    }

    Json(json!({
        "ok": true,
        "warmed": warmed,
        "total_cache_entries": state.cache.lock().await.len(),
    }))
}

// ---------------------------------------------------------------------------
// POST /decompose
// ---------------------------------------------------------------------------

/// Side-effect-free decomposition preview: classifies the query, checks
/// the distillation store for a reusable pattern (falling back to a fresh
/// decomposition), and returns the full sub-question DAG plus the pipeline
/// bookkeeping a real run would produce.
///
/// Accepts `{ "query": "…" }`; returns `{ ok, complexity,
/// distillation_hit, sub_questions, stages_completed, … }`. Nothing is
/// cached, distilled or counted — the pipeline endpoints own those
/// side effects.
async fn decompose_query(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let query = body
        .get("query")
        .and_then(|q| q.as_str())
        .unwrap_or("")
        .to_string();
    if query.is_empty() {
        return Json(json!({ "ok": false, "error": "missing 'query' field" }));
    }

    let start = Instant::now();
    let (qvec, retrieved) = {
        let g = state.graph.lock().await;
        (g.vectorizer.vectorize(&query), g.retrieve(&query, 8))
    };
    let (sub_questions, distillation_hit) = {
        let distill = state.distillation.lock().await;
        match distill.find(&query, &qvec) {
            Some(subs) => (subs, true),
            None => (decompose::decompose(&query, &retrieved), false),
        }
    };

    let mut pipeline = decompose::PipelineState::new(&query);
    pipeline.complexity = decompose::analyze_complexity(&query);
    pipeline.stages_completed.push("decompose".into());
    if distillation_hit {
        pipeline.stages_completed.push("distillation-hit".into());
    }
    pipeline.sub_questions = sub_questions.clone();
    pipeline.total_latency_ms = start.elapsed().as_millis() as u64;

    Json(json!({
        "ok": true,
        "complexity": pipeline.complexity,
        "distillation_hit": distillation_hit,
        "sub_questions": pipeline.sub_questions,
        "stages_completed": pipeline.stages_completed,
        "synthesis": pipeline.synthesis,
        "verification_passed": pipeline.verification_passed,
        "total_backend_calls": pipeline.total_backend_calls,
        "total_latency_ms": pipeline.total_latency_ms,
    }))
}

// ---------------------------------------------------------------------------
// POST /hcm/stats
// ---------------------------------------------------------------------------

/// HCM arena statistics: dimension, retained pairs vs capacity, serialized
/// state size and the interference estimate.
///
/// Optionally accepts `{ "key": "…" }` in the body to probe the arena's
/// resonance for that key (the `hcm_probes` counter is bumped on every
/// probe — the only place the engine increments it).
async fn hcm_stats(
    State(state): State<AppState>,
    body: Option<Json<Value>>,
) -> impl IntoResponse {
    let (dim, pair_count, capacity, memory_bytes, interference) = {
        let h = state.hcm.lock().await;
        (
            h.dim,
            h.pair_count,
            h.capacity(),
            h.memory_bytes(),
            h.interference(),
        )
    };

    let mut probe = Value::Null;
    if let Some(Json(v)) = body {
        if let Some(key) = v.get("key").and_then(|k| k.as_str()) {
            let activation = {
                let h = state.hcm.lock().await;
                h.probe(&hcm::hash_to_vector(key, h.dim))
            };
            state.stats.lock().await.hcm_probes += 1;
            probe = json!({
                "key": key,
                "activation": (activation * 10000.0).round() / 10000.0,
                "hit": activation >= hcm::PROBE_HIT_THRESHOLD,
            });
        }
    }

    Json(json!({
        "ok": true,
        "dim": dim,
        "pair_count": pair_count,
        "capacity": capacity,
        "memory_bytes": memory_bytes,
        "interference": (interference * 100.0).round() / 100.0,
        "probe": probe,
    }))
}

// ---------------------------------------------------------------------------
// POST /hcm/save
// ---------------------------------------------------------------------------

/// Persist the HCM arena to [`HCM_STATE_PATH`] as pretty-printed JSON
/// (via [`Hcm::to_json`]). Returns the file path, its size in bytes and
/// the number of pairs captured.
async fn hcm_save(State(state): State<AppState>) -> impl IntoResponse {
    let (snapshot, pairs) = {
        let h = state.hcm.lock().await;
        (h.to_json(), h.pair_count)
    };
    match serde_json::to_vec_pretty(&snapshot) {
        Ok(encoded) => match std::fs::write(HCM_STATE_PATH, &encoded) {
            Ok(()) => {
                eprintln!(
                    "[aether-engine] HCM state saved to {HCM_STATE_PATH} ({} bytes)",
                    encoded.len()
                );
                Json(json!({
                    "ok": true,
                    "saved": HCM_STATE_PATH,
                    "bytes": encoded.len(),
                    "pairs": pairs,
                }))
            }
            Err(e) => Json(json!({
                "ok": false,
                "error": format!("cannot write {HCM_STATE_PATH}: {e}"),
            })),
        },
        Err(e) => Json(json!({
            "ok": false,
            "error": format!("cannot serialize HCM state: {e}"),
        })),
    }
}

// ---------------------------------------------------------------------------
// POST /hcm/load
// ---------------------------------------------------------------------------

/// Restore the HCM arena from [`HCM_STATE_PATH`] (a file written by
/// `/hcm/save`), replacing the live arena wholesale. Invalid or missing
/// files leave the current arena untouched and return `ok: false`.
async fn hcm_load(State(state): State<AppState>) -> impl IntoResponse {
    let parsed = std::fs::read_to_string(HCM_STATE_PATH)
        .map_err(|e| format!("cannot read {HCM_STATE_PATH}: {e}"))
        .and_then(|txt| {
            serde_json::from_str::<Value>(&txt).map_err(|e| format!("invalid JSON: {e}"))
        })
        .and_then(|v| hcm::Hcm::from_json(&v));
    match parsed {
        Ok(hcm) => {
            let pairs = hcm.pair_count;
            *state.hcm.lock().await = hcm;
            eprintln!(
                "[aether-engine] HCM state loaded from {HCM_STATE_PATH} ({pairs} pairs)"
            );
            Json(json!({
                "ok": true,
                "loaded": HCM_STATE_PATH,
                "pairs": pairs,
            }))
        }
        Err(e) => Json(json!({ "ok": false, "error": e })),
    }
}

// ---------------------------------------------------------------------------
// POST /atd/verify
// ---------------------------------------------------------------------------

/// Run the ATD verifier on an arbitrary `(response, query)` pair — the
/// same [`atd::verify`] call the pipeline's Stage 8 makes — and return
/// the full verdict (likelihood, entropy, collision delta,
/// recommendation, diagnostics). The ATD counters on [`Stats`] are bumped
/// exactly as the pipeline would.
///
/// Accepts `{ "response": "…", "query": "…" }` (`query` may be empty).
async fn atd_verify(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let response = body
        .get("response")
        .and_then(|r| r.as_str())
        .unwrap_or("")
        .to_string();
    let query = body
        .get("query")
        .and_then(|q| q.as_str())
        .unwrap_or("")
        .to_string();
    if response.is_empty() {
        return Json(json!({ "ok": false, "error": "missing 'response' field" }));
    }

    let config = atd::ATDConfig::default();
    let result = atd::verify(&response, &query, &config);
    {
        let mut stats = state.stats.lock().await;
        stats.atd_verifications += 1;
        if result.validated {
            stats.atd_validated += 1;
        } else {
            stats.atd_rejected += 1;
        }
    }
    Json(atd::result_to_json(&result))
}
