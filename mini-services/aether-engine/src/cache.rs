//! Action cache + retrieval cache.
//!
//! The action cache maps `query_hash -> (query_vec, response)`. On lookup, the
//! incoming query is compared (cosine similarity) against every cached query; if
//! similarity exceeds the threshold, the cached response is returned instantly.
//!
//! The retrieval cache maps `query_hash -> (query_vec, retrieved_context)` and is
//! warmed by the speculative prefetcher so repeated / graph-adjacent retrievals
//! skip the O(N^2) graph traversal.

use crate::tfidf::{cosine, SparseVec};
use std::collections::HashMap;

pub struct CacheEntry {
    pub query_text: String,
    pub query_vec: SparseVec,
    pub response: String,
}

pub struct RetrievalEntry {
    pub query_text: String,
    pub query_vec: SparseVec,
    pub context: String,
}

pub struct ActionCache {
    pub entries: HashMap<u64, CacheEntry>,
    pub retrieval: HashMap<u64, RetrievalEntry>,
    pub threshold: f64,
}

impl ActionCache {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            retrieval: HashMap::new(),
            threshold: 0.95,
        }
    }

    /// Lookup a cached response by semantic similarity to the query.
    pub fn get(&self, query: &str, query_vec: &SparseVec) -> Option<(String, f64)> {
        // Fast path: exact hash hit.
        let h = hash_str(query);
        if let Some(e) = self.entries.get(&h) {
            return Some((e.response.clone(), 1.0));
        }
        // Semantic path: scan for a sufficiently similar cached query.
        let mut best: Option<(String, f64)> = None;
        for e in self.entries.values() {
            let s = cosine(query_vec, &e.query_vec);
            if s >= self.threshold {
                if best.as_ref().map_or(true, |b| s > b.1) {
                    best = Some((e.response.clone(), s));
                }
            }
        }
        best
    }

    pub fn put(&mut self, query: &str, query_vec: SparseVec, response: String) {
        let h = hash_str(query);
        self.entries.insert(
            h,
            CacheEntry {
                query_text: query.to_string(),
                query_vec,
                response,
            },
        );
    }

    /// Lookup a precomputed retrieved context (semantic).
    pub fn get_retrieval(&self, query: &str, query_vec: &SparseVec) -> Option<String> {
        let h = hash_str(query);
        if let Some(e) = self.retrieval.get(&h) {
            return Some(e.context.clone());
        }
        let mut best: Option<(String, f64)> = None;
        for e in self.retrieval.values() {
            let s = cosine(query_vec, &e.query_vec);
            if s >= 0.92 {
                if best.as_ref().map_or(true, |b| s > b.1) {
                    best = Some((e.context.clone(), s));
                }
            }
        }
        best.map(|(c, _)| c)
    }

    pub fn put_retrieval(&mut self, query: &str, query_vec: SparseVec, context: String) {
        let h = hash_str(query);
        self.retrieval.insert(
            h,
            RetrievalEntry {
                query_text: query.to_string(),
                query_vec,
                context,
            },
        );
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

fn hash_str(s: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}
