//! # Graph — Akasha, the semantic memory graph.
//!
//! [`MemoryGraph`] is the engine's long-term memory: a set of text nodes
//! (facts, lessons, plans, goals, intentions, logs, code — see the `kind`
//! field on [`AddNodeRequest`]) linked by similarity edges.
//!
//! # Retrieval model
//!
//! - [`MemoryGraph::search`] is pure TF-IDF: vectorize the query against
//!     the graph's corpus vocabulary, cosine-score every node, return the
//!     top `limit`. This is what `POST /graph/search` exposes.
//! - [`MemoryGraph::retrieve`] is the pipeline's Stage 2: the same TF-IDF
//!     base scores, then a **1-hop edge-expansion blend** — every neighbor
//!     of a base hit inherits a fraction of that hit's score, so memories
//!     that are *linked* to a semantic match surface even when their own
//!     text shares no terms with the query.
//!
//! # Edge maintenance
//!
//! Edges are recomputed from scratch on every [`MemoryGraph::add`] (see
//! the "recompute" wording in the `POST /graph/add` handler): two nodes are
//! linked when their TF-IDF vectors' cosine similarity reaches
//! [`EDGE_THRESHOLD`], and each node keeps at most [`MAX_NEIGHBORS`] best
//! neighbors so the graph stays navigable instead of collapsing into a
//! hairball. The adjacency list stores both directions of every edge, so
//! [`MemoryGraph::edge_count`] counts *directed* entries (each undirected
//! edge twice); `GET /graph` and `GET /graph/export` deduplicate via
//! [`MemoryGraph::to_response`].
//!
//! # Public fields
//!
//! `nodes`, `adjacency` and `vectorizer` are deliberately `pub`: the
//! `GET /graph/stats` handler walks `adjacency`/`nodes` directly to compute
//! degree statistics, and the pipeline vectorizes queries through
//! `vectorizer` before touching the caches (so cache keys and corpus IDF
//! always agree).

use crate::tfidf::{SparseVec, TfIdfVectorizer};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

/// Minimum TF-IDF cosine similarity for two nodes to be linked by an edge.
const EDGE_THRESHOLD: f64 = 0.18;

/// Maximum neighbors kept per node after an edge recompute.
const MAX_NEIGHBORS: usize = 8;

/// Fraction of a base hit's score inherited by each of its 1-hop neighbors
/// during [`MemoryGraph::retrieve`] expansion.
const EXPANSION_WEIGHT: f64 = 0.45;

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

/// Request body for `POST /graph/add` and the unit of `POST /graph/import`.
///
/// `kind` defaults to `"fact"` and `metadata` to `{}` when omitted, so the
/// minimal valid body is `{ "id": "...", "text": "..." }`. Adding a node
/// whose `id` already exists replaces the old node (its text is removed
/// from the vectorizer corpus before the new one is added).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddNodeRequest {
    /// Unique node identifier. Re-adding an existing id replaces the node.
    pub id: String,
    /// The memory text. This is what gets vectorized and retrieved against.
    pub text: String,
    /// Memory kind: `"fact"`, `"lesson"`, `"plan"`, `"goal"`,
    /// `"intention"`, `"log"`, `"code"`, `"interrupt"`, … — free-form,
    /// surfaced to clients and used as a section label by the compressor.
    #[serde(default = "default_kind")]
    pub kind: String,
    /// Arbitrary JSON metadata (source, priority, timestamps, …).
    #[serde(default = "default_metadata")]
    pub metadata: Value,
}

/// Serde default for [`AddNodeRequest::kind`] = `"fact"`.
fn default_kind() -> String {
    "fact".to_string()
}

/// Serde default for [`AddNodeRequest::metadata`] = `{}`.
fn default_metadata() -> Value {
    json!({})
}

/// A stored memory plus its precomputed TF-IDF vector. Serialized
/// manually field-by-field by [`MemoryGraph::to_response`] (the vector
/// itself never leaves the engine), so no `Serialize` impl is needed.
#[derive(Debug, Clone)]
pub struct MemoryNode {
    /// Unique identifier (mirrors [`AddNodeRequest::id`]).
    pub id: String,
    /// The memory text.
    pub text: String,
    /// Memory kind (`"fact"`, `"lesson"`, `"interrupt"`, …).
    pub kind: String,
    /// Caller-supplied JSON metadata.
    pub metadata: Value,
    /// TF-IDF vector of `text`, refit on the last graph recompute.
    pub vector: SparseVec,
    /// Unix-epoch seconds when the node was added.
    pub created_at: u64,
}

/// A retrieval hit: a node projected together with its relevance score.
///
/// Returned by [`MemoryGraph::search`] and [`MemoryGraph::retrieve`],
/// serialized verbatim by `POST /graph/search`, and consumed by
/// [`crate::compress::compress`] (which keeps the query-relevant sentences
/// of the top hits) and by the Stage-10 prefetcher (which warms the
/// retrieval cache from the top hits' texts).
#[derive(Debug, Clone, Serialize)]
pub struct ScoredNode {
    /// Node identifier.
    pub id: String,
    /// Memory kind.
    pub kind: String,
    /// Full memory text.
    pub text: String,
    /// Relevance score: TF-IDF cosine similarity for `search`, or the
    /// edge-blended score for `retrieve`. Not normalized across calls.
    pub score: f64,
    /// Caller-supplied JSON metadata, passed through from the node.
    pub metadata: Value,
}

// ---------------------------------------------------------------------------
// MemoryGraph
// ---------------------------------------------------------------------------

/// The semantic memory graph: nodes + directed adjacency + the corpus
/// vectorizer that gives the graph its semantics.
#[derive(Debug, Clone, Default)]
pub struct MemoryGraph {
    /// All nodes by id.
    pub nodes: HashMap<String, MemoryNode>,
    /// Adjacency list (both directions of every edge): node id → neighbor
    /// ids, best-first. `edge_count` is the sum of all list lengths.
    pub adjacency: HashMap<String, Vec<String>>,
    /// Corpus model used to vectorize node texts and queries.
    pub vectorizer: TfIdfVectorizer,
    /// Total directed-edge count, cached so [`MemoryGraph::edge_count`] is
    /// O(1) for the health/metrics/dashboard endpoints.
    edge_total: usize,
}

impl MemoryGraph {
    /// Construct an empty graph with a fresh corpus vectorizer.
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            adjacency: HashMap::new(),
            vectorizer: TfIdfVectorizer::new(),
            edge_total: 0,
        }
    }

    /// Number of nodes in the graph.
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// Total number of *directed* adjacency entries (each undirected edge
    /// is stored once per endpoint, so this is twice the edge count).
    pub fn edge_count(&self) -> usize {
        self.edge_total
    }

    /// Add (or replace) a node, then recompute every node's vector and the
    /// whole adjacency list. Returns the total number of adjacency entries
    /// in the graph after the recompute — this is the `edges_created`
    /// value surfaced by `POST /graph/add`.
    ///
    /// The full recompute is deliberate: IDF weights shift whenever the
    /// corpus changes, so reusing stale vectors would silently skew both
    /// similarity scoring and edge construction. Graphs in this engine sit
    /// in the hundreds-to-low-thousands of nodes, where an O(N²) pairwise
    /// pass per add is still microseconds-cheap.
    pub fn add(&mut self, req: AddNodeRequest) -> usize {
        // Replace semantics: pull the old text out of the corpus first.
        if let Some(old) = self.nodes.get(&req.id) {
            self.vectorizer.remove_document(&old.text);
        }
        self.vectorizer.add_document(&req.text);

        // Re-insert the node with a placeholder vector, then refit every
        // vector against the updated corpus.
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        self.nodes.insert(
            req.id.clone(),
            MemoryNode {
                id: req.id,
                text: req.text,
                kind: req.kind,
                metadata: req.metadata,
                vector: SparseVec::default(),
                created_at,
            },
        );
        self.refit_vectors();
        self.recompute_edges();
        self.edge_total
    }

    /// Refit every node's TF-IDF vector against the current corpus.
    fn refit_vectors(&mut self) {
        let texts: Vec<(String, String)> = self
            .nodes
            .iter()
            .map(|(id, n)| (id.clone(), n.text.clone()))
            .collect();
        for (id, text) in texts {
            if let Some(node) = self.nodes.get_mut(&id) {
                node.vector = self.vectorizer.vectorize(&text);
            }
        }
    }

    /// Recompute the adjacency list from pairwise cosine similarity.
    ///
    /// For every ordered pair (a, b) with similarity ≥ [`EDGE_THRESHOLD`],
    /// b becomes a candidate neighbor of a. Candidates are kept best-first
    /// and truncated to [`MAX_NEIGHBORS`]; because both directions are
    /// evaluated, each surviving edge appears in both endpoints' lists.
    fn recompute_edges(&mut self) {
        let ids: Vec<String> = self.nodes.keys().cloned().collect();
        let mut adjacency: HashMap<String, Vec<(String, f64)>> = HashMap::new();
        for a in &ids {
            adjacency.insert(a.clone(), Vec::new());
        }
        for (i, a) in ids.iter().enumerate() {
            let va = &self.nodes[a].vector;
            for b in ids.iter().skip(i + 1) {
                let sim = va.cosine(&self.nodes[b].vector);
                if sim >= EDGE_THRESHOLD {
                    adjacency.entry(a.clone()).or_default().push((b.clone(), sim));
                    adjacency.entry(b.clone()).or_default().push((a.clone(), sim));
                }
            }
        }
        let mut total = 0;
        let mut pruned: HashMap<String, Vec<String>> = HashMap::new();
        for (id, mut candidates) in adjacency {
            candidates.sort_by(|x, y| y.1.partial_cmp(&x.1).unwrap_or(std::cmp::Ordering::Equal));
            total += candidates.len().min(MAX_NEIGHBORS);
            pruned.insert(
                id,
                candidates
                    .into_iter()
                    .take(MAX_NEIGHBORS)
                    .map(|(nid, _)| nid)
                    .collect(),
            );
        }
        self.adjacency = pruned;
        self.edge_total = total;
    }

    /// Pure TF-IDF search: top `limit` nodes by cosine similarity to
    /// `query`, no edge expansion. Nodes scoring `0.0` are excluded — an
    /// unrelated corpus should not produce noise hits.
    pub fn search(&self, query: &str, limit: usize) -> Vec<ScoredNode> {
        let qv = self.vectorizer.vectorize(query);
        if qv.is_empty() {
            return Vec::new();
        }
        let mut scored: Vec<ScoredNode> = self
            .nodes
            .values()
            .map(|n| ScoredNode {
                id: n.id.clone(),
                kind: n.kind.clone(),
                text: n.text.clone(),
                score: qv.cosine(&n.vector),
                metadata: n.metadata.clone(),
            })
            .filter(|s| s.score > 0.0)
            .collect();
        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        scored
    }

    /// Pipeline retrieval (Stage 2): TF-IDF search over `top_k * 2` base
    /// candidates, then a 1-hop edge-expansion blend.
    ///
    /// Each neighbor of a base hit inherits `base_score *
    /// [`EXPANSION_WEIGHT`]` unless it already scored higher on its own.
    /// The merged list is re-sorted and truncated to `top_k`.
    pub fn retrieve(&self, query: &str, top_k: usize) -> Vec<ScoredNode> {
        let base = self.search(query, top_k.saturating_mul(2));
        if base.is_empty() {
            return Vec::new();
        }
        // score by id, seeded from the base hits.
        let mut blended: HashMap<String, f64> = HashMap::new();
        for hit in &base {
            blended.insert(hit.id.clone(), hit.score);
        }
        // Expand one hop from each base hit.
        for hit in &base {
            if let Some(neighbors) = self.adjacency.get(&hit.id) {
                for nid in neighbors {
                    let inherited = hit.score * EXPANSION_WEIGHT;
                    let entry = blended.entry(nid.clone()).or_insert(0.0);
                    if *entry < inherited {
                        *entry = inherited;
                    }
                }
            }
        }
        let mut results: Vec<ScoredNode> = blended
            .into_iter()
            .filter_map(|(id, score)| {
                self.nodes.get(&id).map(|n| ScoredNode {
                    id: n.id.clone(),
                    kind: n.kind.clone(),
                    text: n.text.clone(),
                    score,
                    metadata: n.metadata.clone(),
                })
            })
            .collect();
        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(top_k);
        results
    }

    /// Serialize the whole graph as `{ "nodes": [...], "edges": [...] }`.
    ///
    /// Edges are **deduplicated** (emitted once per undirected pair, with
    /// the lexicographically smaller id as `source`) even though the
    /// internal adjacency list stores both directions. Edge `weight` is
    /// the pairwise cosine similarity, recomputed on the fly.
    pub fn to_response(&self) -> Value {
        let nodes: Vec<Value> = self
            .nodes
            .values()
            .map(|n| {
                json!({
                    "id": n.id,
                    "kind": n.kind,
                    "text": n.text,
                    "metadata": n.metadata,
                    "created_at": n.created_at,
                })
            })
            .collect();
        let mut edges: Vec<Value> = Vec::new();
        for (id, neighbors) in &self.adjacency {
            for nid in neighbors {
                if id >= nid {
                    continue; // keep each undirected edge once
                }
                let weight = self
                    .nodes
                    .get(id)
                    .zip(self.nodes.get(nid))
                    .map(|(a, b)| a.vector.cosine(&b.vector))
                    .unwrap_or(0.0);
                edges.push(json!({ "source": id, "target": nid, "weight": weight }));
            }
        }
        json!({ "nodes": nodes, "edges": edges })
    }

    /// Wipe the graph: nodes, adjacency and the vectorizer's corpus
    /// statistics. Returns nothing; the caller snapshots
    /// [`MemoryGraph::len`] first when it wants a "cleared" count.
    pub fn clear(&mut self) {
        self.nodes.clear();
        self.adjacency.clear();
        self.edge_total = 0;
        self.vectorizer.clear();
    }
}
