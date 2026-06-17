//! TF-IDF vectorizer + cosine similarity implemented from scratch.
//!
//! No external ML dependencies. Sparse vectors are stored as `HashMap<String, f64>`
//! (term -> tf-idf weight) plus a precomputed L2 norm for fast cosine similarity.

use std::collections::{HashMap, HashSet};

/// Tokenize a string into lowercase alphanumeric terms (length > 1).
pub fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty() && s.len() > 1)
        .map(|s| s.to_string())
        .collect()
}

/// A sparse term-vector with a precomputed L2 norm.
#[derive(Clone, Default)]
pub struct SparseVec {
    pub terms: HashMap<String, f64>,
    pub norm: f64,
}

/// Streaming TF-IDF vectorizer.
///
/// Maintains document-frequency (df) counts and the total document count (N).
/// IDF is computed with sklearn-style smoothing: `idf(t) = ln((1 + N) / (1 + df)) + 1`.
/// TF is normalized by the maximum term frequency in the document.
/// Vectors are L2-normalized-friendly (norm stored separately) for O(n) cosine similarity.
pub struct TfidfVectorizer {
    pub df: HashMap<String, usize>,
    pub doc_count: usize,
}

impl TfidfVectorizer {
    pub fn new() -> Self {
        Self {
            df: HashMap::new(),
            doc_count: 0,
        }
    }

    pub fn add_document(&mut self, text: &str) {
        let unique: HashSet<String> = tokenize(text).into_iter().collect();
        for t in &unique {
            *self.df.entry(t.clone()).or_insert(0) += 1;
        }
        self.doc_count += 1;
    }

    pub fn remove_document(&mut self, text: &str) {
        let unique: HashSet<String> = tokenize(text).into_iter().collect();
        for t in &unique {
            if let Some(c) = self.df.get_mut(t) {
                if *c > 0 {
                    *c -= 1;
                }
                if *c == 0 {
                    self.df.remove(t);
                }
            }
        }
        if self.doc_count > 0 {
            self.doc_count -= 1;
        }
    }

    pub fn idf(&self, term: &str) -> f64 {
        let df = *self.df.get(term).unwrap_or(&0) as f64;
        let n = self.doc_count as f64;
        ((1.0 + n) / (1.0 + df)).ln() + 1.0
    }

    /// Vectorize text into a sparse TF-IDF vector.
    pub fn vectorize(&self, text: &str) -> SparseVec {
        let tokens = tokenize(text);
        if tokens.is_empty() {
            return SparseVec::default();
        }
        let mut tf: HashMap<String, f64> = HashMap::new();
        for t in &tokens {
            *tf.entry(t.clone()).or_insert(0.0) += 1.0;
        }
        let max_tf = tf.values().cloned().fold(0.0_f64, f64::max).max(1.0);
        let mut terms: HashMap<String, f64> = HashMap::new();
        let mut sum_sq = 0.0;
        for (t, c) in &tf {
            let weight = (c / max_tf) * self.idf(t);
            terms.insert(t.clone(), weight);
            sum_sq += weight * weight;
        }
        SparseVec {
            terms,
            norm: sum_sq.sqrt(),
        }
    }
}

/// Cosine similarity between two sparse vectors — O(min(|a|,|b|)).
pub fn cosine(a: &SparseVec, b: &SparseVec) -> f64 {
    if a.norm == 0.0 || b.norm == 0.0 {
        return 0.0;
    }
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
