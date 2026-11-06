//! # Decompose — cognitive question decomposition & knowledge distillation.
//!
//! This module implements pipeline Stages 4, 5 and 9:
//!
//! - [`analyze_complexity`] (Stage 4) classifies a query as
//!   [`Complexity::Simple`] (one-shot), [`Complexity::Moderate`] (think,
//!   then answer) or [`Complexity::Complex`] (full decomposition).
//! - [`decompose`] (Stage 5) breaks a Complex query into a dependency-
//!   ordered list of [`SubQuestion`]s using one of four strategies
//!   ([`Strategy`]), always ending in a `"synth"` synthesis question that
//!   depends on everything before it.
//! - [`build_sub_prompt`] renders one sub-question together with the
//!   answers of its dependencies, so the backend model only ever holds a
//!   single step in its head — the whole point of decomposition.
//! - [`DistillationStore`] (Stage 9) remembers the decomposition pattern
//!   of every Complex query that passed ATD verification, keyed by the
//!   query's TF-IDF vector, so a *semantically similar* future query can
//!   reuse the proven pattern instead of decomposing from scratch.
//!
//! # Strategies
//!
//! The four strategies are selected by [`select_strategy`] from surface
//! features of the query (comparison markers, causal/process chains,
//! multi-clause conjunctions, breadth markers) and dispatched in
//! [`decompose`]:
//!
//! | Strategy | Shape | Example query |
//! |---|---|---|
//! | [`Strategy::Chain`] | linear steps, each depends on the previous | "how does X lead to Y" |
//! | [`Strategy::FanOut`] | independent facets feeding one synthesis | "what are A and B" |
//! | [`Strategy::Comparative`] | two sides, then a comparison | "compare A vs B" |
//! | [`Strategy::Hierarchical`] | definition → mechanism → implication | "explain X" |
//!
//! # Topological guarantee
//!
//! Whatever the strategy emits is passed through [`toposort`], which
//! guarantees the returned vector is in dependency order: by the time the
//! solve loop in `handlers.rs` reaches sub-question N, every id in its
//! `depends_on` has already been answered. Cycles (a malformed internal
//! DAG) are broken deterministically rather than erroring — a Complex
//! query must always decompose into *something* solvable.

use crate::graph::ScoredNode;
use crate::tfidf::SparseVec;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Cosine similarity at which a stored decomposition pattern counts as a
/// reusable match for a new query (see [`DistillationStore::find`]).
const DISTILL_SIMILARITY_THRESHOLD: f64 = 0.85;

/// Maximum answers injected into a sub-question prompt and the character
/// cap per injected answer (see [`build_sub_prompt`]).
const MAX_DEPENDENCY_ANSWERS: usize = 8;
const ANSWER_EXCERPT_CHARS: usize = 400;

// ---------------------------------------------------------------------------
// Complexity (Stage 4)
// ---------------------------------------------------------------------------

/// The cognitive complexity class of a query, decided by
/// [`analyze_complexity`] and driving the pipeline's branching:
///
/// - **Simple** → a single one-shot backend call;
/// - **Moderate** → two calls (think, then answer);
/// - **Complex** → decomposition + sequential solving + synthesis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Complexity {
    /// One clause, few words, no composition — answer directly.
    Simple,
    /// Some depth but a single coherent question — think first, then answer.
    Moderate,
    /// Multiple clauses/facets or a causal chain — decompose and solve.
    Complex,
}

/// Classify `query` into a [`Complexity`] tier.
///
/// The heuristic scores surface signals: word count, question marks,
/// comma-separated clauses, and composition markers ("and then",
/// "compare", "impact", "explain how", "steps", …). Score ≥ 3 → Complex;
/// score ≥ 1 (or more than 12 words) → Moderate; otherwise Simple. The
/// thresholds are tuned so ordinary follow-up questions stay Simple/Moderate
/// and only genuinely multi-part questions pay the decomposition cost.
pub fn analyze_complexity(query: &str) -> Complexity {
    let words = query.split_whitespace().count();
    let questions = query.matches('?').count();
    let clauses = query.matches(',').count() + 1;
    let lower = query.to_lowercase();

    let mut score: u32 = 0;
    if words > 20 {
        score += 2;
    } else if words > 12 {
        score += 1;
    }
    if questions > 1 {
        score += 1;
    }
    if clauses > 2 {
        score += 1;
    }
    const MARKERS: &[&str] = &[
        "and then", "compare", "versus", " vs ", "impact", "effect of",
        "explain how", "why does", "steps", "relationship between", "first",
        "second", "finally", "multiple", "list", "analyze", "difference",
    ];
    for marker in MARKERS {
        if lower.contains(*marker) {
            score += 1;
        }
    }

    if score >= 3 {
        Complexity::Complex
    } else if score >= 1 || words > 12 {
        Complexity::Moderate
    } else {
        Complexity::Simple
    }
}

// ---------------------------------------------------------------------------
// Strategies & SubQuestion (Stage 5)
// ---------------------------------------------------------------------------

/// Which of the four decomposition shapes [`decompose`] used to build a
/// sub-question set. Carried on each [`SubQuestion`] so prompts and
/// diagnostics can name the pattern ("chain step 2 of 3").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Strategy {
    /// Linear dependency chain: q2 depends on q1, q3 on q2, …
    Chain,
    /// Independent parallel facets, all feeding the final synthesis.
    FanOut,
    /// Two opposing sides extracted first, then compared.
    Comparative,
    /// Breadth-first drill-down: definition → mechanism → implications.
    Hierarchical,
}

impl Strategy {
    /// Human-readable name, used in sub-question prompts.
    pub fn label(&self) -> &'static str {
        match self {
            Strategy::Chain => "chain",
            Strategy::FanOut => "fan-out",
            Strategy::Comparative => "comparative",
            Strategy::Hierarchical => "hierarchical",
        }
    }
}

/// One step of a decomposition: a self-contained question, the ids of the
/// sub-questions whose answers it builds on, and the [`Strategy`] that
/// produced it.
///
/// Ids are `"q1"`, `"q2"`, … for the steps and `"synth"` for the final
/// synthesis question (the solve loop special-cases that id).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubQuestion {
    /// Step identifier (`"q1"`, …, `"synth"`).
    pub id: String,
    /// The question text, phrased to be answerable in isolation.
    pub question: String,
    /// Ids of sub-questions whose answers this step builds on. Guaranteed
    /// to reference only *earlier* entries (topological order).
    pub depends_on: Vec<String>,
    /// The decomposition strategy that generated this step.
    pub strategy: Strategy,
}

/// Pick a [`Strategy`] for `query` from its surface features.
///
/// Comparative beats everything (an explicit "compare/vs" is unambiguous);
/// then causal/process markers select Chain; breadth markers select
/// Hierarchical; conjunction clauses select FanOut; the default is FanOut,
/// which degrades most gracefully for arbitrary multi-part questions.
fn select_strategy(query: &str) -> Strategy {
    let lower = query.to_lowercase();
    let has = |needle: &str| lower.contains(needle);
    if has("compare") || has(" versus ") || has(" vs ") || has("difference between") {
        return Strategy::Comparative;
    }
    if has("how does") || has("how do") || has("lead to") || has("and then")
        || has("cause") || has("process") || has("steps to")
    {
        return Strategy::Chain;
    }
    if has("explain") || has("overview") || has("everything about")
        || has("what is") || has("tell me about")
    {
        return Strategy::Hierarchical;
    }
    Strategy::FanOut
}

/// Extract the query's topic phrase: the longest run of meaningful
/// (non-stopword) tokens, used to phrase sub-questions. Falls back to the
/// raw query when the query is all stopwords.
fn topic_of(query: &str) -> String {
    let tokens = crate::tfidf::tokenize(query);
    if tokens.is_empty() {
        return query.trim().to_string();
    }
    tokens.join(" ")
}

/// Decompose `query` into a dependency-ordered sub-question list.
///
/// `retrieved` (the Stage-2 graph hits) grounds the first sub-question: if
/// the graph has memories about the topic, the decomposition opens with a
/// recall step over them, which measurably improves small-model accuracy
/// (the model is asked to *read*, not *remember*).
///
/// Every strategy appends a `"synth"` sub-question depending on all prior
/// steps; the result is passed through [`toposort`] before returning.
pub fn decompose(query: &str, retrieved: &[ScoredNode]) -> Vec<SubQuestion> {
    let strategy = select_strategy(query);
    let topic = topic_of(query);

    let mut subs: Vec<SubQuestion> = Vec::new();
    // Optional grounding step over retrieved memories.
    if let Some(top) = retrieved.first() {
        subs.push(SubQuestion {
            id: "q0".to_string(),
            question: format!(
                "According to the retrieved memory \"{}\", what is known about: {topic}?",
                top.text.chars().take(160).collect::<String>()
            ),
            depends_on: Vec::new(),
            strategy,
        });
    }

    match strategy {
        Strategy::Chain => {
            subs.push(SubQuestion {
                id: "q1".to_string(),
                question: format!("Identify the starting condition or cause of: {topic}."),
                depends_on: prior_ids(&subs),
                strategy,
            });
            subs.push(SubQuestion {
                id: "q2".to_string(),
                question: format!(
                    "Describe the mechanism that leads from the starting condition of \"{topic}\" to its consequence."
                ),
                depends_on: prior_ids(&subs),
                strategy,
            });
            subs.push(SubQuestion {
                id: "q3".to_string(),
                question: format!(
                    "What is the final outcome or implication of the mechanism above for \"{topic}\"?"
                ),
                depends_on: prior_ids(&subs),
                strategy,
            });
        }
        Strategy::FanOut => {
            subs.push(SubQuestion {
                id: "q1".to_string(),
                question: format!("Answer the first facet of this question: {topic}."),
                depends_on: Vec::new(),
                strategy,
            });
            subs.push(SubQuestion {
                id: "q2".to_string(),
                question: format!("Answer the second facet of this question: {topic}."),
                depends_on: Vec::new(),
                strategy,
            });
            subs.push(SubQuestion {
                id: "q3".to_string(),
                question: format!("Answer any remaining facets of this question: {topic}."),
                depends_on: Vec::new(),
                strategy,
            });
        }
        Strategy::Comparative => {
            subs.push(SubQuestion {
                id: "q1".to_string(),
                question: format!("Describe the first side of the comparison: {topic}."),
                depends_on: Vec::new(),
                strategy,
            });
            subs.push(SubQuestion {
                id: "q2".to_string(),
                question: format!(
                    "Describe the opposing side that \"{topic}\" is being compared against."
                ),
                depends_on: Vec::new(),
                strategy,
            });
            subs.push(SubQuestion {
                id: "q3".to_string(),
                question: format!(
                    "State the key differences and similarities between the two sides described above."
                ),
                depends_on: prior_ids(&subs),
                strategy,
            });
        }
        Strategy::Hierarchical => {
            subs.push(SubQuestion {
                id: "q1".to_string(),
                question: format!("Define precisely what \"{topic}\" is."),
                depends_on: Vec::new(),
                strategy,
            });
            subs.push(SubQuestion {
                id: "q2".to_string(),
                question: format!(
                    "Explain how \"{topic}\" works — the mechanism or process behind it."
                ),
                depends_on: prior_ids(&subs),
                strategy,
            });
            subs.push(SubQuestion {
                id: "q3".to_string(),
                question: format!(
                    "What are the implications, limitations, and practical consequences of \"{topic}\"?"
                ),
                depends_on: prior_ids(&subs),
                strategy,
            });
        }
    }

    // Synthesis step: depends on every non-synthesis sub-question.
    let synth_deps: Vec<String> = subs.iter().map(|s| s.id.clone()).collect();
    subs.push(SubQuestion {
        id: "synth".to_string(),
        question: format!(
            "Synthesize the answers above into one clear, complete, well-structured final answer to the original question: \"{query}\". Do not introduce new claims."
        ),
        depends_on: synth_deps,
        strategy,
    });

    toposort(subs)
}

/// Ids of every sub-question already in `subs` (used to wire `depends_on`).
fn prior_ids(subs: &[SubQuestion]) -> Vec<String> {
    subs.iter().map(|s| s.id.clone()).collect()
}

/// Order `subs` so every entry comes after all entries it depends on
/// (deterministic: ready nodes are emitted in original order). Cycles are
/// broken by emitting the earliest remaining node — decomposition must
/// always produce a solvable sequence, never an error.
fn toposort(subs: Vec<SubQuestion>) -> Vec<SubQuestion> {
    let by_id: HashMap<String, SubQuestion> = subs
        .iter()
        .map(|s| (s.id.clone(), s.clone()))
        .collect();
    let mut emitted: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<SubQuestion> = Vec::with_capacity(subs.len());
    // Iterate passes until stable; each pass emits nodes whose deps are met.
    let mut remaining: Vec<SubQuestion> = subs;
    while !remaining.is_empty() {
        let mut progressed = false;
        let mut next: Vec<SubQuestion> = Vec::new();
        for sub in remaining {
            let ready = sub.depends_on.iter().all(|d| emitted.contains(d) || !by_id.contains_key(d));
            if ready {
                emitted.insert(sub.id.clone());
                out.push(sub);
                progressed = true;
            } else {
                next.push(sub);
            }
        }
        remaining = next;
        if !progressed {
            // Cycle: emit the earliest remaining node to break it.
            if let Some(first) = remaining.first().cloned() {
                remaining.remove(0);
                emitted.insert(first.id.clone());
                out.push(first);
            } else {
                break;
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Sub-question prompt rendering
// ---------------------------------------------------------------------------

/// Render the prompt for solving one [`SubQuestion`], injecting the answers
/// of its dependencies (up to [`MAX_DEPENDENCY_ANSWERS`], each excerpted to
/// [`ANSWER_EXCERPT_CHARS`] characters so the prompt stays small).
///
/// This is what the solve loop sends as the user message: the model sees
/// exactly one sub-question plus the distilled outputs of the steps it
/// builds on — never the whole unsolved set.
pub fn build_sub_prompt(sub: &SubQuestion, answers: &HashMap<String, String>) -> String {
    let mut prompt = format!(
        "# AETHER SUB-QUESTION [{strategy}]\nSolve this single step, then stop: {}\n",
        sub.question,
        strategy = sub.strategy.label()
    );
    if sub.depends_on.is_empty() {
        return prompt;
    }
    prompt.push_str("\nResults from earlier steps you should build on:\n");
    let mut injected = 0usize;
    for dep in &sub.depends_on {
        if injected >= MAX_DEPENDENCY_ANSWERS {
            break;
        }
        if let Some(answer) = answers.get(dep) {
            let excerpt: String = answer.chars().take(ANSWER_EXCERPT_CHARS).collect();
            let ellipsis = if answer.chars().count() > ANSWER_EXCERPT_CHARS {
                "…"
            } else {
                ""
            };
            prompt.push_str(&format!("[{dep}] {excerpt}{ellipsis}\n"));
            injected += 1;
        }
    }
    if injected == 0 {
        // Dependencies declared but not yet answered (defensive): say so
        // instead of rendering an empty, confusing section.
        prompt.push_str("(no earlier-step answers available yet)\n");
    }
    prompt
}

// ---------------------------------------------------------------------------
// PipelineState
// ---------------------------------------------------------------------------

/// Live bookkeeping for one pipeline run: which stages completed, what was
/// decomposed, how many backend calls were made and how long it all took.
///
/// Constructed by [`PipelineState::new`] at Stage 4 (which pre-seeds
/// `complexity` via [`analyze_complexity`]; the caller immediately
/// overwrites it with the authoritative value), mutated by every stage of
/// `chat_completions`, and fully consumed by the `/decompose` preview
/// endpoint.
#[derive(Debug, Clone)]
pub struct PipelineState {
    /// The classified complexity of the run.
    pub complexity: Complexity,
    /// Names of pipeline stages that have completed, in order
    /// (`"one-shot"`, `"decompose"`, `"solve"`, `"synthesize"`, …).
    pub stages_completed: Vec<String>,
    /// The sub-question set for Complex runs (empty otherwise).
    pub sub_questions: Vec<SubQuestion>,
    /// The final synthesized response (Stage 7 output).
    pub synthesis: Option<String>,
    /// Whether Stage-8 ATD verification passed (including the retry path).
    pub verification_passed: bool,
    /// Total backend LLM calls made by this run (all stages combined).
    pub total_backend_calls: usize,
    /// Wall-clock pipeline latency in milliseconds.
    pub total_latency_ms: u64,
}

impl PipelineState {
    /// Construct the initial state for a run of `query`, pre-seeding
    /// `complexity` with [`analyze_complexity`]'s verdict.
    pub fn new(query: &str) -> Self {
        Self {
            complexity: analyze_complexity(query),
            stages_completed: Vec::new(),
            sub_questions: Vec::new(),
            synthesis: None,
            verification_passed: false,
            total_backend_calls: 0,
            total_latency_ms: 0,
        }
    }
}

// ---------------------------------------------------------------------------
// DistillationStore (Stage 9)
// ---------------------------------------------------------------------------

/// One stored decomposition pattern: the query it worked for, the query's
/// TF-IDF vector (the semantic key), and the sub-questions that solved it.
#[derive(Debug, Clone)]
pub struct DistilledPattern {
    /// The original Complex query (exact-match key).
    pub query: String,
    /// TF-IDF vector of the query (semantic-match key).
    pub vector: SparseVec,
    /// The proven sub-question decomposition (returned on a hit).
    pub sub_questions: Vec<SubQuestion>,
}

/// Memory of successful Complex decompositions (pipeline Stage 9).
///
/// Only decompositions whose final response passed ATD verification are
/// stored (`chat_completions` enforces this) — distilling a failed
/// decomposition would poison future lookups. Lookups
/// ([`DistillationStore::find`]) first try an exact query match, then a
/// semantic scan at [`DISTILL_SIMILARITY_THRESHOLD`].
#[derive(Debug, Default)]
pub struct DistillationStore {
    /// Stored patterns in insertion order.
    patterns: Vec<DistilledPattern>,
}

impl DistillationStore {
    /// Construct an empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of stored patterns (the `distillation_patterns` metric).
    pub fn len(&self) -> usize {
        self.patterns.len()
    }

    /// Store (or replace, on an exact query match) a successful
    /// decomposition pattern for `query`.
    pub fn store(&mut self, query: &str, vector: SparseVec, sub_questions: Vec<SubQuestion>) {
        if let Some(existing) = self
            .patterns
            .iter_mut()
            .find(|p| p.query == query)
        {
            existing.vector = vector;
            existing.sub_questions = sub_questions;
            return;
        }
        self.patterns.push(DistilledPattern {
            query: query.to_string(),
            vector,
            sub_questions,
        });
    }

    /// Find a reusable decomposition pattern for `query`.
    ///
    /// Exact string match wins immediately; otherwise the pattern whose
    /// query vector is most similar to `vector` is returned when its
    /// similarity reaches [`DISTILL_SIMILARITY_THRESHOLD`]. `None` means
    /// the caller must run a fresh [`decompose`].
    pub fn find(&self, query: &str, vector: &SparseVec) -> Option<Vec<SubQuestion>> {
        if let Some(p) = self.patterns.iter().find(|p| p.query == query) {
            return Some(p.sub_questions.clone());
        }
        if vector.is_empty() {
            return None;
        }
        let mut best: Option<(f64, &DistilledPattern)> = None;
        for p in &self.patterns {
            let sim = vector.cosine(&p.vector);
            if sim >= DISTILL_SIMILARITY_THRESHOLD
                && best.map(|(b, _)| sim > b).unwrap_or(true)
            {
                best = Some((sim, p));
            }
        }
        best.map(|(_, p)| p.sub_questions.clone())
    }
}
