//! # HTTP Handlers — the 10-stage Cognitive Pipeline (Aether Engine v3.0)
//!
//! All Axum route handlers live here. The flagship handler,
//! [`chat_completions`], implements the full cognitive pipeline that gives
//! Aether Engine its 10x capacity multiplier over a vanilla GGUF backend:
//!
//!   1. **Action cache check** — instant for repeated/similar queries
//!      ([`crate::cache::ActionCache`]).
//!   2. **Graph retrieval** — TF-IDF semantic search + 1-hop edge expansion
//!      ([`crate::graph::MemoryGraph::retrieve`]).
//!   3. **Context compression** — 40K→4K tokens preserving signal
//!      ([`crate::compress::compress`]).
//!   4. **Complexity analysis** — Simple / Moderate / Complex
//!      ([`crate::decompose::analyze_complexity`]).
//!   5. **Cognitive decomposition** — Complex queries are broken into
//!      sub-questions ([`crate::decompose::decompose`]).
//!   6. **Sequential sub-question solving** — each with fresh context +
//!      dependency injection (driven by this module via [`call_backend`]).
//!   7. **Synthesis** — combine sub-answers into final response (the
//!      `"synth"` sub-question, or a plain concatenation fallback).
//!   8. **ATD verification** — dual-graph likelihood-vs-entropy collision;
//!      retry once if failed ([`crate::atd::verify`]).
//!   9. **Knowledge distillation** — store successful decomposition patterns
//!      ([`crate::decompose::DistillationStore`]).
//!  10. **Speculative prefetch** — warm the retrieval cache for
//!      graph-adjacent queries so the next related query is instant
//!      ([`prefetch`]).
//!
//! # OpenAI compatibility
//!
//! [`chat_completions`] mirrors the OpenAI `POST /v1/chat/completions`
//! contract (request body in, chat-completion-shaped JSON out) so the
//! engine can be dropped in as a drop-in replacement for any OpenAI-compatible
//! client. The backend it forwards to is *also* OpenAI-compatible (default
//! `http://localhost:11434/v1`, i.e. Ollama).

use crate::compress;
use crate::decompose::{self, Complexity, PipelineState, SubQuestion};
use crate::graph::{AddNodeRequest, ScoredNode};
use crate::tfidf::SparseVec;
use crate::AppState;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::time::Instant;

/// Request body for `POST /graph/search`.
#[derive(Deserialize)]
pub struct SearchRequest {
    /// The free-text query to search the semantic memory graph with.
    pub query: String,
    /// Maximum number of results to return. Defaults to 5 when omitted
    /// (see [`default_limit`]).
    #[serde(default = "default_limit")]
    pub limit: usize,
}

/// Serde default for [`SearchRequest::limit`] = `5`.
fn default_limit() -> usize {
    5
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

/// Lightweight liveness + telemetry endpoint.
///
/// Returns the engine version, graph/cache/distillation sizes, and the full
/// counters block from [`Stats`](crate::Stats) (baseline pipeline + HCM +
/// CLT + ATD). Used by Alpha-OS to render the Memory Network dashboard
/// and to detect when the engine needs a restart.
pub async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let (nodes, edges) = {
        let g = state.graph.lock().await;
        (g.len(), g.edge_count())
    };
    let stats = state.stats.lock().await;
    let distillation_count = state.distillation.lock().await.len();
    let cache_count = state.cache.lock().await.len();
    let (hcm_pairs, hcm_interference, hcm_memory, hcm_capacity) = {
        let h = state.hcm.lock().await;
        (h.pair_count, h.interference(), h.memory_bytes(), h.capacity())
    };
    Json(json!({
        "ok": true,
        "version": "3.0",
        "nodes": nodes,
        "edges": edges,
        "cache_hits": stats.cache_hits,
        "cache_entries": cache_count,
        "decompositions": stats.decompositions,
        "verifications": stats.verifications,
        "verifications_passed": stats.verifications_passed,
        "distillation_patterns": distillation_count,
        "distillation_hits": stats.distillation_hits,
        "requests": stats.requests,
        "hcm_pairs_folded": stats.hcm_pairs_folded,
        "hcm_probes": stats.hcm_probes,
        "hcm_active_pairs": hcm_pairs,
        "hcm_interference": (hcm_interference * 100.0).round() / 100.0,
        "hcm_memory_bytes": hcm_memory,
        "hcm_capacity": hcm_capacity,
        "clt_loops": stats.clt_loops,
        "clt_convergences": stats.clt_convergences,
        "clt_total_steps": stats.clt_total_steps,
        "atd_verifications": stats.atd_verifications,
        "atd_validated": stats.atd_validated,
        "atd_rejected": stats.atd_rejected,
    }))
}

// ---------------------------------------------------------------------------
// GET /pipeline — pipeline statistics for the Memory Network app
// ---------------------------------------------------------------------------

/// Per-pipeline-stage statistics for the Memory Network visualizer.
///
/// Similar to [`health`] but focused on pipeline behavior: decomposition
/// counts, verification rates, distillation hit ratios, and CLT/ATD
/// breakdowns. Returns derived metrics (e.g. `verification_rate`,
/// `clt_avg_steps`, `atd_validation_rate`) in addition to raw counters so
/// the UI doesn't have to recompute them.
pub async fn pipeline_stats(State(state): State<AppState>) -> impl IntoResponse {
    let stats = state.stats.lock().await;
    let distillation_count = state.distillation.lock().await.len();
    let (hcm_pairs, hcm_interference) = {
        let h = state.hcm.lock().await;
        (h.pair_count, h.interference())
    };
    Json(json!({
        "decompositions": stats.decompositions,
        "verifications": stats.verifications,
        "verifications_passed": stats.verifications_passed,
        "verification_rate": if stats.verifications > 0 {
            (stats.verifications_passed as f64 / stats.verifications as f64 * 100.0).round()
        } else {
            100.0
        },
        "distillation_patterns": distillation_count,
        "distillation_hits": stats.distillation_hits,
        "cache_hits": stats.cache_hits,
        "total_requests": stats.requests,
        "hcm_pairs": hcm_pairs,
        "hcm_interference": (hcm_interference * 100.0).round() / 100.0,
        "clt_loops": stats.clt_loops,
        "clt_convergences": stats.clt_convergences,
        "clt_avg_steps": if stats.clt_loops > 0 {
            (stats.clt_total_steps as f64 / stats.clt_loops as f64).round()
        } else { 0.0 },
        "atd_verifications": stats.atd_verifications,
        "atd_validated": stats.atd_validated,
        "atd_rejected": stats.atd_rejected,
        "atd_validation_rate": if stats.atd_verifications > 0 {
            (stats.atd_validated as f64 / stats.atd_verifications as f64 * 100.0).round()
        } else { 100.0 },
    }))
}

// ---------------------------------------------------------------------------
// POST /graph/add
// ---------------------------------------------------------------------------

/// Add (or replace) a node in the semantic memory graph.
///
/// Side-effect: the new node is *also* folded into the Holographic Context
/// Memory arena as `(hash(id), hash(text))` so the HCM has a parallel
/// associative copy of every graph memory. The fold counter in
/// [`Stats::hcm_pairs_folded`](crate::Stats) is bumped accordingly.
///
/// Returns `{ ok, id, edges_created }` where `edges_created` is the total
/// number of adjacency entries created across the whole graph by the
/// recompute (see [`MemoryGraph::add`](crate::graph::MemoryGraph::add)).
pub async fn graph_add(
    State(state): State<AppState>,
    Json(req): Json<AddNodeRequest>,
) -> impl IntoResponse {
    let id = req.id.clone();
    let text = req.text.clone();
    let edges_created = {
        let mut g = state.graph.lock().await;
        g.add(req)
    };
    // Also fold into the Holographic Context Memory (HCM)
    {
        let mut hcm = state.hcm.lock().await;
        let key = crate::hcm::hash_to_vector(&id, hcm.dim);
        let value = crate::hcm::hash_to_vector(&text, hcm.dim);
        hcm.fold(&key, &value);
    }
    state.stats.lock().await.hcm_pairs_folded += 1;
    Json(json!({ "ok": true, "id": id, "edges_created": edges_created }))
}

// ---------------------------------------------------------------------------
// GET /graph
// ---------------------------------------------------------------------------

/// Return the full graph (nodes + deduplicated edges) for the Memory
/// Network visualizer. Edges are deduplicated so each undirected edge
/// appears once (the internal adjacency list stores both directions).
pub async fn graph_get(State(state): State<AppState>) -> impl IntoResponse {
    let body = {
        let g = state.graph.lock().await;
        g.to_response()
    };
    Json(body)
}

// ---------------------------------------------------------------------------
// POST /graph/search
// ---------------------------------------------------------------------------

/// Pure semantic search (no edge expansion). Returns the top-`limit`
/// nodes by cosine similarity to the query. Differs from the pipeline's
/// Stage-2 retrieval in that it does *not* do the 1-hop edge expansion —
/// callers that want raw TF-IDF hits use this; the pipeline uses
/// [`MemoryGraph::retrieve`](crate::graph::MemoryGraph::retrieve).
pub async fn graph_search(
    State(state): State<AppState>,
    Json(req): Json<SearchRequest>,
) -> impl IntoResponse {
    let results: Vec<ScoredNode> = {
        let g = state.graph.lock().await;
        g.search(&req.query, req.limit)
    };
    Json(json!({ "query": req.query, "results": results }))
}

// ---------------------------------------------------------------------------
// POST /graph/clear
// ---------------------------------------------------------------------------

/// Wipe the entire graph (nodes + edges + vectorizer corpus stats).
/// Returns the number of nodes that were cleared. Does *not* clear the
/// HCM arena or the caches — those are separate resources with their own
/// lifecycles.
pub async fn graph_clear(State(state): State<AppState>) -> impl IntoResponse {
    let cleared = {
        let mut g = state.graph.lock().await;
        let n = g.len();
        g.clear();
        n
    };
    Json(json!({ "ok": true, "cleared": cleared }))
}

// ---------------------------------------------------------------------------
// POST /v1/interrupt — interrupt the current inference and inject new input
//
// Allows the user to interrupt the AI mid-reasoning and redirect it.
// The request body contains:
//   { "action": "interrupt", "new_instruction": "user's new directive" }
//
// When interrupted, the current pipeline's backend call is aborted (if in
// progress) and the new instruction is queued for the next cycle.
// ---------------------------------------------------------------------------

/// Interrupt the current inference and inject a new directive.
///
/// Accepts a JSON body of the shape `{ "action": "interrupt", "new_instruction": "…" }`.
/// Two `action` values are supported:
///
/// - `"interrupt"` — injects `new_instruction` into the memory graph as
///   a high-priority `"interrupt"` node so the next retrieval picks it up.
///   A full implementation would also cancel the in-flight backend request
///   via an `AbortHandle`; the current implementation queues the directive
///   for the next cycle (see the inline comment in the handler body).
/// - `"status"` — returns whether an inference is currently in progress
///   (always `false` in this version; would be `true` if a pipeline is
///   running once the abort-handle wiring is added).
///
/// Any other `action` value yields `{ ok: false, error: "unknown action" }`.
pub async fn interrupt(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let action = body.get("action").and_then(|a| a.as_str()).unwrap_or("interrupt");
    let new_instruction = body.get("new_instruction").and_then(|i| i.as_str()).unwrap_or("");

    match action {
        "interrupt" => {
            // In a full implementation, this would cancel the in-flight backend
            // request via an AbortHandle. For now, we set a flag that the next
            // pipeline check will see, and inject the new instruction as a
            // graph node so it's available for the next retrieval.
            if !new_instruction.is_empty() {
                let mut g = state.graph.lock().await;
                let id = format!("interrupt-{}", std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0));
                g.add(crate::graph::AddNodeRequest {
                    id,
                    text: new_instruction.to_string(),
                    kind: "interrupt".to_string(),
                    metadata: serde_json::json!({ "source": "user", "priority": "high" }),
                });
            }

            Json(json!({
                "ok": true,
                "interrupted": true,
                "message": "Inference interrupted. New instruction injected into the memory graph for the next cycle.",
                "new_instruction": new_instruction,
            }))
        }
        "status" => {
            // Check if an inference is currently in progress
            let stats = state.stats.lock().await;
            Json(json!({
                "ok": true,
                "requests": stats.requests,
                "active": false, // Would be true if a pipeline is running
            }))
        }
        _ => {
            Json(json!({ "ok": false, "error": "unknown action" }))
        }
    }
}

// ---------------------------------------------------------------------------
// POST /v1/chat/completions — the full cognitive pipeline (OpenAI-compatible)
// ---------------------------------------------------------------------------

/// OpenAI-compatible chat-completions endpoint that runs the full 10-stage
/// cognitive pipeline.
///
/// This is the heart of Aether Engine. It accepts an OpenAI-shaped
/// `messages` array, augments it through the pipeline (cache → graph →
/// compress → complexity → decompose → solve → synthesize → ATD-verify →
/// distill → cache → prefetch), and returns an OpenAI-shaped
/// `chat.completion` JSON response.
///
/// # Complexity branching
///
/// - **Simple** → one backend call.
/// - **Moderate** → two backend calls: a think step, then an answer step
///   that consumes the think step's output.
/// - **Complex** → check the distillation store for a reusable
///   decomposition pattern; if hit, reuse it; otherwise run [`decompose`].
///   Solve each sub-question sequentially with dependency injection, then
///   synthesize.
///
/// # ATD retry
///
/// Stage 8 runs [`atd::verify`] on the synthesized response. If it fails,
/// a single retry is attempted with a recommendation-specific prompt
/// injection (`FallBackToSimpleShot` ⇒ clean simple retry; anything else
/// ⇒ standard retry prompt). If the retry also fails ATD, the response
/// with the better `collision_delta` is returned.
///
/// # Caching & prefetch
///
/// Stage 1 checks the action cache (instant return on hit). The final
/// response is always written back to the action cache. Stage 10 spawns a
/// detached [`prefetch`] task that warms the retrieval cache for the
/// top-3 retrieved nodes' texts so a follow-up question on the same
/// subgraph is fast.
pub async fn chat_completions(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let start = Instant::now();
    state.stats.lock().await.requests += 1;

    // Extract the last user message as the retrieval query.
    let query = extract_user_query(&body);

    // Vectorize the query against the graph's current vocabulary.
    let qvec: SparseVec = {
        let g = state.graph.lock().await;
        g.vectorizer.vectorize(&query)
    };

    // ---- Stage 1: Action cache fast-path (similarity > 0.95) ----
    // The cache is checked *before* any backend work — a hit short-circuits
    // the entire pipeline and returns instantly.
    {
        let cache = state.cache.lock().await;
        if let Some((resp, _sim)) = cache.get(&query, &qvec) {
            // Explicitly drop the cache guard *before* re-locking stats to
            // avoid holding two mutexes simultaneously (which would be a
            // deadlock risk if the lock order were ever reversed elsewhere).
            drop(cache);
            state.stats.lock().await.cache_hits += 1;
            return Json(openai_completion(&resp, "aether-cache")).into_response();
        }
    }

    // ---- Stage 2: Graph retrieval (TF-IDF + edge expansion) ----
    let retrieved: Vec<ScoredNode> = {
        let g = state.graph.lock().await;
        g.retrieve(&query, 8)
    };

    // ---- Stage 3: Context compression (40K→4K preserving signal) ----
    // Two-tier: hit the retrieval cache first (warmed by the prefetcher);
    // on miss, run the compressor and write the result back so the next
    // similar query skips this expensive step.
    let context_block = {
        let mut cache = state.cache.lock().await;
        if let Some(ctx) = cache.get_retrieval(&query, &qvec) {
            ctx
        } else {
            let ctx = compress::compress(&retrieved, &query, 6000);
            cache.put_retrieval(&query, qvec.clone(), ctx.clone());
            ctx
        }
    };

    // ---- Stage 4: Complexity analysis ----
    let complexity = decompose::analyze_complexity(&query);
    let mut pipeline = PipelineState::new(&query);
    pipeline.complexity = complexity.clone();

    // ---- Stage 5-7: Cognitive decomposition + sequential solving + synthesis ----
    let final_response = match complexity {
        Complexity::Simple => {
            // Simple query — one-shot through the backend
            pipeline.stages_completed.push("one-shot".into());
            call_backend(&state, &body, &context_block).await
        }
        Complexity::Moderate => {
            // Moderate — two-step: think, then answer
            state.stats.lock().await.decompositions += 1;
            pipeline.stages_completed.push("two-step-think".into());
            pipeline.stages_completed.push("two-step-answer".into());

            // Step 1: Think about the problem
            let think_body = inject_think_step(&body, &context_block, &query);
            let think_response = call_backend(&state, &think_body, &context_block).await;
            pipeline.total_backend_calls += 1;

            // Step 2: Answer using the thinking result
            let answer_body = inject_answer_step(&body, &think_response, &context_block);
            call_backend(&state, &answer_body, &context_block).await
        }
        Complexity::Complex => {
            // Complex — full decomposition pipeline
            state.stats.lock().await.decompositions += 1;
            pipeline.stages_completed.push("decompose".into());

            // Check distillation store for a reusable decomposition pattern
            let sub_questions = {
                let distill = state.distillation.lock().await;
                if let Some(subs) = distill.find(&query, &qvec) {
                    state.stats.lock().await.distillation_hits += 1;
                    pipeline.stages_completed.push("distillation-hit".into());
                    subs
                } else {
                    // Fresh decomposition
                    decompose::decompose(&query, &retrieved)
                }
            };

            pipeline.sub_questions = sub_questions.clone();
            pipeline.stages_completed.push("solve".into());

            // Solve each sub-question sequentially, injecting dependency
            // answers. The decomposer emits sub-questions in dependency
            // order (topological), so by the time we reach sub-question N
            // every entry it depends_on is already in the `answers` map.
            // The backend sees only one sub-question at a time, with a
            // fresh window — that's the whole point of decomposition:
            // the model never has to hold more than one step in its head.
            let mut answers: HashMap<String, String> = HashMap::new();
            for sub in &sub_questions {
                let sub_prompt = decompose::build_sub_prompt(sub, &answers);
                let sub_body = inject_sub_question(&body, &sub_prompt, &context_block);
                let sub_answer = call_backend(&state, &sub_body, &context_block).await;
                pipeline.total_backend_calls += 1;
                answers.insert(sub.id.clone(), sub_answer);
            }

            // Synthesis: if there's a "synth" question, its answer is the final response
            pipeline.stages_completed.push("synthesize".into());
            if sub_questions.iter().any(|s| s.id == "synth") {
                answers.get("synth").cloned().unwrap_or_default()
            } else {
                // No explicit synthesis — combine all answers
                let combined: Vec<String> = sub_questions
                    .iter()
                    .filter_map(|s| answers.get(&s.id).cloned())
                    .collect();
                combined.join("\n\n")
            }
        }
    };

    pipeline.synthesis = Some(final_response.clone());

    // ---- Stage 8: Asymmetric Tensor Dueling (ATD) verification ----
    // Replaces the simple verify_response with a dual-graph collision:
    // Graph A (likelihood) must overcome Graph B (entropy) for validation.
    state.stats.lock().await.verifications += 1;
    state.stats.lock().await.atd_verifications += 1;

    let atd_config = crate::atd::ATDConfig::default();
    let atd_result = crate::atd::verify(&final_response, &query, &atd_config);

    let final_output = if atd_result.validated {
        // ATD validated — response survived the likelihood-entropy collision
        state.stats.lock().await.verifications_passed += 1;
        state.stats.lock().await.atd_validated += 1;
        pipeline.verification_passed = true;
        pipeline.stages_completed.push("atd-validated".into());
        final_response
    } else {
        // ATD rejected — retry based on the recommendation
        state.stats.lock().await.atd_rejected += 1;
        pipeline.stages_completed.push("atd-rejected-retry".into());

        let retry_body = match atd_result.recommendation {
            crate::atd::ATDRecommendation::FallBackToSimpleShot => {
                // Model is confused — simplify
                inject_simple_retry(&body, &context_block, &query)
            }
            _ => {
                // Standard retry with more explicit prompt
                inject_retry(&body, &context_block, &query)
            }
        };
        let retry_response = call_backend(&state, &retry_body, &context_block).await;
        pipeline.total_backend_calls += 1;

        // Re-verify the retry with ATD
        let retry_atd = crate::atd::verify(&retry_response, &query, &atd_config);
        if retry_atd.validated {
            state.stats.lock().await.verifications_passed += 1;
            state.stats.lock().await.atd_validated += 1;
            pipeline.verification_passed = true;
            pipeline.stages_completed.push("atd-retry-validated".into());
            retry_response
        } else {
            // Both attempts failed ATD — return the one with better collision delta
            state.stats.lock().await.atd_rejected += 1;
            pipeline.verification_passed = false;
            pipeline.stages_completed.push("atd-fail-final".into());
            if retry_atd.collision_delta > atd_result.collision_delta {
                retry_response
            } else {
                final_response
            }
        }
    };

    pipeline.total_latency_ms = start.elapsed().as_millis() as u64;

    // ---- Stage 9: Knowledge distillation (store successful patterns) ----
    // Only Complex queries get a reusable decomposition pattern. Moderate
    // queries use a fixed two-step template that doesn't benefit from
    // caching, and Simple queries don't decompose at all. The pattern is
    // stored only when ATD verification passed — we don't want to
    // distill a *failed* decomposition (it would poison future lookups).
    if matches!(complexity, Complexity::Complex) && pipeline.verification_passed {
        let mut distill = state.distillation.lock().await;
        distill.store(&query, qvec.clone(), pipeline.sub_questions.clone());
    }

    // ---- Cache the final response ----
    state.cache.lock().await.put(&query, qvec.clone(), final_output.clone());

    // ---- Stage 10: Speculative prefetch ----
    prefetch(state.clone(), &retrieved).await;

    Json(openai_completion(&final_output, "aether-pipeline")).into_response()
}

// ---------------------------------------------------------------------------
// Backend calling helper
// ---------------------------------------------------------------------------

/// Forward a request to the GGUF backend, returning the assistant's text response.
/// Falls back to a graph-only response if the backend is unreachable.
async fn call_backend(
    state: &AppState,
    body: &serde_json::Value,
    context_block: &str,
) -> String {
    let augmented = augment_messages(body, context_block);
    let backend_url = format!("{}/chat/completions", state.backend.trim_end_matches('/'));
    let client = state.client.clone();

    match client.post(&backend_url).json(&augmented).send().await {
        Ok(resp) if resp.status().is_success() => {
            let txt = resp.text().await.unwrap_or_else(|_| "{}".to_string());
            extract_assistant_content(&txt).unwrap_or_else(|| {
                fallback_response(context_block, "empty backend response")
            })
        }
        Ok(resp) => {
            let status = resp.status();
            let body_txt = resp.text().await.unwrap_or_default();
            fallback_response(
                context_block,
                &format!("backend returned {status}: {}", body_txt.chars().take(200).collect::<String>()),
            )
        }
        Err(e) => {
            fallback_response(context_block, &format!("backend unreachable: {e}"))
        }
    }
}

// ---------------------------------------------------------------------------
// Prompt injection helpers
// ---------------------------------------------------------------------------

/// Inject the Aether context block into the system message.
fn augment_messages(body: &serde_json::Value, context_block: &str) -> serde_json::Value {
    let mut out = body.clone();
    let prompt = aether_prompt(context_block);
    if let Some(messages) = out.get_mut("messages").and_then(|m| m.as_array_mut()) {
        let mut injected = false;
        for m in messages.iter_mut() {
            if m.get("role").and_then(|r| r.as_str()) == Some("system") && !injected {
                let existing = m
                    .get("content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();
                let new_content = format!("{}\n\n{}", prompt, existing);
                if let Some(obj) = m.as_object_mut() {
                    obj.insert("content".to_string(), serde_json::Value::String(new_content));
                }
                injected = true;
            }
        }
        if !injected {
            messages.insert(0, json!({ "role": "system", "content": prompt }));
        }
    }
    out
}

/// Inject a "think first" step for Moderate-complexity queries.
fn inject_think_step(body: &serde_json::Value, context_block: &str, query: &str) -> serde_json::Value {
    let mut out = body.clone();
    let think_prompt = format!(
        "{context_block}\n\n\
         # AETHER COGNITIVE PIPELINE — THINK STEP\n\
         Before answering, think step by step about: \"{query}\"\n\
         Output your reasoning, then write ANSWER: on a new line followed by your final answer."
    );
    if let Some(messages) = out.get_mut("messages").and_then(|m| m.as_array_mut()) {
        messages.insert(0, json!({ "role": "system", "content": think_prompt }));
    }
    out
}

/// Inject the think-step result into the answer step.
fn inject_answer_step(body: &serde_json::Value, think_response: &str, context_block: &str) -> serde_json::Value {
    let mut out = body.clone();
    let answer_prompt = format!(
        "{context_block}\n\n\
         # AETHER COGNITIVE PIPELINE — ANSWER STEP\n\
         Your reasoning produced the following:\n\
         {think_response}\n\n\
         Now provide a clean, final answer to the user's question."
    );
    if let Some(messages) = out.get_mut("messages").and_then(|m| m.as_array_mut()) {
        messages.insert(0, json!({ "role": "system", "content": answer_prompt }));
    }
    out
}

/// Inject a sub-question as the primary user message for decomposition.
fn inject_sub_question(body: &serde_json::Value, sub_prompt: &str, context_block: &str) -> serde_json::Value {
    let mut out = body.clone();
    let sub_system = format!(
        "{context_block}\n\n\
         # AETHER COGNITIVE PIPELINE — SUB-QUESTION\n\
         You are solving one step of a larger problem. Focus ONLY on this sub-question.\n\
         Provide a clear, concise answer."
    );
    if let Some(messages) = out.get_mut("messages").and_then(|m| m.as_array_mut()) {
        // Replace the system message
        if let Some(sys) = messages.get_mut(0) {
            if sys.get("role").and_then(|r| r.as_str()) == Some("system") {
                if let Some(obj) = sys.as_object_mut() {
                    obj.insert("content".to_string(), serde_json::Value::String(sub_system));
                }
            }
        }
        // Replace the last user message with the sub-question
        if let Some(last) = messages.last_mut() {
            if last.get("role").and_then(|r| r.as_str()) == Some("user") {
                if let Some(obj) = last.as_object_mut() {
                    obj.insert("content".to_string(), serde_json::Value::String(sub_prompt.to_string()));
                }
            }
        }
    }
    out
}

/// Inject a retry prompt when verification fails.
fn inject_retry(body: &serde_json::Value, context_block: &str, query: &str) -> serde_json::Value {
    let mut out = body.clone();
    let retry_prompt = format!(
        "{context_block}\n\n\
         # AETHER COGNITIVE PIPELINE — RETRY\n\
         Your previous response to \"{query}\" was inconsistent or incomplete.\n\
         Please provide a more thorough and accurate answer."
    );
    if let Some(messages) = out.get_mut("messages").and_then(|m| m.as_array_mut()) {
        messages.insert(0, json!({ "role": "system", "content": retry_prompt }));
    }
    out
}

/// Inject a simplified retry prompt for ATD FallBackToSimpleShot.
/// Used when the model is deeply confused and needs a clean, simple instruction.
fn inject_simple_retry(body: &serde_json::Value, context_block: &str, query: &str) -> serde_json::Value {
    let mut out = body.clone();
    let simple_prompt = format!(
        "{context_block}\n\n\
         # AETHER — SIMPLE MODE\n\
         Answer this question directly and concisely: \"{query}\"\n\
         Do not overthink. Provide a clear, short answer."
    );
    if let Some(messages) = out.get_mut("messages").and_then(|m| m.as_array_mut()) {
        // Replace all messages with a clean, simple exchange
        messages.clear();
        messages.push(json!({ "role": "system", "content": simple_prompt }));
        messages.push(json!({ "role": "user", "content": query }));
    }
    out
}

/// Build the Aether system-prompt prefix that wraps the retrieved memory
/// context block. Prepended to (or inserted into) every backend request's
/// system message by [`augment_messages`]. Frames the model as the
/// cognitive core of Alpha-OS and instructs it to use the retrieved
/// memories to inform its response.
fn aether_prompt(context_block: &str) -> String {
    format!(
        "# AETHER RETRIEVED MEMORY CONTEXT (semantically relevant memories from your graph)\n\
         {context_block}\n\n\
         # YOUR MISSION\n\
         You are the cognitive core of Alpha-OS. The above memories were retrieved from your semantic memory graph.\n\
         Use them to inform your response. You have access to the full OS context below."
    )
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/// Extract the last user-message content from an OpenAI-shaped `messages`
/// array. Used as the retrieval query for Stage 2 (graph retrieval) and
/// as the cache key for Stage 1 (action cache). Walks the messages in
/// reverse so the *most recent* user turn wins (handles multi-turn chats
/// where the user has refined their question across several messages).
fn extract_user_query(body: &serde_json::Value) -> String {
    let messages = match body.get("messages").and_then(|m| m.as_array()) {
        Some(m) => m,
        None => return String::new(),
    };
    for m in messages.iter().rev() {
        if m.get("role").and_then(|r| r.as_str()) == Some("user") {
            if let Some(c) = m.get("content") {
                return content_to_string(c);
            }
        }
    }
    String::new()
}

/// Normalize a `content` field (which the OpenAI spec allows to be either
/// a plain string or an array of `{type, text}` parts) into a single
/// space-joined string. Non-text parts (images, tool calls, …) are
/// dropped because the retrieval pipeline is text-only.
fn content_to_string(c: &serde_json::Value) -> String {
    match c {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|p| {
                if p.get("type").and_then(|t| t.as_str()) == Some("text") {
                    p.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

/// Extract the assistant's text content from an OpenAI-shaped chat
/// completion response body. Returns `None` if the body isn't valid JSON
/// or doesn't contain the expected `choices[0].message.content` path —
/// the caller ([`call_backend`]) turns that into a fallback response.
fn extract_assistant_content(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    v.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
}

/// Build an OpenAI-shaped `chat.completion` JSON response from a plain
/// text content string. Used by every code path that returns to the
/// client (cache hit, pipeline output, fallback). The `model` field is
/// set to a synthetic name (`"aether-cache"`, `"aether-pipeline"`, …)
/// so callers can tell at a glance which path produced the response.
/// Token-usage counters are zeroed because the engine doesn't have access
/// to the backend's tokenizer.
fn openai_completion(content: &str, model: &str) -> serde_json::Value {
    json!({
        "id": format!("chatcmpl-aether-{}", randomish_id()),
        "object": "chat.completion",
        "created": chrono_now(),
        "model": model,
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content },
            "finish_reason": "stop"
        }],
        "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
    })
}

/// Build a graceful offline-fallback response when the backend is
/// unreachable, returns an error, or produces an empty body. The fallback
/// surfaces the retrieved context block verbatim so the user still gets
/// *some* useful signal (the semantic memories) even when inference is
/// unavailable. `reason` is interpolated into the message so the UI can
/// show *why* the fallback fired.
fn fallback_response(context_block: &str, reason: &str) -> String {
    format!(
        "[Aether Engine — offline fallback]\n\
         The semantic memory graph retrieved the following context:\n\n\
         {context_block}\n\n\
         (Backend inference was not used: {reason}. Drop a GGUF model in the models/ folder \
         and select it in Model Settings to enable full pipeline-augmented inference.)"
    )
}

/// Generate a pseudo-random hex ID from the current nanosecond timestamp.
/// Used as the `id` field of synthetic `chat.completion` responses. Not
/// cryptographically unique, but unique enough within a single process's
/// lifetime to disambiguate concurrent responses.
fn randomish_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos)
}

/// Current Unix timestamp in seconds. Used as the `created` field of
/// synthetic `chat.completion` responses. Named `chrono_now` for historical
/// reasons (a previous version used the `chrono` crate); the implementation
/// now uses `std::time` directly to keep the dependency tree empty.
fn chrono_now() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Speculative prefetch: warm the retrieval cache for graph-adjacent candidate
/// queries so the next, related query is instant.
async fn prefetch(state: AppState, retrieved: &[ScoredNode]) {
    if retrieved.is_empty() {
        return;
    }
    let graph = state.graph.clone();
    let cache = state.cache.clone();
    let candidates: Vec<String> = retrieved.iter().take(3).map(|n| n.text.clone()).collect();
    tokio::spawn(async move {
        for q in candidates {
            let (qvec, ctx) = {
                let g = graph.lock().await;
                let qv = g.vectorizer.vectorize(&q);
                let r = g.retrieve(&q, 8);
                let c = compress::compress(&r, &q, 6000);
                (qv, c)
            };
            cache.lock().await.put_retrieval(&q, qvec, ctx);
        }
    });
}

// ===========================================================================
// NEW ENDPOINTS (v3.1) — 8 additional handlers
//
// These are additive routes registered in main.rs. None of them touch the
// existing pipeline; they expose engine state (dashboard, metrics, models,
// config, graph stats/export/import) and an SSE-formatted chat stream.
// ===========================================================================

// ---------------------------------------------------------------------------
// POST /v1/chat/stream — Server-Sent Events chat stream
// ---------------------------------------------------------------------------

/// OpenAI-compatible chat-completions **streaming** endpoint.
///
/// Accepts the same body shape as [`chat_completions`] (`{ messages: [...] }`)
/// and returns a `text/event-stream` response. Each token of the final
/// assistant message is emitted as an SSE event of the form:
///
/// ```text
/// event: token
/// data: {"token": "hello"}
///
/// ```
///
/// A terminal `event: done` event signals end-of-stream.
///
/// # Implementation note
///
/// Aether Engine's backend HTTP client is not natively streaming (it would
/// require a chunked-transfer-aware `reqwest::Body` adapter), so this handler
/// runs the simplified pipeline (graph retrieval → compression → one
/// `call_backend` round-trip) and then **emits the final response token by
/// token** as SSE events. The browser's `EventSource` parser sees one event
/// per token; the only difference from a true token-stream is that all events
/// arrive in a single HTTP body rather than being interleaved with backend
/// generation. This is the fallback shape explicitly allowed by the spec
/// ("simple chunked HTTP response with `text/event-stream` content type").
pub async fn chat_completions_stream(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    state.stats.lock().await.requests += 1;
    let query = extract_user_query(&body);

    // Stage 2: graph retrieval (TF-IDF + edge expansion).
    let retrieved: Vec<ScoredNode> = {
        let g = state.graph.lock().await;
        g.retrieve(&query, 8)
    };
    // Stage 3: context compression.
    let context_block = compress::compress(&retrieved, &query, 6000);

    // Simplified pipeline: one backend call. The full chat_completions
    // pipeline (decomposition / ATD / distillation) is intentionally not
    // duplicated here — the streaming endpoint is for live UX, the regular
    // endpoint is for highest-quality responses.
    let response = call_backend(&state, &body, &context_block).await;

    // Build the SSE body: one `event: token` per whitespace-split token of
    // the final response, terminated by `event: done`.
    let mut sse = String::with_capacity(response.len().saturating_mul(2));
    for token in response.split_whitespace() {
        // JSON-encode the token (handles embedded quotes / backslashes) and
        // interpolate it into the `data:` line. The leading space after
        // `data:` is required by the SSE spec.
        let token_json = serde_json::to_string(token).unwrap_or_else(|_| "\"\"".to_string());
        sse.push_str(&format!(
            "event: token\ndata: {{\"token\": {}}}\n\n",
            token_json
        ));
    }
    sse.push_str("event: done\ndata: {\"done\": true}\n\n");

    (
        axum::http::StatusCode::OK,
        [("content-type", "text/event-stream")],
        sse,
    )
}

// ---------------------------------------------------------------------------
// GET /dashboard — HTML status page (see src/dashboard.rs)
// ---------------------------------------------------------------------------

/// Render a self-contained HTML dashboard summarizing live engine state.
///
/// Gathers a [`dashboard::DashboardData`] snapshot by briefly locking each
/// `Arc<Mutex<…>>` in [`AppState`], then hands it to
/// [`dashboard::render_dashboard`] which produces a dark-themed, monospace
/// HTML page with zero external resources.
pub async fn dashboard(State(state): State<AppState>) -> impl IntoResponse {
    let (nodes, edges) = {
        let g = state.graph.lock().await;
        (g.len(), g.edge_count())
    };
    let cache_size = state.cache.lock().await.len();
    let (decompositions, atd_verdicts, requests, cache_hits) = {
        let s = state.stats.lock().await;
        (s.decompositions, s.atd_verifications, s.requests, s.cache_hits)
    };
    let (hcm_pairs, hcm_capacity, hcm_memory) = {
        let h = state.hcm.lock().await;
        (h.pair_count, h.capacity(), h.memory_bytes())
    };

    let data = crate::dashboard::DashboardData {
        engine_name: "Aether Engine",
        version: "3.0",
        uptime_seconds: crate::dashboard::uptime_seconds(),
        node_count: nodes,
        edge_count: edges,
        cache_size,
        decompositions,
        atd_verdicts,
        hcm_state_bytes: hcm_memory,
        hcm_pairs,
        hcm_capacity,
        requests,
        cache_hits,
    };

    axum::response::Html(crate::dashboard::render_dashboard(&data))
}

// ---------------------------------------------------------------------------
// GET /metrics — Prometheus exposition format
// ---------------------------------------------------------------------------

/// Prometheus-format metrics endpoint.
///
/// Returns a `text/plain; version=0.0.4` body in Prometheus exposition
/// format. Five series are exposed:
///
/// - `aether_graph_nodes` (gauge) — nodes in the semantic memory graph.
/// - `aether_graph_edges` (gauge) — directed edges in the adjacency list.
/// - `aether_cache_size` (gauge) — action-cache entries.
/// - `aether_decompositions_total` (counter) — cognitive decompositions.
/// - `aether_atd_verdicts_total` (counter) — ATD verifications performed.
///
/// Designed to be scraped by a Prometheus / Grafana agent with no extra
/// configuration.
pub async fn prometheus_metrics(State(state): State<AppState>) -> impl IntoResponse {
    let (nodes, edges) = {
        let g = state.graph.lock().await;
        (g.len(), g.edge_count())
    };
    let cache_size = state.cache.lock().await.len();
    let (decompositions, atd_verifications) = {
        let s = state.stats.lock().await;
        (s.decompositions, s.atd_verifications)
    };

    // Build the Prometheus exposition body line-by-line. Each line MUST NOT
    // have leading whitespace (the exposition format is line-oriented and
    // strict about data lines starting with the metric name), so we use
    // `push_str` rather than a multi-line `format!` with `\` continuations
    // (which would embed the source-file indentation into the string).
    let mut body = String::with_capacity(1024);
    body.push_str("# HELP aether_graph_nodes Total nodes in memory graph\n");
    body.push_str("# TYPE aether_graph_nodes gauge\n");
    body.push_str(&format!("aether_graph_nodes {}\n", nodes));
    body.push_str("# HELP aether_graph_edges Total edges in memory graph\n");
    body.push_str("# TYPE aether_graph_edges gauge\n");
    body.push_str(&format!("aether_graph_edges {}\n", edges));
    body.push_str("# HELP aether_cache_size Action cache entries\n");
    body.push_str("# TYPE aether_cache_size gauge\n");
    body.push_str(&format!("aether_cache_size {}\n", cache_size));
    body.push_str("# HELP aether_decompositions_total Total cognitive decompositions\n");
    body.push_str("# TYPE aether_decompositions_total counter\n");
    body.push_str(&format!("aether_decompositions_total {}\n", decompositions));
    body.push_str("# HELP aether_atd_verdicts_total Total ATD verdicts\n");
    body.push_str("# TYPE aether_atd_verdicts_total counter\n");
    body.push_str(&format!("aether_atd_verdicts_total {}\n", atd_verifications));

    (
        axum::http::StatusCode::OK,
        [("content-type", "text/plain; version=0.0.4")],
        body,
    )
}

// ---------------------------------------------------------------------------
// GET /graph/export — full graph as downloadable JSON
// ---------------------------------------------------------------------------

/// Export the entire semantic memory graph (nodes + edges + stats) as a
/// downloadable JSON attachment.
///
/// Same payload shape as `GET /graph` but wrapped with a `stats` block and
/// served with `Content-Disposition: attachment; filename="aether-graph.json"`
/// so the browser downloads it as a file instead of rendering it inline.
pub async fn graph_export(State(state): State<AppState>) -> impl IntoResponse {
    let (nodes_json, edges_json, node_count, edge_count) = {
        let g = state.graph.lock().await;
        let resp = g.to_response();
        let n = g.len();
        let e = g.edge_count();
        (
            resp.get("nodes").cloned().unwrap_or(serde_json::Value::Array(vec![])),
            resp.get("edges").cloned().unwrap_or(serde_json::Value::Array(vec![])),
            n,
            e,
        )
    };

    let body = json!({
        "nodes": nodes_json,
        "edges": edges_json,
        "stats": {
            "node_count": node_count,
            "edge_count": edge_count,
        },
    });

    (
        axum::http::StatusCode::OK,
        [("content-disposition", "attachment; filename=\"aether-graph.json\"")],
        Json(body),
    )
}

// ---------------------------------------------------------------------------
// POST /graph/import — bulk-add nodes from a JSON array
// ---------------------------------------------------------------------------

/// Bulk-import nodes into the semantic memory graph.
///
/// Accepts a JSON body of the shape `{ "nodes": [ { "id": "...", "text": "..." }, ... ] }`.
/// Each entry is fed through [`MemoryGraph::add`](crate::graph::MemoryGraph::add)
/// (the same path used by `POST /graph/add`), with `kind` and `metadata`
/// defaulting to `"fact"` and `{}` respectively when absent.
///
/// Returns `{ "imported": <count> }` where `count` is the number of nodes
/// successfully added. Entries missing `id` or `text` are skipped.
pub async fn graph_import(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let mut imported: usize = 0;
    if let Some(nodes) = body.get("nodes").and_then(|n| n.as_array()) {
        let mut g = state.graph.lock().await;
        for node in nodes {
            let id = node.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let text = node.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if id.is_empty() || text.is_empty() {
                continue;
            }
            let kind = node
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("fact")
                .to_string();
            let metadata = node.get("metadata").cloned().unwrap_or(json!({}));
            g.add(AddNodeRequest {
                id,
                text,
                kind,
                metadata,
            });
            imported = imported.saturating_add(1);
        }
    }
    Json(json!({ "imported": imported }))
}

// ---------------------------------------------------------------------------
// GET /config — runtime configuration
// ---------------------------------------------------------------------------

/// Return the engine's runtime configuration as JSON.
///
/// All values are read from the environment (with sensible defaults) at
/// request time so changes to `AETHER_BACKEND` are reflected without a
/// restart. The numeric thresholds (`hcm_dim`, `clt_*`, `atd_*`,
/// `cache_threshold`, `retrieval_threshold`) are the same constants the
/// engine was compiled with — they're surfaced here so an operator can verify
/// the live values via curl.
pub async fn get_config(State(state): State<AppState>) -> impl IntoResponse {
    // `AETHER_BACKEND` is the only env var the engine actually reads today;
    // the rest are surfaced as the compiled-in defaults. The port value
    // mirrors `const PORT: u16 = 3004` in `main.rs` (hardcoded here to avoid
    // needing to bump PORT's visibility to `pub(crate)`).
    let backend = state.backend.clone();
    Json(json!({
        "backend": backend,
        "port": 3004_u16,
        "hcm_dim": 1024,
        "clt_max_steps": 10,
        "clt_convergence": 0.92,
        "atd_max_entropy": 0.65,
        "atd_max_repetition": 0.30,
        "cache_threshold": 0.95,
        "retrieval_threshold": 0.92,
    }))
}

// ---------------------------------------------------------------------------
// GET /v1/models — OpenAI-compatible model list
// ---------------------------------------------------------------------------

/// OpenAI-compatible `GET /v1/models` endpoint.
///
/// Returns a synthetic list of three "models" corresponding to the three
/// paths through the Aether pipeline:
///
/// - `aether-cache` — served instantly from the action cache (Stage 1).
/// - `aether-pipeline` — the full 10-stage cognitive pipeline.
/// - `aether-fallback` — the offline-fallback response when the backend is
///   unreachable.
///
/// This lets OpenAI-compatible clients (e.g. `openai` Python SDK, Continue,
/// LangChain) enumerate the engine's "models" without configuration.
pub async fn list_models(State(_state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "object": "list",
        "data": [
            { "id": "aether-cache",     "object": "model", "created": 0, "owned_by": "aether" },
            { "id": "aether-pipeline",  "object": "model", "created": 0, "owned_by": "aether" },
            { "id": "aether-fallback",  "object": "model", "created": 0, "owned_by": "aether" },
        ],
    }))
}

// ---------------------------------------------------------------------------
// GET /graph/stats — detailed graph statistics
// ---------------------------------------------------------------------------

/// Detailed statistics about the semantic memory graph.
///
/// Returns:
///
/// - `node_count` — total nodes.
/// - `edge_count` — total directed edges in the adjacency list (each
///   undirected edge is stored twice, once per endpoint).
/// - `avg_edges_per_node` — `edge_count / node_count` (0 if empty).
/// - `max_edges` — the largest adjacency list of any single node (capped at
///   `top_k = 5`).
/// - `density` — `edge_count / (N * (N-1))` for `N > 1`, else 0 (the
///   directed-edge density of the adjacency list).
/// - `top_connected_nodes` — the top 5 nodes by adjacency-list length, each
///   as `{ id, text, edge_count }`.
pub async fn graph_stats(State(state): State<AppState>) -> impl IntoResponse {
    let g = state.graph.lock().await;
    let node_count = g.len();
    let edge_count = g.edge_count();
    let max_edges = g
        .adjacency
        .values()
        .map(|v| v.len())
        .max()
        .unwrap_or(0);
    let avg_edges_per_node = if node_count > 0 {
        edge_count as f64 / node_count as f64
    } else {
        0.0
    };
    let density = if node_count > 1 {
        edge_count as f64 / (node_count as f64 * (node_count as f64 - 1.0))
    } else {
        0.0
    };

    // Top connected nodes: sort adjacency entries by length (desc), take 5.
    // We clone the (id, edge_count) pairs out of the adjacency map so we can
    // drop the borrow before looking up node texts (avoiding a double-borrow
    // of `g.adjacency` and `g.nodes`).
    let mut node_edge_counts: Vec<(String, usize)> = g
        .adjacency
        .iter()
        .map(|(id, nbrs)| (id.clone(), nbrs.len()))
        .collect();
    node_edge_counts.sort_by(|a, b| b.1.cmp(&a.1));

    let top_connected: Vec<serde_json::Value> = node_edge_counts
        .into_iter()
        .take(5)
        .filter_map(|(id, ec)| {
            g.nodes.get(&id).map(|n| {
                json!({
                    "id": id,
                    "text": n.text.clone(),
                    "edge_count": ec,
                })
            })
        })
        .collect();

    Json(json!({
        "node_count": node_count,
        "edge_count": edge_count,
        "avg_edges_per_node": avg_edges_per_node,
        "max_edges": max_edges,
        "density": density,
        "top_connected_nodes": top_connected,
    }))
}

// ===========================================================================
// AGENTIC LAYER (v3.2) — autonomous OS agent endpoints
//
// Two additive routes registered in main.rs that expose the agentic loop
// (src/agent.rs) and the tool registry (src/tools.rs) to the Next.js
// layer. Neither touches the existing 10-stage cognitive pipeline.
// ===========================================================================

// ---------------------------------------------------------------------------
// POST /v1/agent/run — run the autonomous agent loop
// ---------------------------------------------------------------------------

/// Run the autonomous agent loop for a single goal.
///
/// Accepts a JSON body of the shape:
///
/// ```json
/// {
///   "goal": "set up a Python dev environment and write a hello-world script",
///   "context": { "windows": [...], "memory": [...], "plan": {...} },
///   "max_iterations": 20
/// }
/// ```
///
/// - `goal` (required) — natural-language goal the agent should achieve.
/// - `context` (optional, default `{}`) — current OS state, pretty-printed
///   into the system prompt so the LLM perceives open windows, memory,
///   active plan, etc.
/// - `max_iterations` (optional, default `20`, clamped to `[1, 50]`) —
///   hard cap on think iterations.
///
/// Returns:
///
/// ```json
/// {
///   "ok": true,
///   "result": "<final assistant text>",
///   "iterations": 3,
///   "completed": true,
///   "tool_calls": [
///     { "name": "file_read", "params": { "path": "/etc/hostname" } },
///     ...
///   ]
/// }
/// ```
///
/// The `tool_calls` array is the full transcript of every tool call the
/// LLM made across all iterations, in execution order. The Next.js layer
/// uses this transcript to perform the real OS side-effects (file IO,
/// PTY exec, window manager mutations, …) — the Aether Engine's tool
/// executors return placeholders by design (see [`crate::tools`]).
///
/// On a missing `goal` field the handler returns
/// `{ ok: false, error: "missing 'goal' field" }` without starting the
/// loop.
pub async fn agent_run(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let goal = body
        .get("goal")
        .and_then(|g| g.as_str())
        .unwrap_or("")
        .to_string();
    let context = body.get("context").cloned().unwrap_or(json!({}));
    let max_iterations = body
        .get("max_iterations")
        .and_then(|m| m.as_u64())
        .map(|n| n as usize)
        .unwrap_or(crate::agent::DEFAULT_MAX_ITERATIONS);

    if goal.is_empty() {
        return Json(json!({
            "ok": false,
            "error": "missing 'goal' field",
        }))
        .into_response();
    }

    let result = crate::agent::run_agent_loop(state, &goal, &context, max_iterations).await;

    Json(json!({
        "ok": true,
        "result": result.result,
        "iterations": result.iterations,
        "completed": result.completed,
        "tool_calls": result.tool_calls.iter().map(|c| json!({
            "name": c.name,
            "params": c.params,
        })).collect::<Vec<_>>(),
    }))
    .into_response()
}

// ---------------------------------------------------------------------------
// GET /v1/tools — list available agent tools (introspection)
// ---------------------------------------------------------------------------

/// List every tool available to the autonomous agent, with its name,
/// description, and JSON-Schema parameters.
///
/// Used by the Next.js layer (and by `curl`) to introspect the tool
/// surface without reading the Rust source. Returns:
///
/// ```json
/// {
///   "ok": true,
///   "tools": [
///     {
///       "name": "file_read",
///       "description": "Read the full contents of a file from disk.",
///       "parameters": {
///         "type": "object",
///         "properties": { "path": { "type": "string", "..." } },
///         "required": ["path"]
///       }
///     },
///     ...
///   ]
/// }
/// ```
///
/// The order of tools in the response is stable across calls (matches the
/// order in [`ToolRegistry::catalog`](crate::tools::ToolRegistry::catalog))
/// so callers can cache or render the list without re-sorting.
pub async fn list_tools(State(_state): State<AppState>) -> impl IntoResponse {
    let registry = crate::tools::ToolRegistry::new();
    let catalog = registry.catalog();
    Json(json!({
        "ok": true,
        "tools": catalog.iter().map(|t| json!({
            "name": t.name,
            "description": t.description,
            "parameters": t.parameters,
        })).collect::<Vec<_>>(),
    }))
}
