//! Aether Engine — Alpha-OS's proprietary retrieval-augmented inference orchestrator.
//!
//! A Rust HTTP service that acts as intelligent middleware over small GGUF models,
//! multiplying their effective context 10x via a TF-IDF semantic memory graph.

mod cache;
mod graph;
mod handlers;
mod tfidf;

use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

pub struct Stats {
    pub requests: u64,
    pub cache_hits: u64,
}

#[derive(Clone)]
pub struct AppState {
    pub graph: Arc<Mutex<graph::MemoryGraph>>,
    pub cache: Arc<Mutex<cache::ActionCache>>,
    pub stats: Arc<Mutex<Stats>>,
    pub backend: String,
    pub client: reqwest::Client,
}

const PORT: u16 = 3004;

#[tokio::main]
async fn main() {
    let backend = std::env::var("AETHER_BACKEND")
        .unwrap_or_else(|_| "http://localhost:11434/v1".to_string());

    let state = AppState {
        graph: Arc::new(Mutex::new(graph::MemoryGraph::new())),
        cache: Arc::new(Mutex::new(cache::ActionCache::new())),
        stats: Arc::new(Mutex::new(Stats {
            requests: 0,
            cache_hits: 0,
        })),
        backend: backend.clone(),
        client: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("reqwest client"),
    };

    let app = Router::new()
        .route("/v1/chat/completions", post(handlers::chat_completions))
        .route("/graph/add", post(handlers::graph_add))
        .route("/graph", get(handlers::graph_get))
        .route("/graph/search", post(handlers::graph_search))
        .route("/graph/clear", post(handlers::graph_clear))
        .route("/health", get(handlers::health))
        .layer(CorsLayer::very_permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{PORT}"))
        .await
        .expect("bind 3004");

    eprintln!(
        "[aether-engine] listening on :{PORT}  (backend: {backend})"
    );

    axum::serve(listener, app).await.expect("server stopped");
}
