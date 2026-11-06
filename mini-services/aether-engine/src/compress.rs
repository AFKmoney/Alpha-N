//! # Compress — context compression via signal-preserving sentence extraction.
//!
//! [`compress`] is pipeline Stage 3: it turns the retrieved memory nodes
//! (potentially dozens of long texts) into a compact context block that
//! fits the backend model's window while keeping the sentences that
//! actually matter for the query — the "40K → 4K" step of the 10x capacity
//! multiplier.
//!
//! # Scoring model (inclusion signals)
//!
//! Every sentence of every retrieved node is scored with three signals:
//!
//! 1. **Query relevance** — the fraction of the query's distinct terms
//!    present in the sentence, plus a small bonus for repeated query-term
//!    occurrences (density). This is the dominant signal.
//! 2. **Node rank** — sentences inherit a decaying bonus from the score of
//!    the node they came from, so the top TF-IDF hits are favored.
//! 3. **Position** — earlier sentences of a node get a small linear bonus:
//!    memory texts are overwhelmingly "topic sentence first" prose, so the
//!    opening sentence carries disproportionate signal.
//!
//! Sentences are then selected greedily by score until the character
//! `budget` is exhausted, and rendered as one `## [kind] id` section per
//! contributing node. When nothing was retrieved, a short stand-in note is
//! returned so downstream prompts (and the offline-fallback response, which
//! embeds the block verbatim) have something honest to show.

use crate::graph::ScoredNode;
use crate::tfidf::tokenize;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Compress the retrieved `nodes` into a context block for `query` of at
/// most `budget` characters (the pipeline calls this with `6000`, roughly
/// 4K tokens). See the module docs for the scoring model.
///
/// The output is deterministic for the same inputs: ties in sentence score
/// break by node rank, then by sentence position, so repeated identical
/// queries compress identically (which is what makes the retrieval cache
/// tier sound).
pub fn compress(nodes: &[ScoredNode], query: &str, budget: usize) -> String {
    if nodes.is_empty() {
        return "(no semantic memories retrieved for this query)".to_string();
    }
    let query_terms: Vec<String> = tokenize(query);
    let distinct_terms: Vec<&str> = {
        let mut seen = std::collections::HashSet::new();
        query_terms
            .iter()
            .filter(|t| seen.insert(t.as_str()))
            .map(|t| t.as_str())
            .collect()
    };

    // 1. Collect candidates: (node index, sentence index, text, score).
    let mut candidates: Vec<Candidate> = Vec::new();
    for (rank, node) in nodes.iter().enumerate() {
        let sentences = split_sentences(&node.text);
        if sentences.is_empty() {
            continue;
        }
        for (pos, sentence) in sentences.iter().enumerate() {
            let score = score_sentence(
                sentence,
                &query_terms,
                &distinct_terms,
                rank,
                pos,
                sentences.len(),
            );
            candidates.push(Candidate {
                rank,
                pos,
                sentence: (*sentence).to_string(),
                score,
            });
        }
    }

    // 2. Greedy selection by score, tie-broken by (rank, pos), until the
    //    budget is spent. A sentence is skipped if it alone would overflow
    //    the section it belongs to.
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.rank.cmp(&b.rank))
            .then(a.pos.cmp(&b.pos))
    });

    // Keep, per node, the selected sentences in ORIGINAL order so the
    // rendered block reads naturally rather than by score.
    let mut picked: Vec<Vec<(usize, String)>> = vec![Vec::new(); nodes.len()];
    let mut used = 0usize;
    let header_overhead = 24usize; // "## [fact] some-node-id\n" approximation
    for cand in &candidates {
        if cand.score <= 0.0 {
            continue; // no query signal at all — never include on budget
        }
        let cost = cand.sentence.chars().count() + 1; // + newline
        if used + cost + header_overhead > budget {
            continue; // try smaller sentences; stop only when none fit
        }
        used += cost;
        picked[cand.rank].push((cand.pos, cand.sentence.clone()));
    }

    // 3. Render one section per contributing node, best node first.
    let mut out = String::with_capacity(used + nodes.len() * header_overhead);
    for (rank, node) in nodes.iter().enumerate() {
        let mut kept = std::mem::take(&mut picked[rank]);
        if kept.is_empty() {
            continue;
        }
        kept.sort_by_key(|(pos, _)| *pos);
        out.push_str(&format!("## [{}] {}\n", node.kind, node.id));
        for (_, sentence) in kept {
            out.push_str(&sentence);
            out.push('\n');
        }
        out.push('\n');
    }
    let trimmed = out.trim_end();
    if trimmed.is_empty() {
        // Every sentence lacked query signal; fall back to the top node's
        // opening so the block is never empty when memories exist.
        let node = &nodes[0];
        let first = split_sentences(&node.text)
            .into_iter()
            .next()
            .unwrap_or_default();
        format!("## [{}] {}\n{}\n", node.kind, node.id, first)
            .chars()
            .take(budget)
            .collect()
    } else {
        trimmed.to_string()
    }
}

// ---------------------------------------------------------------------------
// Internal scoring machinery
// ---------------------------------------------------------------------------

/// One sentence under consideration, pre-scored.
struct Candidate {
    /// Index of the node (in retrieval order) the sentence came from.
    rank: usize,
    /// Index of the sentence within its node.
    pos: usize,
    /// The sentence text.
    sentence: String,
    /// Inclusion score (see the module docs).
    score: f64,
}

/// Score one sentence by combining the three inclusion signals.
///
/// Weights: relevance `0.7`, node-rank `0.2`, position `0.1`. Relevance
/// itself is `0.8 * coverage + 0.2 * density`, where coverage is the
/// fraction of the query's distinct terms present and density the count of
/// query-term occurrences normalized by sentence length.
fn score_sentence(
    sentence: &str,
    query_terms: &[String],
    distinct_terms: &[&str],
    rank: usize,
    pos: usize,
    sentence_count: usize,
) -> f64 {
    if query_terms.is_empty() || sentence_count == 0 {
        return 0.0;
    }
    let words = tokenize(sentence);
    if words.is_empty() {
        return 0.0;
    }
    let present = distinct_terms
        .iter()
        .filter(|t| words.iter().any(|w| w.as_str() == **t))
        .count();
    let coverage = present as f64 / distinct_terms.len() as f64;
    let hits = words
        .iter()
        .filter(|w| query_terms.contains(*w))
        .count() as f64;
    let density = (hits / words.len() as f64).clamp(0.0, 1.0);

    let relevance = 0.8 * coverage + 0.2 * density;
    let rank_bonus = 1.0 / (1.0 + rank as f64); // 1.0, 0.5, 0.33, …
    let position_bonus = if sentence_count > 1 {
        1.0 - (pos as f64 / sentence_count as f64)
    } else {
        1.0
    };
    0.7 * relevance + 0.2 * rank_bonus + 0.1 * position_bonus
}

/// Split `text` into sentences on `.`, `!` and `?` boundaries.
///
/// Heuristics, in order: a terminator only ends a sentence when it is
/// followed by whitespace or end-of-text (so URLs and file names survive),
/// and a period between digits ("3.14") or single uppercase letters
/// ("J. Smith") is treated as part of the token. Leading/trailing
/// whitespace is trimmed; empty fragments are dropped.
fn split_sentences(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut sentences = Vec::new();
    let mut start = 0usize;
    for i in 0..chars.len() {
        let c = chars[i];
        if c != '.' && c != '!' && c != '?' {
            continue;
        }
        let next_is_space = chars.get(i + 1).map(|n| n.is_whitespace()).unwrap_or(true);
        if !next_is_space {
            continue; // e.g. "e.g." mid-token or "3.14"
        }
        // Skip decimal points and single-letter initials.
        if c == '.' {
            let prev_alpha = i > 0 && chars[i - 1].is_alphabetic();
            let prev_single = i >= 1
                && (i - start) == 1
                && chars[i - 1].is_alphabetic()
                && chars[i - 1].is_uppercase();
            let next_digit = chars.get(i + 1).map(|n| n.is_numeric()).unwrap_or(false);
            if next_digit || prev_single || (prev_alpha && i + 1 < chars.len() && chars[i + 1].is_alphabetic()) {
                continue;
            }
        }
        let sentence: String = chars[start..=i].iter().collect();
        let trimmed = sentence.trim();
        if !trimmed.is_empty() {
            sentences.push(trimmed.to_string());
        }
        start = i + 1;
    }
    let tail: String = chars[start..].iter().collect();
    let trimmed = tail.trim();
    if !trimmed.is_empty() {
        sentences.push(trimmed.to_string());
    }
    sentences
}
