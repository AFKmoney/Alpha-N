//! # Cache — two-tier retrieval caching.
//!
//! [`ActionCache`] holds two independent tiers, both keyed by the raw query
//! string and fingerprinted with the query's TF-IDF [`SparseVec`]:
//!
//! 1. **Action tier** — final *responses*. [`ActionCache::get`] is the
//!    pipeline's Stage 1: a hit short-circuits the entire cognitive
//!    pipeline and returns instantly. Lookup is two-phase: an exact
//!    string-match fast path (a `HashMap` probe, no vector math at all),
//!    then a semantic near-match pass that cosine-scores the incoming
//!    query vector against every cached query vector and returns the best
//!    entry at or above [`ACTION_SIMILARITY_THRESHOLD`] (0.95).
//! 2. **Retrieval tier** — compressed *context blocks* (Stage 3 output).
//!    Warmed speculatively by the Stage-10 prefetcher and by
//!    `POST /cache/prefetch`, consulted before the (comparatively
//!    expensive) compressor runs. Semantic matching uses the slightly
//!    looser [`RETRIEVAL_SIMILARITY_THRESHOLD`] (0.92) because a context
//!    block only has to be *topically* right, not verbatim.
//!
//! Both tiers are bounded FIFO rings (see [`MAX_ACTION_ENTRIES`] /
//! [`MAX_RETRIEVAL_ENTRIES`]): when a tier is full, the oldest entry is
//! evicted. Entries are re-`put` on the same query string replace the old
//! entry in place, so a repeated question refreshes its recency.
//!
//! All matching is O(entries) linear scans — with a few hundred entries and
//! O(min(|a|,|b|)) dot products this is single-digit microseconds, far
//! below the cost of the backend round-trip a hit avoids.

use crate::tfidf::SparseVec;
use std::collections::HashMap;
use std::time::Instant;

/// Cosine similarity required for a semantic action-cache hit
/// (mirrors `cache_threshold` surfaced by `GET /config`).
pub const ACTION_SIMILARITY_THRESHOLD: f64 = 0.95;

/// Cosine similarity required for a semantic retrieval-cache hit
/// (mirrors `retrieval_threshold` surfaced by `GET /config`).
pub const RETRIEVAL_SIMILARITY_THRESHOLD: f64 = 0.92;

/// Maximum entries kept in the action tier before FIFO eviction.
const MAX_ACTION_ENTRIES: usize = 512;

/// Maximum entries kept in the retrieval tier before FIFO eviction.
const MAX_RETRIEVAL_ENTRIES: usize = 512;

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/// One action-tier entry: the query's vector fingerprint and the final
/// response that was produced for it. (The query string itself is the
/// `HashMap` key — see [`ActionCache::actions`].)
#[derive(Debug, Clone)]
struct ActionEntry {
    /// TF-IDF vector of the query (semantic-matching fingerprint).
    vector: SparseVec,
    /// The final pipeline response served on a hit.
    response: String,
    /// When the entry was written (FIFO eviction ordering).
    created: Instant,
}

/// One retrieval-tier entry: the query's vector fingerprint and its
/// pre-compressed context block.
#[derive(Debug, Clone)]
struct RetrievalEntry {
    /// TF-IDF vector of the query (semantic-matching fingerprint).
    vector: SparseVec,
    /// The compressed context block produced for this query.
    context: String,
    /// When the entry was written (FIFO eviction ordering).
    created: Instant,
}

// ---------------------------------------------------------------------------
// ActionCache
// ---------------------------------------------------------------------------

/// The engine's two-tier retrieval cache (see the module docs).
///
/// Shared behind an `Arc<tokio::sync::Mutex<…>>` in
/// [`AppState`](crate::AppState); every method is a short critical section.
#[derive(Debug, Default)]
pub struct ActionCache {
    /// Action tier: final responses, keyed by exact query string.
    actions: HashMap<String, ActionEntry>,
    /// Insertion order of the action tier (FIFO eviction queue).
    action_order: Vec<String>,
    /// Retrieval tier: compressed context blocks, keyed by exact query.
    retrievals: HashMap<String, RetrievalEntry>,
    /// Insertion order of the retrieval tier (FIFO eviction queue).
    retrieval_order: Vec<String>,
}

impl ActionCache {
    /// Construct an empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// Total number of entries across both tiers. This is the
    /// `cache_entries` value in `GET /health`, the `cache_size` value on
    /// the dashboard, and the `aether_cache_size` Prometheus gauge.
    pub fn len(&self) -> usize {
        self.actions.len() + self.retrievals.len()
    }

    /// Number of action-tier entries (final responses).
    pub fn action_len(&self) -> usize {
        self.actions.len()
    }

    /// Number of retrieval-tier entries (compressed context blocks).
    pub fn retrieval_len(&self) -> usize {
        self.retrievals.len()
    }

    /// Action-tier lookup (pipeline Stage 1).
    ///
    /// Phase 1 — exact hit: a `HashMap` probe on the raw query string,
    /// returning `(response, 1.0)` with zero vector math. Phase 2 —
    /// semantic hit: cosine-similarity scan of the incoming vector against
    /// every cached query vector; the best entry at or above
    /// [`ACTION_SIMILARITY_THRESHOLD`] wins. `None` means the pipeline
    /// must run in full.
    ///
    /// Never mutates: a hit does not bump recency, so the borrow can stay
    /// shared (`&self`) and concurrent lookups never contend with callers
    /// that hold the lock immutably.
    pub fn get(&self, query: &str, vector: &SparseVec) -> Option<(String, f64)> {
        if let Some(entry) = self.actions.get(query) {
            return Some((entry.response.clone(), 1.0));
        }
        if vector.is_empty() {
            return None;
        }
        let mut best: Option<(f64, &ActionEntry)> = None;
        for entry in self.actions.values() {
            let sim = vector.cosine(&entry.vector);
            if sim >= ACTION_SIMILARITY_THRESHOLD
                && best.map(|(b, _)| sim > b).unwrap_or(true)
            {
                best = Some((sim, entry));
            }
        }
        best.map(|(sim, entry)| (entry.response.clone(), sim))
    }

    /// Action-tier write-back: store the final `response` for `query`.
    /// Re-putting an existing query replaces the entry (keeping its
    /// position in the FIFO queue).
    pub fn put(&mut self, query: &str, vector: SparseVec, response: String) {
        if self.actions.contains_key(query) {
            if let Some(entry) = self.actions.get_mut(query) {
                entry.vector = vector;
                entry.response = response;
                entry.created = Instant::now();
            }
            return;
        }
        self.action_order.push(query.to_string());
        self.actions.insert(
            query.to_string(),
            ActionEntry {
                vector,
                response,
                created: Instant::now(),
            },
        );
        evict(&mut self.actions, &mut self.action_order, MAX_ACTION_ENTRIES);
    }

    /// Retrieval-tier lookup (pipeline Stage 3). Exact match first, then a
    /// semantic scan at [`RETRIEVAL_SIMILARITY_THRESHOLD`]. Returns the
    /// cached context block, if any.
    pub fn get_retrieval(&self, query: &str, vector: &SparseVec) -> Option<String> {
        if let Some(entry) = self.retrievals.get(query) {
            return Some(entry.context.clone());
        }
        if vector.is_empty() {
            return None;
        }
        let mut best: Option<(f64, &RetrievalEntry)> = None;
        for entry in self.retrievals.values() {
            let sim = vector.cosine(&entry.vector);
            if sim >= RETRIEVAL_SIMILARITY_THRESHOLD
                && best.map(|(b, _)| sim > b).unwrap_or(true)
            {
                best = Some((sim, entry));
            }
        }
        best.map(|(_, entry)| entry.context.clone())
    }

    /// Retrieval-tier write: store the compressed `context` for `query`.
    /// Called by the pipeline on a compressor miss and by the Stage-10
    /// prefetcher when warming graph-adjacent queries.
    pub fn put_retrieval(&mut self, query: &str, vector: SparseVec, context: String) {
        if self.retrievals.contains_key(query) {
            if let Some(entry) = self.retrievals.get_mut(query) {
                entry.vector = vector;
                entry.context = context;
                entry.created = Instant::now();
            }
            return;
        }
        self.retrieval_order.push(query.to_string());
        self.retrievals.insert(
            query.to_string(),
            RetrievalEntry {
                vector,
                context,
                created: Instant::now(),
            },
        );
        evict(
            &mut self.retrievals,
            &mut self.retrieval_order,
            MAX_RETRIEVAL_ENTRIES,
        );
    }

    /// Wipe both tiers. Returns nothing; callers snapshot [`ActionCache::len`]
    /// first when they want a "cleared" count for the response body.
    pub fn clear(&mut self) {
        self.actions.clear();
        self.action_order.clear();
        self.retrievals.clear();
        self.retrieval_order.clear();
    }
}

/// Evict the oldest entries until `map.len() <= cap`, using `order` as the
/// FIFO queue. Entries whose key is missing from `order` (replaced in
/// place) are skipped defensively.
///
/// A free function (not a method) on purpose: the call sites pass two
/// disjoint `&mut` borrows of `self`'s fields, which is only legal without
/// a `&mut self` receiver.
fn evict<T>(map: &mut HashMap<String, T>, order: &mut Vec<String>, cap: usize) {
    while map.len() > cap {
        match order.first() {
            Some(key) if map.contains_key(key) => {
                map.remove(key);
                order.remove(0);
            }
            Some(_) => {
                order.remove(0); // stale queue entry — drop it and retry
            }
            None => break,
        }
    }
}
