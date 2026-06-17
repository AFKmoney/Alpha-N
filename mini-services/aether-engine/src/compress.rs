//! # Context Compressor (Innovation #5)
//!
//! Reduces retrieved context to fit a small model's window.
//!
//! The problem: the memory graph retrieves 40K+ chars of relevant context.
//! A small GGUF model (3B, 4K context) can't ingest that much. Naive
//! truncation loses critical information at the cut point.
//!
//! The solution: a multi-strategy compressor that preserves maximum signal
//! density per token. Three strategies are applied in sequence:
//!
//!   1. **TF-IDF RANKING**: score each retrieved node by relevance to the
//!      query, keep only the top-N that fit the budget. This is already done
//!      by the graph's [`retrieve`](crate::graph::MemoryGraph::retrieve)
//!      function, so the compressor starts from a pre-ranked list.
//!
//!   2. **SENTENCE-LEVEL EXTRACTION**: for each kept node, extract only the
//!      sentences that contain query terms. A 500-char memory might have
//!      only 2 sentences (80 chars) that are directly relevant. This gives
//!      ~6x compression with near-zero signal loss. Sentences from
//!      high-scoring nodes (`score > 0.5`) are kept even without term
//!      overlap because the graph already considered them relevant.
//!
//!   3. **DEDUPLICATION**: remove sentences that are semantically
//!      near-identical across different nodes (cosine > 0.85). The graph
//!      often retrieves memories that overlap; dedup removes the redundancy.
//!
//! Combined, these strategies achieve 10:1 compression — 40K chars become
//! 4K chars — while preserving the information the model needs to reason.
//!
//! # Where it sits in the pipeline
//!
//! Stage 3 of the cognitive pipeline (see [`crate::handlers`]). Runs after
//! Stage-2 graph retrieval and before Stage-4 complexity analysis. Output is
//! cached in the retrieval cache and warmed speculatively by the prefetcher.

use crate::tfidf::{cosine, SparseVec, TfidfVectorizer};

/// Compress retrieved nodes into a dense context block that fits the budget.
///
/// `budget_chars` is the maximum output size. The compressor will never
/// exceed it. If the raw context is already under budget, it's returned
/// as-is (no compression needed). If sentence-level extraction produces
/// nothing useful, the compressor falls back to sentence-boundary-aware
/// truncation of the raw text.
pub fn compress(
    retrieved: &[crate::graph::ScoredNode],
    query: &str,
    budget_chars: usize,
) -> String {
    if retrieved.is_empty() {
        return "(no semantically relevant memories found in the graph)".to_string();
    }

    // Build the raw (uncompressed) context: one line per node, prefixed
    // with the kind tag and the retrieval score so downstream consumers
    // (and humans debugging via /graph/search) can see provenance.
    let raw: Vec<(String, f64)> = retrieved
        .iter()
        .map(|n| {
            let line = format!("[{}] {} (score: {:.3})", n.kind, n.text, n.score);
            (line, n.score)
        })
        .collect();

    let raw_text: String = raw.iter().map(|(l, _)| l.as_str()).collect::<Vec<_>>().join("\n");

    // Fast path: if it already fits, skip the expensive extraction pass.
    if raw_text.len() <= budget_chars {
        return raw_text;
    }

    // Strategy 2: Sentence-level extraction.
    // Tokenize the query once for term-matching; reused across every node.
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
            // Term overlap is the primary inclusion signal; a high node
            // score (>0.5) is a secondary signal that keeps a sentence
            // even when no query terms appear in it (the graph deemed the
            // node relevant via its 1-hop expansion).
            let overlap = sent_terms.intersection(&query_terms).count();
            if overlap > 0 || n.score > 0.5 {
                // Weight = node score + small bonus per overlapping term.
                // Used to sort the final output (highest relevance first).
                let weight = n.score + (overlap as f64 * 0.1);
                extracted_sentences.push((sent, weight));
            }
        }
    }

    // If extraction produced nothing useful, fall back to top-N truncation.
    if extracted_sentences.is_empty() {
        return truncate_to_budget(&raw_text, budget_chars);
    }

    // Sort by weight (highest relevance first) so the budget slice keeps
    // the most important sentences.
    extracted_sentences.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Strategy 3: Deduplication — remove near-identical sentences.
    // A *separate* vectorizer is built over just the extracted sentences
    // so the dedup cosine scores reflect intra-batch similarity rather
    // than corpus-wide IDF (which would be polluted by the graph nodes).
    let mut vectorizer = TfidfVectorizer::new();
    for (sent, _) in &extracted_sentences {
        vectorizer.add_document(sent);
    }
    let deduped = deduplicate(&extracted_sentences, &vectorizer);

    // Build output within budget. Each surviving sentence is prefixed with
    // its weight so the model can see relative relevance at a glance.
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

/// Split text into sentences. Handles common sentence boundaries (`.`, `!`,
/// `?`, newline). Fragments shorter than 10 chars are dropped because they
/// are usually punctuation noise or section labels rather than real
/// sentences.
fn split_sentences(text: &str) -> Vec<String> {
    text.split(|c: char| c == '.' || c == '!' || c == '?' || c == '\n')
        .map(|s| s.trim().to_string())
        .filter(|s| s.len() > 10) // Skip fragments shorter than 10 chars
        .collect()
}

/// Remove near-duplicate sentences (cosine similarity > 0.85).
///
/// Greedy: iterate the sentences in their pre-sorted order, keeping each
/// one only if it isn't already covered by a kept sentence. The threshold
/// of `0.85` is deliberately high so that two sentences sharing a few
/// common terms but expressing distinct ideas are both retained.
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
///
/// If the budget falls mid-sentence, we walk backwards from the cut point
/// to the nearest `.` or `\n` and cut there — losing a few extra chars is
/// preferable to handing the model a half-finished thought.
fn truncate_to_budget(text: &str, budget: usize) -> String {
    if text.len() <= budget {
        return text.to_string();
    }
    // Clamp the slice to text.len() defensively (budget could exceed len
    // only via a caller bug, but the min() costs nothing).
    let truncated = &text[..budget.min(text.len())];
    if let Some(pos) = truncated.rfind(|c: char| c == '.' || c == '\n') {
        truncated[..=pos].trim().to_string()
    } else {
        truncated.trim().to_string()
    }
}
