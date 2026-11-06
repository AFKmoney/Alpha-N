//! # TF-IDF — sparse term vectors with sklearn-style IDF smoothing.
//!
//! This module is the numeric core of Aether Engine's retrieval stack. It
//! provides two types:
//!
//! - [`SparseVec`] — a sparse term → weight map with L2-normalized
//!   coordinates and an O(min(|a|, |b|)) cosine similarity that always
//!   iterates over the *shorter* of the two vectors (probing the longer one
//!   by key), so comparing a short query vector against a long document
//!   vector stays cheap.
//! - [`TfIdfVectorizer`] — a streaming corpus model that tracks document
//!   frequencies and produces smoothed IDF weights using the exact formula
//!   sklearn's `TfidfVectorizer(smooth_idf=True)` uses:
//!
//!   ```text
//!   idf(t) = ln((1 + N) / (1 + df(t))) + 1
//!   ```
//!
//!   where `N` is the number of documents in the corpus and `df(t)` the
//!   number of documents containing term `t`. The `+1` terms keep unseen
//!   terms finite (unseen → `ln(1 + N) + 1`) and guarantee every weight is
//!   strictly positive, which keeps cosine similarity well-behaved on small
//!   corpora.
//!
//! # Where it is used
//!
//! - [`crate::graph`] stores one [`SparseVec`] per memory node and scores
//!   retrieval by cosine similarity;
//! - [`crate::cache`] compares incoming query vectors against cached query
//!   vectors for the semantic near-match tier;
//! - [`crate::decompose::DistillationStore`] matches new Complex queries
//!   against distilled decomposition patterns the same way;
//! - [`crate::hcm`] reuses [`tokenize`] to derive feature-hashed
//!   associative keys for the Holographic Context Memory arena.
//!
//! No external crates are involved — tokenization, IDF math and vector
//! algebra are all implemented here over `std::collections::HashMap`.

use std::collections::HashMap;

// ---------------------------------------------------------------------------
// SparseVec
// ---------------------------------------------------------------------------

/// A sparse term-frequency × IDF vector: one coordinate per distinct term.
///
/// Coordinates are L2-normalized on construction (see
/// [`TfIdfVectorizer::vectorize`]), so the L2 norm of any vector produced by
/// the vectorizer is exactly `1.0` and cosine similarity reduces to a plain
/// dot product. The type still exposes [`SparseVec::norm`] because callers
/// may build vectors from other sources.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SparseVec {
    /// Term → weighted coordinate. Keys are lowercase tokens produced by
    /// [`tokenize`].
    terms: HashMap<String, f64>,
}

impl SparseVec {
    /// Build a sparse vector from an already-computed term → weight map.
    ///
    /// This is the constructor [`TfIdfVectorizer::vectorize`] uses; weights
    /// are expected to be pre-multiplied by IDF but are NOT re-normalized
    /// here (the vectorizer normalizes before calling).
    pub fn from_map(terms: HashMap<String, f64>) -> Self {
        Self { terms }
    }

    /// `true` when the vector has no non-zero coordinates (e.g. the text
    /// contained only stopwords or single characters).
    pub fn is_empty(&self) -> bool {
        self.terms.is_empty()
    }

    /// L2 (Euclidean) norm of the vector.
    pub fn norm(&self) -> f64 {
        self.terms.values().map(|w| w * w).sum::<f64>().sqrt()
    }

    /// Dot product with `other`, computed in O(min(|a|, |b|)).
    ///
    /// The iteration always walks the *shorter* map and probes the longer
    /// one by key, so a 6-term query vector against a 400-term document
    /// vector costs 6 lookups rather than 400.
    pub fn dot(&self, other: &SparseVec) -> f64 {
        let (short, long) = if self.terms.len() <= other.terms.len() {
            (self, other)
        } else {
            (other, self)
        };
        short
            .terms
            .iter()
            .filter_map(|(t, w)| long.terms.get(t).map(|w2| w * w2))
            .sum()
    }

    /// Cosine similarity between `self` and `other`, in `[0, 1]` for the
    /// non-negative weight space TF-IDF produces (clamped against float
    /// drift). Returns `0.0` if either vector is empty.
    pub fn cosine(&self, other: &SparseVec) -> f64 {
        if self.terms.is_empty() || other.terms.is_empty() {
            return 0.0;
        }
        let denom = self.norm() * other.norm();
        if denom <= f64::EPSILON {
            return 0.0;
        }
        (self.dot(other) / denom).clamp(0.0, 1.0)
    }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/// English stopwords dropped before counting terms. Keeping the list short
/// matters more than being exhaustive: IDF already down-weights ubiquitous
/// terms on real corpora, so the stopword list only needs to cover the
/// degenerate cases (single conjunctions/pronouns that would otherwise
/// dominate tiny one-sentence memories).
const STOPWORDS: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if",
    "in", "into", "is", "it", "its", "no", "not", "of", "on", "or", "such",
    "that", "the", "their", "then", "there", "these", "they", "this", "to",
    "was", "will", "with", "what", "when", "where", "which", "who", "why",
    "how", "you", "your", "i", "me", "my", "we", "our", "us", "do", "does",
    "did", "can", "could", "should", "would",
];

/// Split `text` into normalized terms: lowercased, split on every
/// non-alphanumeric character, single-character fragments and stopwords
/// dropped.
///
/// ASCII and non-ASCII word characters alike are kept (`is_alphanumeric`),
/// so memory texts in other scripts still produce usable terms. The
/// tokenizer is also reused by [`crate::hcm::hash_to_vector`], which needs
/// the exact same token stream so HCM keys and TF-IDF vectors agree on what
/// a "term" is.
pub fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() > 1 && !STOPWORDS.contains(t))
        .map(|t| t.to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// TfIdfVectorizer
// ---------------------------------------------------------------------------

/// Streaming TF-IDF corpus model: tracks how many documents have been seen
/// and in how many of them each term occurs, then weights query/document
/// vectors with sklearn-style smoothed IDF.
///
/// "Streaming" means documents are added and removed one at a time (see
/// [`TfIdfVectorizer::add_document`] / [`TfIdfVectorizer::remove_document`])
/// as nodes enter and leave the memory graph; there is no batch `fit` step.
#[derive(Debug, Clone, Default)]
pub struct TfIdfVectorizer {
    /// Total number of documents currently in the corpus.
    doc_count: u64,
    /// Number of documents containing each term (document frequency).
    doc_freq: HashMap<String, u64>,
}

impl TfIdfVectorizer {
    /// Construct an empty vectorizer (zero documents, empty vocabulary).
    pub fn new() -> Self {
        Self::default()
    }

    /// Add one document's text to the corpus: bumps `doc_count` and the
    /// document frequency of every distinct term in the text.
    pub fn add_document(&mut self, text: &str) {
        let mut seen = std::collections::HashSet::new();
        for term in tokenize(text) {
            if seen.insert(term.clone()) {
                *self.doc_freq.entry(term).or_insert(0) += 1;
            }
        }
        self.doc_count += 1;
    }

    /// Remove one document's text from the corpus (used when a memory node
    /// is replaced with new text, so the old text stops polluting IDF).
    /// Saturates at zero — removing a text that was never added is a no-op.
    pub fn remove_document(&mut self, text: &str) {
        let mut seen = std::collections::HashSet::new();
        for term in tokenize(text) {
            if seen.insert(term.clone()) {
                if let Some(df) = self.doc_freq.get_mut(&term) {
                    *df = df.saturating_sub(1);
                }
            }
        }
        self.doc_count = self.doc_count.saturating_sub(1);
    }

    /// Smoothed inverse document frequency for `term`, matching sklearn's
    /// `smooth_idf=True` behavior: `ln((1 + N) / (1 + df)) + 1`. Unseen
    /// terms get `ln(1 + N) + 1` — high, but finite.
    fn idf(&self, term: &str) -> f64 {
        let df = self.doc_freq.get(term).copied().unwrap_or(0) as f64;
        ((1.0 + self.doc_count as f64) / (1.0 + df)).ln() + 1.0
    }

    /// Vectorize `text` against the current corpus: term frequencies
    /// (normalized by document length) weighted by IDF, then L2-normalized
    /// so [`SparseVec::cosine`] is a plain dot product.
    ///
    /// Vectorizing never mutates the corpus — queries are transients, not
    /// documents. Terms absent from the corpus still receive weight from
    /// the smoothing formula, which keeps novel queries from vectorizing to
    /// the zero vector.
    pub fn vectorize(&self, text: &str) -> SparseVec {
        let tokens = tokenize(text);
        if tokens.is_empty() {
            return SparseVec::default();
        }
        // Raw term counts.
        let mut tfs: HashMap<String, f64> = HashMap::new();
        for t in &tokens {
            *tfs.entry(t.clone()).or_insert(0.0) += 1.0;
        }
        // tf × idf, with tf normalized by document length.
        let total = tokens.len() as f64;
        let mut terms = HashMap::with_capacity(tfs.len());
        for (t, count) in tfs {
            terms.insert(t, (count / total) * self.idf(&t));
        }
        // L2-normalize.
        let vec = SparseVec::from_map(terms);
        let norm = vec.norm();
        if norm > f64::EPSILON {
            let mut normalized = HashMap::with_capacity(vec.terms.len());
            for (t, w) in &vec.terms {
                normalized.insert(t.clone(), w / norm);
            }
            return SparseVec::from_map(normalized);
        }
        vec
    }

    /// Wipe all corpus statistics (document count + document frequencies).
    /// Called by [`crate::graph::MemoryGraph::clear`] so a cleared graph
    /// also forgets its vocabulary.
    pub fn clear(&mut self) {
        self.doc_count = 0;
        self.doc_freq.clear();
    }
}
