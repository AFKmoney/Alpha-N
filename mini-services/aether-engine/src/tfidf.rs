//! # TF-IDF Vectorizer + Cosine Similarity
//!
//! Foundational text-representation layer used by every retrieval mechanism in
//! Aether Engine (the semantic memory graph, the action cache, the distillation
//! store, the CLT convergence detector, and the context compressor all build
//! on top of this module).
//!
//! Implemented from scratch — **no external ML dependencies**. Sparse vectors
//! are stored as `HashMap<String, f64>` (term → TF-IDF weight) plus a
//! precomputed L2 norm so that cosine similarity is O(min(|a|, |b|)) rather
//! than O(|a| + |b|).
//!
//! # Weighting Scheme
//!
//! - **IDF** uses sklearn-style smoothing to keep it finite on unseen terms:
//!   `idf(t) = ln((1 + N) / (1 + df(t))) + 1`
//! - **TF** is normalized by the maximum raw term frequency in the document
//!   (so a single term repeated 100 times doesn't dominate).
//! - The resulting vector is **not** re-normalized to unit length; instead
//!   the L2 norm is stored alongside the terms so cosine can divide once
//!   per comparison rather than per query.
//!
//! # Where it sits in the pipeline
//!
//! Innovations 1 (semantic memory graph), 4 (distillation), 6 (action cache),
//! and 9 (CLT convergence) all consume the [`cosine`] / [`SparseVec`] types
//! defined here.

use std::collections::{HashMap, HashSet};

/// Tokenize a string into lowercase alphanumeric terms (length > 1).
///
/// Single-character tokens are dropped because they are almost always
/// stop-word fragments ("a", "I", "1") that carry no semantic signal and
/// would inflate IDF noise. Punctuation and whitespace are treated as
/// delimiters.
pub fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty() && s.len() > 1)
        .map(|s| s.to_string())
        .collect()
}

/// A sparse term-vector with a precomputed L2 norm.
///
/// Storing the norm separately lets [`cosine`] run in
/// `O(min(|a.terms|, |b.terms|))` — it iterates the smaller map and looks
/// up matching terms in the larger one, then divides by `a.norm * b.norm`.
#[derive(Clone, Default)]
pub struct SparseVec {
    /// Term → TF-IDF weight.
    pub terms: HashMap<String, f64>,
    /// Precomputed `sqrt(sum(weight^2))`. Zero for the empty vector.
    pub norm: f64,
}

/// Streaming TF-IDF vectorizer.
///
/// Maintains document-frequency (`df`) counts and the total document count
/// (`N`). IDF is computed with sklearn-style smoothing:
/// `idf(t) = ln((1 + N) / (1 + df)) + 1`. TF is normalized by the maximum
/// term frequency in the document. Vectors are L2-normalized-friendly (norm
/// stored separately) for O(min(|a|,|b|)) cosine similarity.
///
/// The vectorizer is *streaming*: documents can be added or removed at any
/// time via [`add_document`](Self::add_document) /
/// [`remove_document`](Self::remove_document), and the IDF of every term
/// updates accordingly. This is what allows the memory graph to replace a
/// node in-place without rebuilding the corpus from scratch.
pub struct TfidfVectorizer {
    /// Document frequency per term: how many documents contain the term.
    pub df: HashMap<String, usize>,
    /// Total number of documents currently in the corpus.
    pub doc_count: usize,
}

impl TfidfVectorizer {
    /// Create an empty vectorizer (zero documents, empty `df` table).
    pub fn new() -> Self {
        Self {
            df: HashMap::new(),
            doc_count: 0,
        }
    }

    /// Add a document to the corpus, incrementing `df` for each unique term.
    ///
    /// Only *unique* terms are counted so that a single document repeating
    /// the same word 100 times does not skew the global IDF.
    pub fn add_document(&mut self, text: &str) {
        let unique: HashSet<String> = tokenize(text).into_iter().collect();
        for t in &unique {
            *self.df.entry(t.clone()).or_insert(0) += 1;
        }
        self.doc_count += 1;
    }

    /// Remove a document from the corpus.
    ///
    /// This is the inverse of [`add_document`](Self::add_document) and is
    /// used when a graph node is being replaced — the old document's term
    /// contributions must be subtracted before the new one is added, so the
    /// global IDF stays consistent. Terms whose `df` drops to zero are
    /// pruned from the table to keep it from growing without bound.
    pub fn remove_document(&mut self, text: &str) {
        let unique: HashSet<String> = tokenize(text).into_iter().collect();
        for t in &unique {
            if let Some(c) = self.df.get_mut(t) {
                if *c > 0 {
                    *c -= 1;
                }
                // Prune zero-count terms so the df table doesn't leak.
                if *c == 0 {
                    self.df.remove(t);
                }
            }
        }
        if self.doc_count > 0 {
            self.doc_count -= 1;
        }
    }

    /// Compute the inverse-document-frequency of `term` with sklearn-style
    /// smoothing: `ln((1 + N) / (1 + df)) + 1`.
    ///
    /// The `+1` inside the log prevents division by zero for unseen terms,
    /// and the outer `+1` ensures IDF is always positive (so a term present
    /// in every document still receives a small positive weight rather than
    /// zero — useful for short queries where every term matters).
    pub fn idf(&self, term: &str) -> f64 {
        let df = *self.df.get(term).unwrap_or(&0) as f64;
        let n = self.doc_count as f64;
        ((1.0 + n) / (1.0 + df)).ln() + 1.0
    }

    /// Vectorize text into a sparse TF-IDF vector.
    ///
    /// The returned vector's [`norm`](SparseVec::norm) is precomputed as
    /// `sqrt(sum(weight^2))` so downstream cosine similarity is a single
    /// dot-product-and-divide rather than a re-scan of the map.
    pub fn vectorize(&self, text: &str) -> SparseVec {
        let tokens = tokenize(text);
        if tokens.is_empty() {
            return SparseVec::default();
        }
        // Raw term frequencies for this document.
        let mut tf: HashMap<String, f64> = HashMap::new();
        for t in &tokens {
            *tf.entry(t.clone()).or_insert(0.0) += 1.0;
        }
        // Normalize by max TF so a single repeated token doesn't dominate.
        let max_tf = tf.values().cloned().fold(0.0_f64, f64::max).max(1.0);
        let mut terms: HashMap<String, f64> = HashMap::new();
        let mut sum_sq = 0.0;
        for (t, c) in &tf {
            let weight = (c / max_tf) * self.idf(t);
            terms.insert(t.clone(), weight);
            // Accumulate sum of squares for the L2 norm in the same pass.
            sum_sq += weight * weight;
        }
        SparseVec {
            terms,
            norm: sum_sq.sqrt(),
        }
    }
}

/// Cosine similarity between two sparse vectors — `O(min(|a|, |b|))`.
///
/// Iterates over the *smaller* of the two term maps and probes the larger
/// one for matches, accumulating the dot product. Final division by
/// `a.norm * b.norm` is skipped if either vector is the zero vector (norm 0),
/// which also covers the degenerate empty-vector case.
pub fn cosine(a: &SparseVec, b: &SparseVec) -> f64 {
    if a.norm == 0.0 || b.norm == 0.0 {
        return 0.0;
    }
    // Pick the smaller map to iterate so the inner lookup count is minimized.
    let (small, large) = if a.terms.len() < b.terms.len() {
        (&a.terms, &b.terms)
    } else {
        (&b.terms, &a.terms)
    };
    let mut dot = 0.0;
    for (t, w) in small {
        if let Some(w2) = large.get(t) {
            dot += w * w2;
        }
    }
    dot / (a.norm * b.norm)
}
