//! In-memory semantic memory graph.
//!
//! Every memory is a node. Edges are TF-IDF cosine-similarity links. When a node
//! is added, similarity is computed against all existing nodes and bidirectional
//! edges are created for the top-K most similar.

use crate::tfidf::{cosine, SparseVec, TfidfVectorizer};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Deserialize)]
pub struct AddNodeRequest {
    pub id: String,
    pub text: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default = "default_metadata")]
    pub metadata: serde_json::Value,
}

fn default_kind() -> String {
    "fact".to_string()
}
fn default_metadata() -> serde_json::Value {
    serde_json::json!({})
}

#[derive(Clone, Serialize)]
pub struct NodeResponse {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub metadata: serde_json::Value,
}

#[derive(Clone, Serialize)]
pub struct EdgeResponse {
    pub from: String,
    pub to: String,
    pub weight: f64,
}

#[derive(Clone, Serialize)]
pub struct ScoredNode {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub metadata: serde_json::Value,
    pub score: f64,
}

/// Internal node — carries its precomputed sparse vector.
pub struct Node {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub metadata: serde_json::Value,
    pub vector: SparseVec,
}

pub struct MemoryGraph {
    pub nodes: HashMap<String, Node>,
    pub adjacency: HashMap<String, Vec<(String, f64)>>,
    pub vectorizer: TfidfVectorizer,
    pub top_k: usize,
}

impl MemoryGraph {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            adjacency: HashMap::new(),
            vectorizer: TfidfVectorizer::new(),
            top_k: 5,
        }
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn edge_count(&self) -> usize {
        self.adjacency.values().map(|v| v.len()).collect::<Vec<_>>().iter().sum()
    }

    pub fn clear(&mut self) {
        self.nodes.clear();
        self.adjacency.clear();
        self.vectorizer = TfidfVectorizer::new();
    }

    /// Add (or replace) a node, then recompute all vectors (IDF changed) and all edges.
    pub fn add(&mut self, req: AddNodeRequest) -> usize {
        // Replace existing node with the same id: remove its document contribution first.
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
        // IDF changed for every term — recompute all vectors.
        self.recompute_vectors();
        // Recompute the full adjacency list.
        let created = self.recompute_edges();
        created
    }

    fn recompute_vectors(&mut self) {
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

    /// Recompute all edges. Returns the number of edges created for the most-recently
    /// added node (used as an informational stat in the add response).
    fn recompute_edges(&mut self) -> usize {
        self.adjacency.clear();
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
            sims.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            let top: Vec<(String, f64)> = sims.into_iter().take(self.top_k).collect();
            total_created = total_created.saturating_add(top.len());
            self.adjacency.insert(id.clone(), top);
        }
        total_created
    }

    /// Semantic search: top-N nodes by cosine similarity to the query.
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

    /// Retrieval-augmented fetch: top-N nodes by cosine, then 1-hop edge expansion.
    /// Neighbors receive a blended score (direct relevance + graph proximity).
    pub fn retrieve(&self, query: &str, top_n: usize) -> Vec<ScoredNode> {
        let qvec = self.vectorizer.vectorize(query);
        // Top-N direct hits.
        let mut direct: Vec<(String, f64)> = self
            .nodes
            .values()
            .map(|n| (n.id.clone(), cosine(&qvec, &n.vector)))
            .filter(|(_, s)| *s > 0.0)
            .collect();
        direct.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let top: Vec<(String, f64)> = direct.into_iter().take(top_n).collect();

        let mut scores: HashMap<String, f64> = HashMap::new();
        for (id, s) in &top {
            *scores.entry(id.clone()).or_insert(0.0) += s;
            // 1-hop expansion via adjacency.
            if let Some(nbrs) = self.adjacency.get(id) {
                for (nbr_id, edge_w) in nbrs {
                    let nbr_direct = self
                        .nodes
                        .get(nbr_id)
                        .map(|n| cosine(&qvec, &n.vector))
                        .unwrap_or(0.0);
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

    /// Serialize the whole graph for the Memory Network visualizer.
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
