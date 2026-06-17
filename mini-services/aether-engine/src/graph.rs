//! # Semantic Memory Graph (Innovation #1)
//!
//! In-memory TF-IDF semantic memory graph. Every memory is a node; edges are
//! bidirectional cosine-similarity links built automatically when a node is
//! added. Retrieval is a two-pass operation: top-N direct TF-IDF hits, then
//! a 1-hop edge expansion that blends each neighbor's direct relevance with
//! its edge weight, surfacing contextually-related memories that wouldn't
//! otherwise match the query.
//!
//! # Where it sits in the pipeline
//!
//! Stage 2 of the cognitive pipeline (see [`crate::handlers`]). The graph is
//! also the *write target* for `/graph/add` (which folds every node into the
//! HCM arena as a side effect) and the *read target* for `/graph/search`
//! and the speculative prefetcher.
//!
//! # Why not a vector DB?
//!
//! The corpus is small (tens of thousands of nodes at most for a single
//! user's OS memory). A pure Rust in-memory `HashMap`-of-nodes with brute-
//! force cosine scan is sub-millisecond at that scale and avoids the
//! operational overhead of an external database. The TF-IDF vectors are
//! sparse and `O(min(|a|, |b|))` to compare, so the linear scan is cheap.

use crate::tfidf::{cosine, SparseVec, TfidfVectorizer};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Request body for `POST /graph/add`.
#[derive(Clone, Deserialize)]
pub struct AddNodeRequest {
    /// Client-supplied unique identifier. If a node with this id already
    /// exists, it is replaced (the old document is removed from the
    /// vectorizer's `df` table before the new one is added).
    pub id: String,
    /// The memory text. Tokenized into the TF-IDF corpus on insertion.
    pub text: String,
    /// Free-form kind tag (`"fact"`, `"interrupt"`, `"note"`, …). Defaults
    /// to `"fact"`. Surfaced verbatim in `/graph` and `/graph/search`.
    #[serde(default = "default_kind")]
    pub kind: String,
    /// Arbitrary JSON metadata associated with the node (source, priority,
    /// timestamps, …). Returned untouched by every read endpoint.
    #[serde(default = "default_metadata")]
    pub metadata: serde_json::Value,
}

/// Serde default for [`AddNodeRequest::kind`] = `"fact"`.
fn default_kind() -> String {
    "fact".to_string()
}

/// Serde default for [`AddNodeRequest::metadata`] = `{}`.
fn default_metadata() -> serde_json::Value {
    serde_json::json!({})
}

/// Serialized form of a node, used by `GET /graph`.
#[derive(Clone, Serialize)]
pub struct NodeResponse {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub metadata: serde_json::Value,
}

/// Serialized form of an edge, used by `GET /graph`.
#[derive(Clone, Serialize)]
pub struct EdgeResponse {
    pub from: String,
    pub to: String,
    pub weight: f64,
}

/// A node scored against a query, returned by `/graph/search` and by the
/// pipeline's Stage-2 retrieval step.
#[derive(Clone, Serialize)]
pub struct ScoredNode {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub metadata: serde_json::Value,
    /// Cosine similarity (or blended score for [`MemoryGraph::retrieve`]) in
    /// the range `[0.0, 1.0]`. Nodes with score 0 are filtered out.
    pub score: f64,
}

/// Internal node — carries its precomputed sparse vector alongside the
/// serialized fields. The vector is rebuilt whenever the corpus changes
/// (because IDF shifts), so callers never read a stale vector.
pub struct Node {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub metadata: serde_json::Value,
    pub vector: SparseVec,
}

/// The semantic memory graph: nodes keyed by id, an adjacency map of the
/// top-K most-similar neighbors per node, and a streaming TF-IDF vectorizer
/// that owns the corpus statistics.
pub struct MemoryGraph {
    /// `id → Node` lookup table.
    pub nodes: HashMap<String, Node>,
    /// `id → [(neighbor_id, weight), ...]` adjacency list, top-K per node.
    pub adjacency: HashMap<String, Vec<(String, f64)>>,
    /// The streaming TF-IDF vectorizer that owns corpus-wide `df`/`N` stats.
    pub vectorizer: TfidfVectorizer,
    /// How many neighbors each node keeps in its adjacency list. Tuned to 5
    /// — enough to support 1-hop expansion without bloating `/graph` payloads.
    pub top_k: usize,
}

impl MemoryGraph {
    /// Create an empty graph with `top_k = 5` and a fresh vectorizer.
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            adjacency: HashMap::new(),
            vectorizer: TfidfVectorizer::new(),
            top_k: 5,
        }
    }

    /// Number of nodes in the graph.
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// Total number of directed edges in the adjacency list (each undirected
    /// edge is counted once per direction because both endpoints store it).
    pub fn edge_count(&self) -> usize {
        self.adjacency.values().map(|v| v.len()).collect::<Vec<_>>().iter().sum()
    }

    /// Wipe the graph and reset the vectorizer's corpus statistics.
    pub fn clear(&mut self) {
        self.nodes.clear();
        self.adjacency.clear();
        self.vectorizer = TfidfVectorizer::new();
    }

    /// Add (or replace) a node, then recompute all vectors (IDF changed)
    /// and all edges. Returns the number of adjacency entries created
    /// across the whole graph (used as an informational stat in the
    /// `/graph/add` response).
    ///
    /// # Replace semantics
    ///
    /// If a node with the same id exists, its document contribution is
    /// *first* removed from the vectorizer (so IDF doesn't double-count),
    /// then the new document is added. This keeps the corpus consistent
    /// under repeated writes to the same id.
    pub fn add(&mut self, req: AddNodeRequest) -> usize {
        // Replace existing node with the same id: remove its document
        // contribution first so the global IDF table stays consistent.
        if let Some(old) = self.nodes.remove(&req.id) {
            self.vectorizer.remove_document(&old.text);
        }
        self.vectorizer.add_document(&req.text);
        self.nodes.insert(
            req.id.clone(),
            Node {
                id: req.id.clone(),
                text: req.text,
                kind: req.kind,
                metadata: req.metadata,
                vector: SparseVec::default(),
            },
        );
        // IDF changed for every term — recompute all node vectors so the
        // stored sparse vectors match the new corpus statistics.
        self.recompute_vectors();
        // Rebuild the entire adjacency list (top-K neighbors per node).
        let created = self.recompute_edges();
        created
    }

    /// Re-vectorize every node against the current corpus statistics.
    ///
    /// This is `O(N * |tokens|)` and is run on every `add` because the IDF
    /// of every term shifts whenever the document count changes. For the
    /// expected graph sizes (≤ tens of thousands of nodes) this is still
    /// sub-millisecond.
    fn recompute_vectors(&mut self) {
        // Snapshot the (id, text) pairs first so we can borrow `self.nodes`
        // mutably in the loop without aliasing the iterator.
        let texts: Vec<(String, String)> = self
            .nodes
            .iter()
            .map(|(k, v)| (k.clone(), v.text.clone()))
            .collect();
        for (id, text) in &texts {
            let v = self.vectorizer.vectorize(text);
            if let Some(n) = self.nodes.get_mut(id) {
                n.vector = v;
            }
        }
    }

    /// Recompute all edges. Returns the number of edges created for the
    /// most-recently added node (used as an informational stat in the add
    /// response).
    ///
    /// For each node we compute cosine similarity against every other node,
    /// keep the top-K positive-similarity neighbors, and store them in the
    /// adjacency list. This is `O(N^2)` cosine comparisons — acceptable for
    /// the expected graph sizes; if it ever becomes a bottleneck, an ANN
    /// index (HNSW) can be layered on without changing the API.
    fn recompute_edges(&mut self) -> usize {
        self.adjacency.clear();
        // Snapshot (id, vector) so the borrow checker is happy.
        let entries: Vec<(String, SparseVec)> = self
            .nodes
            .iter()
            .map(|(k, v)| (k.clone(), v.vector.clone()))
            .collect();
        let mut total_created = 0usize;
        for (id, vec) in &entries {
            let mut sims: Vec<(String, f64)> = Vec::new();
            for (other_id, other_vec) in &entries {
                if other_id == id {
                    continue;
                }
                let s = cosine(vec, other_vec);
                if s > 0.0 {
                    sims.push((other_id.clone(), s));
                }
            }
            // Sort by similarity descending; ties resolved arbitrarily.
            sims.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            // Keep only the top-K most-similar neighbors.
            let top: Vec<(String, f64)> = sims.into_iter().take(self.top_k).collect();
            total_created = total_created.saturating_add(top.len());
            self.adjacency.insert(id.clone(), top);
        }
        total_created
    }

    /// Semantic search: top-N nodes by cosine similarity to the query.
    ///
    /// Pure brute-force scan over all nodes; the `score > 0.0` filter drops
    /// every node that shares no terms with the query (cosine of disjoint
    /// term sets is 0).
    pub fn search(&self, query: &str, limit: usize) -> Vec<ScoredNode> {
        let qvec = self.vectorizer.vectorize(query);
        let mut results: Vec<ScoredNode> = self
            .nodes
            .values()
            .map(|n| ScoredNode {
                id: n.id.clone(),
                text: n.text.clone(),
                kind: n.kind.clone(),
                metadata: n.metadata.clone(),
                score: cosine(&qvec, &n.vector),
            })
            .filter(|s| s.score > 0.0)
            .collect();
        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        results.into_iter().take(limit).collect()
    }

    /// Retrieval-augmented fetch: top-N nodes by cosine, then **1-hop edge
    /// expansion**. Neighbors receive a blended score
    /// (`0.5 * direct_relevance + 0.5 * edge_weight`) so that a memory the
    /// query doesn't directly match — but which is linked to a direct hit —
    /// can still be surfaced. This is the core of Innovation #1.
    pub fn retrieve(&self, query: &str, top_n: usize) -> Vec<ScoredNode> {
        let qvec = self.vectorizer.vectorize(query);
        // Pass 1: top-N direct TF-IDF hits.
        let mut direct: Vec<(String, f64)> = self
            .nodes
            .values()
            .map(|n| (n.id.clone(), cosine(&qvec, &n.vector)))
            .filter(|(_, s)| *s > 0.0)
            .collect();
        direct.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let top: Vec<(String, f64)> = direct.into_iter().take(top_n).collect();

        // Pass 2: 1-hop expansion. Each direct hit contributes its full
        // score; each of its graph neighbors gets a blended score that
        // combines its own direct relevance with the edge weight.
        let mut scores: HashMap<String, f64> = HashMap::new();
        for (id, s) in &top {
            *scores.entry(id.clone()).or_insert(0.0) += s;
            if let Some(nbrs) = self.adjacency.get(id) {
                for (nbr_id, edge_w) in nbrs {
                    let nbr_direct = self
                        .nodes
                        .get(nbr_id)
                        .map(|n| cosine(&qvec, &n.vector))
                        .unwrap_or(0.0);
                    // 50/50 blend: a neighbor with no direct relevance but
                    // a strong edge to a direct hit still gets surfaced.
                    let blended = nbr_direct * 0.5 + edge_w * 0.5;
                    let e = scores.entry(nbr_id.clone()).or_insert(0.0);
                    if blended > *e {
                        *e = blended;
                    }
                }
            }
        }

        let mut out: Vec<ScoredNode> = scores
            .into_iter()
            .filter_map(|(id, score)| {
                self.nodes.get(&id).map(|n| ScoredNode {
                    id: n.id.clone(),
                    text: n.text.clone(),
                    kind: n.kind.clone(),
                    metadata: n.metadata.clone(),
                    score,
                })
            })
            .collect();
        out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        out
    }

    /// Serialize the whole graph for the Memory Network visualizer
    /// (`GET /graph`). Edges are deduplicated so each undirected edge
    /// appears once (the adjacency list stores both directions internally).
    pub fn to_response(&self) -> serde_json::Value {
        let nodes: Vec<NodeResponse> = self
            .nodes
            .values()
            .map(|n| NodeResponse {
                id: n.id.clone(),
                text: n.text.clone(),
                kind: n.kind.clone(),
                metadata: n.metadata.clone(),
            })
            .collect();
        let mut edges: Vec<EdgeResponse> = Vec::new();
        let mut seen: HashSet<(String, String)> = HashSet::new();
        for (from, nbrs) in &self.adjacency {
            for (to, w) in nbrs {
                // Canonicalize the (from, to) ordering so the same undirected
                // edge isn't emitted twice (once per direction).
                let key = if from < to {
                    (from.clone(), to.clone())
                } else {
                    (to.clone(), from.clone())
                };
                if seen.insert(key) {
                    edges.push(EdgeResponse {
                        from: from.clone(),
                        to: to.clone(),
                        weight: *w,
                    });
                }
            }
        }
        serde_json::json!({ "nodes": nodes, "edges": edges })
    }
}
