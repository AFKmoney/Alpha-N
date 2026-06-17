//! Cognitive Decompressor — the breakthrough innovation.
//!
//! A small model (3B params) can't solve complex problems in one shot.
//! But it CAN solve simple problems. The decompressor breaks a complex query
//! into a tree of sub-queries, each simple enough for the small model to
//! solve reliably. The answers are then synthesized into a final response.
//!
//! This is inspired by chain-of-thought prompting, but architecturally
//! superior: instead of hoping the model stays on track through a long
//! reasoning chain, we make SEPARATE calls for each step — each with its
//! own fresh context window. The model never has to "remember" step 1
//! when it's on step 5. The pipeline remembers FOR it.
//!
//! Pipeline stages:
//!   1. ANALYZE: classify the query complexity (simple / moderate / complex)
//!   2. DECOMPOSE: if complex, break into sub-questions
//!   3. SOLVE: run each sub-question through the backend model
//!   4. SYNTHESIZE: combine sub-answers into a final response
//!   5. VERIFY: check the response for consistency; retry if needed
//!
//! The decompressor uses the memory graph to inform decomposition —
//! if a similar problem was solved before, the successful decomposition
//! is reused (knowledge distillation).

use crate::graph::ScoredNode;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The result of analyzing a query's complexity.
#[derive(Debug, Clone, Serialize)]
pub enum Complexity {
    Simple,    // One-shot is sufficient
    Moderate,  // Two-step: think then answer
    Complex,   // Multi-step decomposition required
}

/// A sub-question in a decomposition tree.
#[derive(Debug, Clone, Serialize)]
pub struct SubQuestion {
    pub id: String,
    pub text: String,
    pub depends_on: Vec<String>, // IDs of sub-questions whose answers feed into this one
    pub answer: Option<String>,
}

/// The full pipeline state for a single query.
#[derive(Debug, Clone, Serialize)]
pub struct PipelineState {
    pub original_query: String,
    pub complexity: Complexity,
    pub sub_questions: Vec<SubQuestion>,
    pub synthesis: Option<String>,
    pub verification_passed: bool,
    pub stages_completed: Vec<String>,
    pub total_backend_calls: usize,
    pub total_latency_ms: u64,
}

impl PipelineState {
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
/// A query is Complex if it contains:
///   - multiple questions (detected by "?" count > 1)
///   - conditional reasoning ("if...then", "what would happen if")
///   - multi-step instructions ("first...then", "step by step")
///   - comparison ("compare", "difference between", "vs")
///   - code generation requests ("write a function", "implement", "create")
///   - architectural decisions ("design", "architecture", "refactor")
///
/// A query is Moderate if it contains reasoning cues but isn't clearly multi-step.
/// Otherwise it's Simple.
pub fn analyze_complexity(query: &str) -> Complexity {
    let q = query.to_lowercase();
    let question_marks = query.matches('?').count();

    // Complex signals
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
/// This uses a rule-based decomposition strategy (no LLM call needed —
/// the decomposition logic itself is "compiled intelligence" that runs
/// instantly in Rust). The strategy:
///
/// 1. If the query contains "and", split on "and" into separate questions.
/// 2. If the query contains numbered steps ("1.", "2.", etc.), each becomes a sub-question.
/// 3. If the query mentions "compare X and Y", generate:
///    - "What are the characteristics of X?"
///    - "What are the characteristics of Y?"
///    - "What are the key differences between X and Y?"
/// 4. Otherwise, generate a generic decomposition:
///    - "What is the context/background for: {query}?"
///    - "What are the key components of: {query}?"
///    - "What is the best approach for: {query}?"
///
/// Each sub-question is simple enough for a 3B model to answer well.
pub fn decompose(query: &str, _retrieved: &[ScoredNode]) -> Vec<SubQuestion> {
    let q = query.trim();
    let mut subs = Vec::new();

    // Strategy 1: Split on " and " for multi-part questions
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
        // Add a synthesis question that depends on all parts
        subs.push(SubQuestion {
            id: "synth".to_string(),
            text: format!("Synthesize the following into a coherent answer to: \"{}\"", q),
            depends_on: (0..parts.len()).map(|i| format!("sub-{}", i)).collect(),
            answer: None,
        });
        return subs;
    }

    // Strategy 2: Numbered steps
    let numbered: Vec<&str> = q.lines().filter(|l| {
        let trimmed = l.trim();
        trimmed.starts_with(|c: char| c.is_ascii_digit()) && trimmed.contains('.')
    }).collect();
    if numbered.len() >= 2 {
        for (i, step) in numbered.iter().enumerate() {
            let cleaned = step.trim().splitn(2, '.').nth(1).unwrap_or(step).trim();
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

    // Strategy 3: Comparison decomposition
    let q_lower = q.to_lowercase();
    if q_lower.contains("compare") || q_lower.contains("difference between") {
        // Extract the two things being compared
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

    // Strategy 4: Generic decomposition (the safety net)
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

/// Build the augmented prompt for a sub-question, injecting the answers
/// of its dependencies.
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

/// Verify a response for basic consistency.
///
/// Checks:
///   1. Non-empty and > 20 chars
///   2. Doesn't contain "I don't know" / "I cannot" / "I'm unable" as the entire response
///   3. Doesn't repeat the same sentence 3+ times (loop detection)
///   4. Contains at least some content related to the query keywords
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

    // Loop detection: check if any sentence repeats 3+ times
    let sentences: Vec<&str> = response.split('.').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for s in &sentences {
        *counts.entry(s.to_lowercase()).or_insert(0) += 1;
        if counts[s.to_lowercase().as_str()] >= 3 {
            return false;
        }
    }

    // Keyword overlap: at least 1 query keyword should appear in the response
    let query_words: Vec<&str> = query.split_whitespace().filter(|w| w.len() > 3).collect();
    if !query_words.is_empty() {
        let has_overlap = query_words.iter().any(|w| lower.contains(&w.to_lowercase()));
        if !has_overlap {
            return false;
        }
    }

    true
}

/// Knowledge distillation store — caches successful decomposition patterns.
///
/// When a query is successfully decomposed and solved, the decomposition
/// pattern is stored. Future similar queries reuse the pattern, skipping
/// the decomposition stage entirely. This is how the engine gets faster
/// over time — it learns HOW to break down problems.
pub struct DistillationStore {
    pub patterns: HashMap<u64, DistilledPattern>,
}

#[derive(Clone)]
pub struct DistilledPattern {
    pub query_text: String,
    pub query_vec: crate::tfidf::SparseVec,
    pub sub_questions: Vec<SubQuestion>,
    pub success_count: usize,
}

impl DistillationStore {
    pub fn new() -> Self {
        Self {
            patterns: HashMap::new(),
        }
    }

    /// Find a similar previously-successful decomposition pattern.
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

    /// Store a successful decomposition pattern.
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

    pub fn len(&self) -> usize {
        self.patterns.len()
    }
}

fn hash_str(s: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}
