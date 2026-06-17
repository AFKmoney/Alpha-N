//! # Action Cache + Retrieval Cache (Innovations #6 and #7)
//!
//! Two complementary in-memory caches that share the same TF-IDF
//! infrastructure as the semantic memory graph:
//!
//! - **Action cache** ([`ActionCache::entries`]): maps
//!   `query_hash → (query_vec, response)`. On lookup, the incoming query is
//!   compared (cosine similarity) against every cached query; if similarity
//!   exceeds the [`threshold`](ActionCache::threshold) (default `0.95`), the
//!   cached response is returned instantly, skipping the entire cognitive
//!   pipeline. This is Stage 1 of the pipeline.
//!
//! - **Retrieval cache** ([`ActionCache::retrieval`]): maps
//!   `query_hash → (query_vec, retrieved_context)`. Warmed by the
//!   speculative prefetcher (Stage 10) so that repeated / graph-adjacent
//!   retrievals skip the `O(N^2)` graph traversal in Stage 2 and the
//!   expensive compressor pass in Stage 3.
//!
//! Both caches use a two-tier lookup: exact-hash fast path first, then a
//! semantic-similarity scan. The semantic scan threshold is intentionally
//! lower for retrieval (`0.92`) than for action responses (`0.95`) because
//! a slightly-off context block is recoverable downstream, whereas a
//! slightly-off final answer is not.

use crate::tfidf::{cosine, SparseVec};
use std::collections::HashMap;

/// One entry in the action cache. The original query text is retained for
/// debugging and for potential future re-vectorization if the global IDF
/// drifts; the precomputed [`SparseVec`] is what's actually used for
/// semantic lookup.
pub struct CacheEntry {
    pub query_text: String,
    pub query_vec: SparseVec,
    pub response: String,
}

/// One entry in the retrieval cache. Same shape as [`CacheEntry`] but
/// stores a compressed context block instead of a final response.
pub struct RetrievalEntry {
    pub query_text: String,
    pub query_vec: SparseVec,
    pub context: String,
}

/// The combined action + retrieval cache. Both tables live behind a single
/// `Mutex` so they can be locked together (Stage 1 of the pipeline reads
/// the action cache while Stage 3 reads the retrieval cache, and both can
/// be warmed by the prefetcher in parallel).
pub struct ActionCache {
    /// Action-cache table: `query_hash → CacheEntry`.
    pub entries: HashMap<u64, CacheEntry>,
    /// Retrieval-cache table: `query_hash → RetrievalEntry`.
    pub retrieval: HashMap<u64, RetrievalEntry>,
    /// Cosine-similarity threshold above which two queries are considered
    /// "the same question" for action-cache purposes (default `0.95`).
    pub threshold: f64,
}

impl ActionCache {
    /// Create an empty cache with the default action threshold of `0.95`.
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            retrieval: HashMap::new(),
            threshold: 0.95,
        }
    }

    /// Lookup a cached response by semantic similarity to the query.
    ///
    /// Two-tier: an `O(1)` exact-hash fast path is tried first; if it
    /// misses, an `O(N)` scan over all cached query vectors finds the
    /// best similarity above [`threshold`](Self::threshold). Returns the
    /// cached response and the similarity score (1.0 for an exact hit).
    pub fn get(&self, query: &str, query_vec: &SparseVec) -> Option<(String, f64)> {
        // Fast path: exact hash hit. Avoids the cosine scan entirely for
        // verbatim repeats of a previously-answered question.
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

    /// Insert (or replace) a final-response cache entry.
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

    /// Lookup a precomputed retrieved context (semantic). Same two-tier
    /// strategy as [`get`](Self::get) but with a relaxed `0.92` threshold
    /// because retrieval context is consumed downstream and a slightly-off
    /// context is recoverable (a slightly-off final answer is not).
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

    /// Insert (or replace) a retrieval-context cache entry. Called by the
    /// Stage-3 compressor (on miss) and by the Stage-10 prefetcher (warm).
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

    /// Number of entries in the action cache (excludes retrieval entries).
    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

/// Deterministic 64-bit hash of a string, used as the cache key for the
/// exact-match fast path. Uses the stdlib `DefaultHasher` (SipHash-1-3) —
/// not cryptographically secure, but collision-resistant enough for a
/// process-local cache and very fast.
fn hash_str(s: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}
