//! HTTP handlers for the Aether Engine v2.0.
//!
//! The chat_completions handler implements the full cognitive pipeline:
//!   1. Action cache check (instant for repeated queries)
//!   2. Graph retrieval (TF-IDF semantic search + edge expansion)
//!   3. Context compression (40K→4K tokens preserving signal)
//!   4. Complexity analysis (Simple / Moderate / Complex)
//!   5. Cognitive decomposition (Complex queries are broken into sub-questions)
//!   6. Sequential sub-question solving (each with fresh context + dependency injection)
//!   7. Synthesis (combine sub-answers into final response)
//!   8. Self-verification (check quality; retry once if failed)
//!   9. Knowledge distillation (store successful decomposition patterns)
//!  10. Speculative prefetch (warm cache for likely-next queries)

use crate::compress;
use crate::decompose::{self, Complexity, PipelineState, SubQuestion};
use crate::graph::{AddNodeRequest, ScoredNode};
use crate::tfidf::SparseVec;
use crate::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::time::Instant;

#[derive(Deserialize)]
pub struct SearchRequest {
    pub query: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
}
fn default_limit() -> usize {
    5
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
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
// POST /v1/chat/completions — the full cognitive pipeline (OpenAI-compatible)
// ---------------------------------------------------------------------------
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
    {
        let cache = state.cache.lock().await;
        if let Some((resp, _sim)) = cache.get(&query, &qvec) {
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

            // Solve each sub-question sequentially, injecting dependency answers
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
            if let Some(synth) = sub_questions.iter().find(|s| s.id == "synth") {
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

fn extract_assistant_content(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    v.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
}

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

fn fallback_response(context_block: &str, reason: &str) -> String {
    format!(
        "[Aether Engine — offline fallback]\n\
         The semantic memory graph retrieved the following context:\n\n\
         {context_block}\n\n\
         (Backend inference was not used: {reason}. Drop a GGUF model in the models/ folder \
         and select it in Model Settings to enable full pipeline-augmented inference.)"
    )
}

fn randomish_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos)
}

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
