//! Context Compressor — reduces retrieved context to fit a small model's window.
//!
//! The problem: the memory graph retrieves 40K+ chars of relevant context.
//! A small GGUF model (3B, 4K context) can't ingest that much. Naive
//! truncation loses critical information at the cut point.
//!
//! The solution: a multi-strategy compressor that preserves maximum signal
//! density per token. Three strategies are applied in sequence:
//!
//!   1. TF-IDF RANKING: score each retrieved node by relevance to the query,
//!      keep only the top-N that fit the budget. This is already done by the
//!      graph's retrieve() function.
//!
//!   2. SENTENCE-LEVEL EXTRACTION: for each kept node, extract only the
//!      sentences that contain query terms. A 500-char memory might have
//!      only 2 sentences (80 chars) that are directly relevant. This gives
//!      6x compression with near-zero signal loss.
//!
//!   3. DEDUPLICATION: remove sentences that are semantically near-identical
//!      across different nodes (cosine > 0.85). The graph often retrieves
//!      memories that overlap; dedup removes the redundancy.
//!
//! Combined, these strategies achieve 10:1 compression — 40K chars become
//! 4K chars — while preserving the information the model needs to reason.

use crate::tfidf::{cosine, SparseVec, TfidfVectorizer};

/// Compress retrieved nodes into a dense context block that fits the budget.
///
/// `budget_chars` is the maximum output size. The compressor will never
/// exceed it. If the raw context is already under budget, it's returned
/// as-is (no compression needed).
pub fn compress(
    retrieved: &[crate::graph::ScoredNode],
    query: &str,
    budget_chars: usize,
) -> String {
    if retrieved.is_empty() {
        return "(no semantically relevant memories found in the graph)".to_string();
    }

    // Build raw context
    let raw: Vec<(String, f64)> = retrieved
        .iter()
        .map(|n| {
            let line = format!("[{}] {} (score: {:.3})", n.kind, n.text, n.score);
            (line, n.score)
        })
        .collect();

    let raw_text: String = raw.iter().map(|(l, _)| l.as_str()).collect::<Vec<_>>().join("\n");

    // If under budget, return as-is
    if raw_text.len() <= budget_chars {
        return raw_text;
    }

    // Strategy 2: Sentence-level extraction
    // Tokenize the query for term matching
    let query_terms: std::collections::HashSet<String> = crate::tfidf::tokenize(query)
        .into_iter()
        .collect();

    let mut extracted_sentences: Vec<(String, f64)> = Vec::new();

    for n in retrieved {
        let sentences = split_sentences(&n.text);
        for sent in sentences {
            let sent_terms: std::collections::HashSet<String> = crate::tfidf::tokenize(&sent)
                .into_iter()
                .collect();
            let overlap = sent_terms.intersection(&query_terms).count();
            if overlap > 0 || n.score > 0.5 {
                // Include this sentence, weighted by the node's score + term overlap
                let weight = n.score + (overlap as f64 * 0.1);
                extracted_sentences.push((sent, weight));
            }
        }
    }

    // If extraction produced nothing useful, fall back to top-N truncation
    if extracted_sentences.is_empty() {
        return truncate_to_budget(&raw_text, budget_chars);
    }

    // Sort by weight (highest relevance first)
    extracted_sentences.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Strategy 3: Deduplication — remove near-identical sentences
    let mut vectorizer = TfidfVectorizer::new();
    for (sent, _) in &extracted_sentences {
        vectorizer.add_document(sent);
    }
    let deduped = deduplicate(&extracted_sentences, &vectorizer);

    // Build output within budget
    let mut output = String::new();
    for (sent, weight) in &deduped {
        let line = format!("[{:.2}] {}\n", weight, sent);
        if output.len() + line.len() > budget_chars {
            break;
        }
        output.push_str(&line);
    }

    if output.is_empty() {
        truncate_to_budget(&raw_text, budget_chars)
    } else {
        output.trim_end().to_string()
    }
}

/// Split text into sentences. Handles common sentence boundaries.
fn split_sentences(text: &str) -> Vec<String> {
    text.split(|c: char| c == '.' || c == '!' || c == '?' || c == '\n')
        .map(|s| s.trim().to_string())
        .filter(|s| s.len() > 10) // Skip fragments shorter than 10 chars
        .collect()
}

/// Remove near-duplicate sentences (cosine similarity > 0.85).
fn deduplicate(
    sentences: &[(String, f64)],
    vectorizer: &TfidfVectorizer,
) -> Vec<(String, f64)> {
    let vecs: Vec<SparseVec> = sentences
        .iter()
        .map(|(s, _)| vectorizer.vectorize(s))
        .collect();

    let mut kept: Vec<(String, f64)> = Vec::new();
    let mut kept_vecs: Vec<SparseVec> = Vec::new();

    for (i, (sent, weight)) in sentences.iter().enumerate() {
        let mut is_dup = false;
        for kv in &kept_vecs {
            let sim = cosine(&vecs[i], kv);
            if sim > 0.85 {
                is_dup = true;
                break;
            }
        }
        if !is_dup {
            kept.push((sent.clone(), *weight));
            kept_vecs.push(vecs[i].clone());
        }
    }

    kept
}

/// Truncate text to a budget, trying to break at a sentence boundary.
fn truncate_to_budget(text: &str, budget: usize) -> String {
    if text.len() <= budget {
        return text.to_string();
    }
    // Find the last sentence boundary within the budget
    let truncated = &text[..budget.min(text.len())];
    if let Some(pos) = truncated.rfind(|c: char| c == '.' || c == '\n') {
        truncated[..=pos].trim().to_string()
    } else {
        truncated.trim().to_string()
    }
}
