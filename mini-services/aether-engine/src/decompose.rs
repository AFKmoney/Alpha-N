//! # Cognitive Decomposer + Knowledge Distillation (Innovations #2, #4)
//!
//! A small model (3B params) can't solve complex problems in one shot. But
//! it CAN solve simple problems. The decomposer breaks a complex query into
//! a tree of sub-queries, each simple enough for the small model to solve
//! reliably. The answers are then synthesized into a final response.
//!
//! This is inspired by chain-of-thought prompting, but architecturally
//! superior: instead of hoping the model stays on track through a long
//! reasoning chain, we make **separate calls** for each step — each with
//! its own fresh context window. The model never has to "remember" step 1
//! when it's on step 5. The pipeline remembers FOR it.
//!
//! # Pipeline stages owned by this module
//!
//!   1. **ANALYZE** — classify the query complexity
//!      ([`analyze_complexity`]): `Simple`, `Moderate`, or `Complex`.
//!   2. **DECOMPOSE** — if complex, break into sub-questions
//!      ([`decompose`]).
//!   3. **SOLVE** — run each sub-question through the backend model
//!      (driven by [`handlers`](crate::handlers)).
//!   4. **SYNTHESIZE** — combine sub-answers into a final response (a
//!      `"synth"` sub-question whose dependencies are all the others).
//!   5. **VERIFY** — check the response for consistency; retry if needed
//!      (currently delegated to [`crate::atd`]).
//!
//! The decomposer uses the memory graph to inform decomposition — if a
//! similar problem was solved before, the successful decomposition is
//! reused via the [`DistillationStore`] (knowledge distillation).
//!
//! # Where it sits in the pipeline
//!
//! Stages 4 (complexity analysis), 5 (decompose), 6 (solve), and 9
//! (distillation store) of the cognitive pipeline (see [`crate::handlers`]).

use crate::graph::ScoredNode;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The result of analyzing a query's complexity. Drives which branch of the
/// cognitive pipeline runs ([`handlers::chat_completions`]).
#[derive(Debug, Clone, Serialize)]
pub enum Complexity {
    /// One-shot is sufficient — no decomposition, no think step.
    Simple,
    /// Two-step: think, then answer. Triggered by single-question queries
    /// with at least one complexity signal (e.g. a single `?` plus a
    /// reasoning cue).
    Moderate,
    /// Multi-step decomposition required. Triggered by multiple questions
    /// in one query or 3+ complexity signals.
    Complex,
}

/// A sub-question in a decomposition tree. Sub-questions form a DAG via
/// [`depends_on`](Self::depends_on); the pipeline solves them in
/// topological order (currently: source order, since the decomposer emits
/// them in dependency order) and injects each dependency's answer into the
/// next sub-question's prompt.
#[derive(Debug, Clone, Serialize)]
pub struct SubQuestion {
    /// Stable identifier (`"sub-0"`, `"sub-1"`, `"synth"`, …). Used as the
    /// key in the `answers` map during pipeline execution.
    pub id: String,
    /// The sub-question text, fed to the backend model as the user message.
    pub text: String,
    /// IDs of sub-questions whose answers feed into this one. The pipeline
    /// injects each dependency's answer into the prompt via
    /// [`build_sub_prompt`].
    pub depends_on: Vec<String>,
    /// Filled in by the pipeline after the sub-question is solved. `None`
    /// until the backend returns an answer.
    pub answer: Option<String>,
}

/// The full pipeline state for a single query. Tracks everything the
/// `/pipeline` and `/health` endpoints need to report what happened during
/// a request, plus everything Stage 9 (distillation) needs to decide
/// whether to cache the decomposition pattern.
#[derive(Debug, Clone, Serialize)]
pub struct PipelineState {
    /// The original user query.
    pub original_query: String,
    /// The classified complexity (Simple / Moderate / Complex).
    pub complexity: Complexity,
    /// The decomposition tree (empty for Simple / Moderate queries).
    pub sub_questions: Vec<SubQuestion>,
    /// The final synthesized response (set in Stage 7).
    pub synthesis: Option<String>,
    /// Whether ATD verification passed on the first or retry attempt.
    pub verification_passed: bool,
    /// Human-readable names of the stages that ran, in order. Surfaced via
    /// `/pipeline` for live tracing.
    pub stages_completed: Vec<String>,
    /// Number of backend model calls made (for cost/latency telemetry).
    pub total_backend_calls: usize,
    /// Total wall-clock latency of the request, in milliseconds.
    pub total_latency_ms: u64,
}

impl PipelineState {
    /// Create a fresh pipeline state for the given query. Complexity starts
    /// at `Simple` and is overwritten by the caller after
    /// [`analyze_complexity`] runs.
    pub fn new(query: &str) -> Self {
        Self {
            original_query: query.to_string(),
            complexity: Complexity::Simple,
            sub_questions: Vec::new(),
            synthesis: None,
            verification_passed: false,
            stages_completed: Vec::new(),
            total_backend_calls: 0,
            total_latency_ms: 0,
        }
    }
}

/// Analyze query complexity using heuristic signals.
///
/// A query is `Complex` if it contains:
///   - multiple questions (detected by `?` count > 1), or
///   - three or more complexity signals from the catalog below.
///
/// A query is `Moderate` if it has at least one complexity signal or a
/// single question mark. Otherwise it's `Simple`.
///
/// # Signal catalog
///
/// Conditional reasoning (`"if"`, `"then"`, `"what would happen"`),
/// multi-step instructions (`"step by step"`, `"first"`, `"after that"`),
/// comparison (`"compare"`, `"difference between"`, `"vs"`), code generation
/// (`"write a function"`, `"implement"`, `"create"`), architectural decisions
/// (`"design"`, `"architecture"`, `"refactor"`), and a few more.
///
/// This is intentionally a *rule-based* classifier — no LLM call needed —
/// so it runs in microseconds and never adds latency to the hot path.
pub fn analyze_complexity(query: &str) -> Complexity {
    let q = query.to_lowercase();
    let question_marks = query.matches('?').count();

    // Complex signals — each is a substring checked via `contains`.
    // Duplicate entries (e.g. `"then "` appears twice) are intentional:
    // they bump the score for queries that lean on multi-step phrasing.
    let complex_signals = [
        "if ", "then ", "what would happen", "step by step", "first ",
        "then ", "after that", "compare", "difference between", " vs ",
        "write a function", "implement", "create a", "design", "architecture",
        "refactor", "optimize", "how do i", "how to", "explain how",
        "multi-step", "pipeline", "sequence",
    ];

    let complex_hits = complex_signals.iter().filter(|s| q.contains(*s)).count();

    if question_marks > 1 || complex_hits >= 3 {
        Complexity::Complex
    } else if complex_hits >= 1 || question_marks == 1 {
        Complexity::Moderate
    } else {
        Complexity::Simple
    }
}

/// Decompose a complex query into sub-questions.
///
/// This uses a rule-based decomposition strategy (no LLM call needed — the
/// decomposition logic itself is "compiled intelligence" that runs instantly
/// in Rust). The strategy is tried in order; the first one that matches
/// wins:
///
/// 1. **Conjunction split**: if the query contains `" and "` and multiple
///    question marks, split on `" and "` into separate sub-questions, then
///    add a `"synth"` sub-question that depends on all of them.
/// 2. **Numbered steps**: if the query contains two or more numbered lines
///    (`"1."`, `"2."`, …), each line becomes a chained sub-question that
///    depends on the previous one.
/// 3. **Comparison**: if the query contains `"compare"` or
///    `"difference between"`, extract the two operands and generate three
///    sub-questions: characteristics of A, characteristics of B, and a
///    synthesis that contrasts them.
/// 4. **Generic fallback**: emit a three-step decomposition
///    (context → components → synthesis) that works for any complex query.
///
/// Each sub-question is simple enough for a 3B model to answer well.
///
/// `_retrieved` is currently unused (kept in the signature so future
/// graph-informed decomposition strategies can be layered in without an
/// API break).
pub fn decompose(query: &str, _retrieved: &[ScoredNode]) -> Vec<SubQuestion> {
    let q = query.trim();
    let mut subs = Vec::new();

    // Strategy 1: Split on " and " for multi-part questions.
    // Triggered only when there are also multiple question marks — this
    // avoids splitting "compare A and B" (handled by Strategy 3 instead).
    if q.to_lowercase().contains(" and ") && q.matches('?').count() > 1 {
        let parts: Vec<&str> = q.split(" and ").collect();
        for (i, part) in parts.iter().enumerate() {
            let cleaned = part.trim().trim_end_matches('?').trim();
            subs.push(SubQuestion {
                id: format!("sub-{}", i),
                text: format!("{}?", cleaned),
                depends_on: Vec::new(),
                answer: None,
            });
        }
        // Synthesis question depends on every sub-question, so the model
        // sees all partial answers when producing the final response.
        subs.push(SubQuestion {
            id: "synth".to_string(),
            text: format!("Synthesize the following into a coherent answer to: \"{}\"", q),
            depends_on: (0..parts.len()).map(|i| format!("sub-{}", i)).collect(),
            answer: None,
        });
        return subs;
    }

    // Strategy 2: Numbered steps. Each line starting with a digit followed
    // by `.` is treated as a step. Steps are chained (each depends on the
    // previous) so the model solves them in order.
    let numbered: Vec<&str> = q.lines().filter(|l| {
        let trimmed = l.trim();
        trimmed.starts_with(|c: char| c.is_ascii_digit()) && trimmed.contains('.')
    }).collect();
    if numbered.len() >= 2 {
        for (i, step) in numbered.iter().enumerate() {
            // Strip the leading "N." prefix.
            let cleaned = step.trim().splitn(2, '.').nth(1).unwrap_or(step).trim();
            // Chain: each step depends on the previous one (empty for i==0).
            let prev = if i > 0 { vec![format!("sub-{}", i - 1)] } else { vec![] };
            subs.push(SubQuestion {
                id: format!("sub-{}", i),
                text: cleaned.to_string(),
                depends_on: prev,
                answer: None,
            });
        }
        return subs;
    }

    // Strategy 3: Comparison decomposition. Extract the two operands of
    // "compare X and Y" / "difference between X and Y" and emit three
    // sub-questions: characteristics of each operand, then a synthesis.
    let q_lower = q.to_lowercase();
    if q_lower.contains("compare") || q_lower.contains("difference between") {
        // Extract the two things being compared.
        let after_compare = if q_lower.contains("compare") {
            q.splitn(2, "compare").nth(1).unwrap_or("")
        } else {
            q.splitn(2, "difference between").nth(1).unwrap_or("")
        };
        let parts: Vec<&str> = after_compare.split(" and ").collect();
        if parts.len() >= 2 {
            let a = parts[0].trim().trim_end_matches('?').trim();
            let b = parts[1].trim().trim_end_matches('?').trim();
            subs.push(SubQuestion { id: "sub-0".into(), text: format!("What are the key characteristics of {}?", a), depends_on: vec![], answer: None });
            subs.push(SubQuestion { id: "sub-1".into(), text: format!("What are the key characteristics of {}?", b), depends_on: vec![], answer: None });
            subs.push(SubQuestion { id: "synth".into(), text: format!("Based on the above, what are the key differences between {} and {}?", a, b), depends_on: vec!["sub-0".into(), "sub-1".into()], answer: None });
            return subs;
        }
    }

    // Strategy 4: Generic decomposition (the safety net). Works for any
    // complex query that didn't match a more specific strategy.
    subs.push(SubQuestion {
        id: "sub-0".into(),
        text: format!("What is the context and background information needed to understand: \"{}\"?", q),
        depends_on: vec![],
        answer: None,
    });
    subs.push(SubQuestion {
        id: "sub-1".into(),
        text: format!("What are the key components or steps involved in: \"{}\"?", q),
        depends_on: vec!["sub-0".into()],
        answer: None,
    });
    subs.push(SubQuestion {
        id: "synth".into(),
        text: format!("Based on the above, provide a complete answer to: \"{}\"", q),
        depends_on: vec!["sub-0".into(), "sub-1".into()],
        answer: None,
    });

    subs
}

/// Build the augmented prompt for a sub-question, injecting the answers of
/// its dependencies.
///
/// The dependency answers are appended under a `"Previous step results:"`
/// header so the backend model can chain its reasoning across sub-questions
/// without ever holding more than one sub-question's context in its window.
pub fn build_sub_prompt(sub: &SubQuestion, answers: &HashMap<String, String>) -> String {
    let mut prompt = sub.text.clone();
    if !sub.depends_on.is_empty() {
        prompt.push_str("\n\nPrevious step results:");
        for dep in &sub.depends_on {
            if let Some(ans) = answers.get(dep) {
                prompt.push_str(&format!("\n  [{}]: {}", dep, ans));
            }
        }
    }
    prompt
}

/// Verify a response for basic consistency (legacy heuristic verifier).
///
/// Checks:
///   1. Non-empty and > 20 chars.
///   2. Doesn't contain `"I don't know"` / `"I cannot"` / `"I'm unable"` as
///      the entire (or near-entire) response.
///   3. Doesn't repeat the same sentence 3+ times (loop detection).
///   4. Contains at least one query keyword (length > 3) — guards against
///      off-topic answers.
///
/// # Status
///
/// This function is retained as a public API entry point but is **not
/// currently invoked** by the main pipeline — Stage 8 verification has been
/// upgraded to the Asymmetric Tensor Dueling check in [`crate::atd::verify`],
/// which provides a richer dual-graph collision (likelihood vs entropy)
/// rather than a binary pass/fail. [`verify_response`] is kept for callers
/// that want the lightweight heuristic check (e.g. tests, fallback paths,
/// or future modules that need a quick sanity gate without the full ATD
/// machinery).
pub fn verify_response(response: &str, query: &str) -> bool {
    if response.trim().len() < 20 {
        return false;
    }

    let lower = response.to_lowercase();
    let refusal_phrases = ["i don't know", "i cannot", "i'm unable", "i am unable", "i don't have"];
    for phrase in &refusal_phrases {
        if lower.trim() == *phrase || (lower.len() < 50 && lower.contains(phrase)) {
            return false;
        }
    }

    // Loop detection: check if any sentence repeats 3+ times. A common
    // small-model failure mode is to emit the same sentence verbatim over
    // and over once it gets stuck.
    let sentences: Vec<&str> = response.split('.').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for s in &sentences {
        *counts.entry(s.to_lowercase()).or_insert(0) += 1;
        if counts[s.to_lowercase().as_str()] >= 3 {
            return false;
        }
    }

    // Keyword overlap: at least 1 query keyword (length > 3) should appear
    // in the response. Short words are skipped because they're usually
    // stopwords ("the", "and", "for") that would always match.
    let query_words: Vec<&str> = query.split_whitespace().filter(|w| w.len() > 3).collect();
    if !query_words.is_empty() {
        let has_overlap = query_words.iter().any(|w| lower.contains(&w.to_lowercase()));
        if !has_overlap {
            return false;
        }
    }

    true
}

/// Knowledge distillation store — caches successful decomposition patterns
/// (Innovation #4).
///
/// When a query is successfully decomposed and solved, the decomposition
/// pattern is stored. Future similar queries reuse the pattern, skipping
/// the decomposition stage entirely. This is how the engine gets faster
/// over time — it learns **how to break down problems**.
///
/// Similarity for reuse is cosine-similarity on the query's TF-IDF vector,
/// with a `0.80` threshold (deliberately lower than the action cache's
/// `0.95` because reusing a decomposition pattern for a *similar* query is
/// safe — the sub-questions are still solved freshly against the backend).
pub struct DistillationStore {
    /// `query_hash → DistilledPattern`. Keyed by hash so a verbatim repeat
    /// of a successful query is an `O(1)` hit before the semantic scan.
    pub patterns: HashMap<u64, DistilledPattern>,
}

/// One cached decomposition pattern. The original query text and vector are
/// retained so future queries can be matched against them via cosine
/// similarity.
#[derive(Clone)]
pub struct DistilledPattern {
    pub query_text: String,
    pub query_vec: crate::tfidf::SparseVec,
    pub sub_questions: Vec<SubQuestion>,
    /// Number of times this pattern has been successfully reused. Bumped
    /// on every store() of the same query hash; used as a gate
    /// (`success_count > 0`) in [`find`](DistillationStore::find).
    pub success_count: usize,
}

impl DistillationStore {
    /// Create an empty distillation store.
    pub fn new() -> Self {
        Self {
            patterns: HashMap::new(),
        }
    }

    /// Find a similar previously-successful decomposition pattern.
    ///
    /// `_query` is unused — the lookup is purely vector-based (cosine on
    /// the TF-IDF vectors). Kept in the signature for symmetry with
    /// [`store`](Self::store) and for future text-based heuristics.
    ///
    /// Returns the cloned sub-questions of the best match above the `0.80`
    /// similarity threshold, or `None` if no pattern is similar enough.
    pub fn find(&self, _query: &str, query_vec: &crate::tfidf::SparseVec) -> Option<Vec<SubQuestion>> {
        let mut best: Option<(Vec<SubQuestion>, f64)> = None;
        for p in self.patterns.values() {
            let sim = crate::tfidf::cosine(query_vec, &p.query_vec);
            if sim > 0.80 && p.success_count > 0 {
                if best.as_ref().map_or(true, |b| sim > b.1) {
                    best = Some((p.sub_questions.clone(), sim));
                }
            }
        }
        best.map(|(s, _)| s)
    }

    /// Store a successful decomposition pattern. If the same query hash
    /// already exists, only the success counter is bumped (the sub-questions
    /// and query vector are left intact — they were correct the first time).
    pub fn store(&mut self, query: &str, query_vec: crate::tfidf::SparseVec, subs: Vec<SubQuestion>) {
        let h = hash_str(query);
        if let Some(p) = self.patterns.get_mut(&h) {
            p.success_count += 1;
        } else {
            self.patterns.insert(h, DistilledPattern {
                query_text: query.to_string(),
                query_vec,
                sub_questions: subs,
                success_count: 1,
            });
        }
    }

    /// Number of distinct patterns currently stored.
    pub fn len(&self) -> usize {
        self.patterns.len()
    }
}

/// Deterministic 64-bit hash of a string, used as the distillation-store
/// primary key. Mirrors [`crate::cache::hash_str`] so a query that hits the
/// action cache could in principle also hit the distillation store with the
/// same key (they are separate tables, but the hashing is consistent).
fn hash_str(s: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}
