//! HTTP handlers for the Aether Engine.

use crate::graph::{AddNodeRequest, ScoredNode};
use crate::tfidf::SparseVec;
use crate::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

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
    let cache_hits = state.stats.lock().await.cache_hits;
    Json(json!({
        "ok": true,
        "nodes": nodes,
        "edges": edges,
        "cache_hits": cache_hits,
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
    let edges_created = {
        let mut g = state.graph.lock().await;
        g.add(req)
    };
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
// POST /v1/chat/completions  (OpenAI-compatible)
// ---------------------------------------------------------------------------
pub async fn chat_completions(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    state.stats.lock().await.requests += 1;

    // Extract the last user message as the retrieval query.
    let query = extract_user_query(&body);

    // Vectorize the query against the graph's current vocabulary.
    let qvec: SparseVec = {
        let g = state.graph.lock().await;
        g.vectorizer.vectorize(&query)
    };

    // 1. Action cache fast-path (similarity > 0.95).
    {
        let cache = state.cache.lock().await;
        if let Some((resp, _sim)) = cache.get(&query, &qvec) {
            drop(cache);
            state.stats.lock().await.cache_hits += 1;
            return Json(openai_completion(&resp, "aether-cache")).into_response();
        }
    }

    // 2. Retrieve relevant memories (graph traversal + 1-hop edge expansion).
    let retrieved: Vec<ScoredNode> = {
        let g = state.graph.lock().await;
        g.retrieve(&query, 8)
    };

    // 2b. Retrieval cache: if a near-identical query was prefetched, reuse its
    //     compressed context; otherwise warm the cache for next time.
    let context_block = {
        let mut cache = state.cache.lock().await;
        if let Some(ctx) = cache.get_retrieval(&query, &qvec) {
            ctx
        } else {
            let ctx = compress_context(&retrieved);
            cache.put_retrieval(&query, qvec.clone(), ctx.clone());
            ctx
        }
    };

    // 3. Forward the augmented request to the GGUF backend (if reachable).
    let augmented = augment_messages(&body, &context_block);
    let backend_url = format!("{}/chat/completions", state.backend.trim_end_matches('/'));
    let client = state.client.clone();

    match client.post(&backend_url).json(&augmented).send().await {
        Ok(resp) if resp.status().is_success() => {
            let txt = resp.text().await.unwrap_or_else(|_| "{}".to_string());
            if let Some(content) = extract_assistant_content(&txt) {
                state.cache.lock().await.put(&query, qvec.clone(), content);
            }
            // Speculative prefetch: warm the retrieval cache for graph-adjacent queries.
            prefetch(state.clone(), &retrieved).await;
            (StatusCode::OK, txt).into_response()
        }
        Ok(resp) => {
            let status = resp.status();
            let body_txt = resp.text().await.unwrap_or_default();
            let fallback = fallback_response(
                &context_block,
                &query,
                &format!("backend returned {status}: {body_txt}"),
            );
            state.cache.lock().await.put(&query, qvec.clone(), fallback.clone());
            Json(openai_completion(&fallback, "aether-fallback")).into_response()
        }
        Err(e) => {
            let fallback =
                fallback_response(&context_block, &query, &format!("backend unreachable: {e}"));
            state.cache.lock().await.put(&query, qvec.clone(), fallback.clone());
            Json(openai_completion(&fallback, "aether-fallback")).into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
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

fn compress_context(retrieved: &[ScoredNode]) -> String {
    if retrieved.is_empty() {
        return "(no semantically relevant memories found in the graph)".to_string();
    }
    let mut out = String::new();
    let mut total = 0usize;
    let max_chars = 6000;
    for n in retrieved {
        let line = format!("[{}] {} (score: {:.3})\n", n.kind, n.text, n.score);
        if total + line.len() > max_chars {
            break;
        }
        out.push_str(&line);
        total += line.len();
    }
    out.trim_end().to_string()
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

fn fallback_response(context_block: &str, query: &str, reason: &str) -> String {
    format!(
        "[Aether Engine — offline fallback]\n\
The semantic memory graph retrieved the following context for your query \
(\"{query}\"):\n\n\
{context_block}\n\n\
(Backend inference was not used: {reason}. Set AETHER_BACKEND to a reachable \
OpenAI-compatible endpoint — e.g. an Ollama / llama.cpp server — to enable full \
retrieval-augmented inference. This response demonstrates the graph retrieval \
capability on its own.)"
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
/// queries (the texts of the retrieved nodes) so the next, related query is instant.
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
                let c = compress_context(&r);
                (qv, c)
            };
            cache.lock().await.put_retrieval(&q, qvec, ctx);
        }
    });
}
