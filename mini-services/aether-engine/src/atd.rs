//! # ATD — Asymmetric Tensor Dueling verification (pipeline Stage 8).
//!
//! ATD replaces the engine's original single-graph response check with a
//! **dual-graph likelihood-vs-entropy collision**:
//!
//! - **Graph A — likelihood.** How much *evidence* the response carries
//!   for the query: coverage of the query's distinct terms, substance
//!   (word count), and structural coherence (sentence count). High scores
//!   mean the response is on-topic and substantial.
//! - **Graph B — entropy.** How *dispersed* the response is: lexical
//!   diversity (type-token ratio), normalized Shannon entropy of the
//!   token distribution, and repetition rate. High scores mean the
//!   response is rambling or looping.
//!
//! The response is **validated** when Graph A overcomes Graph B
//! (`likelihood − entropy ≥ 0`, reported as `collision_delta`) *and* it
//! clears the hard gates in [`ATDConfig`]: repetition ≤
//! `max_repetition`, entropy ≤ `max_entropy`, query coverage ≥
//! `min_substance`, and length ≥ `min_length`. A failure is classified
//! into an [`ATDRecommendation`] that the pipeline's retry path acts on
//! (notably [`ATDRecommendation::FallBackToSimpleShot`], which triggers a
//! clean, minimal-context retry when the model is deeply confused).
//!
//! Everything is deterministic, allocation-light and O(response length) —
//! ATD runs on *every* pipeline response, twice when it retries.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Tuning knobs of the ATD verifier. The defaults mirror the values
/// surfaced by `GET /config` (`atd_max_entropy: 0.65`,
/// `atd_max_repetition: 0.30`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ATDConfig {
    /// Hard ceiling on the repetition rate (the fraction of tokens that
    /// are repeats of an already-seen token). Above this the response is
    /// considered degenerate looping.
    pub max_repetition: f64,
    /// Hard ceiling on the normalized Shannon entropy of the token
    /// distribution. Above this the response is considered unfocused
    /// rambling across too many unrelated terms.
    pub max_entropy: f64,
    /// Minimum query-term coverage (fraction of the query's distinct
    /// terms the response must contain). Below this the response is
    /// considered evasive or off-topic.
    pub min_substance: f64,
    /// Minimum response length in characters. Below this the response is
    /// considered a non-answer.
    pub min_length: usize,
}

impl Default for ATDConfig {
    /// Production defaults (see `GET /config`).
    fn default() -> Self {
        Self {
            max_repetition: 0.30,
            max_entropy: 0.65,
            min_substance: 0.25,
            min_length: 24,
        }
    }
}

// ---------------------------------------------------------------------------
// Verdict types
// ---------------------------------------------------------------------------

/// What the pipeline should do next, derived from the failure mode (or
/// success) of the collision. See [`verify`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ATDRecommendation {
    /// The collision was survived — proceed with the response as-is.
    Proceed,
    /// The model is confused (looping, degenerate, or panicked): retry
    /// with a clean, minimal, single-turn prompt. The pipeline's Stage-8
    /// retry path special-cases exactly this variant.
    FallBackToSimpleShot,
    /// The response evaded the question (low coverage): retry with the
    /// retrieved context made more explicit.
    RetryWithMoreContext,
    /// The response is unfocused (high entropy): retry at a lower
    /// temperature / with a narrower instruction.
    ReduceTemperature,
}

impl ATDRecommendation {
    /// Stable machine-readable name (lowercase, hyphenated), used by the
    /// `/atd/verify` endpoint's JSON.
    pub fn label(&self) -> &'static str {
        match self {
            ATDRecommendation::Proceed => "proceed",
            ATDRecommendation::FallBackToSimpleShot => "fall-back-to-simple-shot",
            ATDRecommendation::RetryWithMoreContext => "retry-with-more-context",
            ATDRecommendation::ReduceTemperature => "reduce-temperature",
        }
    }
}

/// The verdict of one [`verify`] run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ATDResult {
    /// `true` when Graph A (likelihood) overcame Graph B (entropy) and all
    /// hard gates passed — the response may be returned to the user.
    pub validated: bool,
    /// Graph A score in `[0, 1]`: query-term coverage, substance and
    /// structural coherence blended (see the module docs).
    pub likelihood: f64,
    /// Graph B score in `[0, 1]`: lexical diversity and normalized token
    /// entropy blended (see the module docs).
    pub entropy: f64,
    /// `likelihood − entropy`: how decisively Graph A won the collision.
    /// When both attempts fail, the pipeline returns the response with
    /// the *better* (higher) delta.
    pub collision_delta: f64,
    /// The classified next action for the pipeline's retry path.
    pub recommendation: ATDRecommendation,
    /// Human-readable notes on which gates passed/failed (one string per
    /// triggered rule). Surfaced by `/atd/verify` for observability.
    pub diagnostics: Vec<String>,
}

// ---------------------------------------------------------------------------
// The verifier
// ---------------------------------------------------------------------------

/// Run the dual-graph collision on `response` against `query`.
///
/// Pure and synchronous — no state, no I/O, no clock — so the result is
/// reproducible for identical inputs, which is what lets the pipeline
/// compare `collision_delta` between the first attempt and the retry.
pub fn verify(response: &str, query: &str, config: &ATDConfig) -> ATDResult {
    let mut diagnostics: Vec<String> = Vec::new();

    let tokens = crate::tfidf::tokenize(response);
    let query_terms: Vec<String> = crate::tfidf::tokenize(query);

    // --- Graph A: likelihood (evidence for the query) ---
    let likelihood = likelihood_graph(response, &tokens, &query_terms, &mut diagnostics);

    // --- Graph B: entropy (dispersion of the response) ---
    let entropy = entropy_graph(&tokens, &mut diagnostics);

    // --- Hard gates ---
    let repetition = repetition_rate(&tokens);
    if repetition > config.max_repetition {
        diagnostics.push(format!(
            "repetition gate failed: {repetition:.3} > {:.3}",
            config.max_repetition
        ));
    }
    let length = response.chars().count();
    if length < config.min_length {
        diagnostics.push(format!(
            "length gate failed: {length} < {} chars",
            config.min_length
        ));
    }
    let coverage = query_coverage(&tokens, &query_terms);
    if !query_terms.is_empty() && coverage < config.min_substance {
        diagnostics.push(format!(
            "substance gate failed: coverage {coverage:.3} < {:.3}",
            config.min_substance
        ));
    }
    if entropy > config.max_entropy {
        diagnostics.push(format!(
            "entropy gate failed: {entropy:.3} > {:.3}",
            config.max_entropy
        ));
    }

    // --- Collision + verdict ---
    let collision_delta = likelihood - entropy;
    let gates_passed = repetition <= config.max_repetition
        && entropy <= config.max_entropy
        && length >= config.min_length
        && (query_terms.is_empty() || coverage >= config.min_substance);
    let validated = collision_delta >= 0.0 && gates_passed;

    let recommendation = if validated {
        ATDRecommendation::Proceed
    } else if repetition > config.max_repetition || collision_delta < -0.25 {
        // Degenerate looping or a catastrophic collision loss: the model
        // is confused, not merely sloppy — simplify hard.
        ATDRecommendation::FallBackToSimpleShot
    } else if coverage < config.min_substance {
        ATDRecommendation::RetryWithMoreContext
    } else {
        ATDRecommendation::ReduceTemperature
    };

    if validated {
        diagnostics.push(format!(
            "collision survived: likelihood {likelihood:.3} vs entropy {entropy:.3}"
        ));
    } else if collision_delta < 0.0 {
        diagnostics.push(format!(
            "collision lost: likelihood {likelihood:.3} vs entropy {entropy:.3}"
        ));
    }

    ATDResult {
        validated,
        likelihood,
        entropy,
        collision_delta,
        recommendation,
        diagnostics,
    }
}

// ---------------------------------------------------------------------------
// Graph implementations
// ---------------------------------------------------------------------------

/// Graph A — likelihood: how much evidence the response carries for the
/// query. Blends query-term coverage (0.6), substance in words (0.2) and
/// sentence structure (0.2); an empty query's coverage component is 1.0
/// (nothing to cover).
fn likelihood_graph(
    response: &str,
    tokens: &[String],
    query_terms: &[String],
    diagnostics: &mut Vec<String>,
) -> f64 {
    let coverage = query_coverage(tokens, query_terms);
    if !query_terms.is_empty() && coverage == 0.0 {
        diagnostics.push("likelihood: response covers none of the query terms".to_string());
    }
    let substance = (tokens.len() as f64 / 80.0).clamp(0.0, 1.0);
    let sentences = response
        .matches(|c: char| c == '.' || c == '!' || c == '?')
        .count()
        .max(1) as f64;
    let structure = (sentences / 4.0).clamp(0.0, 1.0);
    (0.6 * coverage + 0.2 * substance + 0.2 * structure).clamp(0.0, 1.0)
}

/// Graph B — entropy: how dispersed the response is. Blends the type-token
/// ratio (0.5) and the normalized Shannon entropy of the token
/// distribution (0.5). A response reusing a tight vocabulary scores low
/// (focused); a response spraying unique tokens scores high (rambling).
fn entropy_graph(tokens: &[String], diagnostics: &mut Vec<String>) -> f64 {
    if tokens.is_empty() {
        return 0.0;
    }
    let mut counts: std::collections::HashMap<&str, u64> = std::collections::HashMap::new();
    for t in tokens {
        *counts.entry(t.as_str()).or_insert(0) += 1;
    }
    let total = tokens.len() as f64;
    let ttr = counts.len() as f64 / total; // type-token ratio
    let shannon = -counts
        .values()
        .map(|c| {
            let p = *c as f64 / total;
            p * p.log2()
        })
        .sum::<f64>();
    let max_entropy = (counts.len() as f64).log2().max(f64::EPSILON);
    let normalized = (shannon / max_entropy).clamp(0.0, 1.0);
    if ttr > 0.95 && tokens.len() > 40 {
        diagnostics.push("entropy: near-zero repetition across a long response".to_string());
    }
    (0.5 * ttr + 0.5 * normalized).clamp(0.0, 1.0)
}

/// Fraction of the query's distinct terms that appear in the response.
/// `1.0` when the query has no usable terms (nothing to cover).
fn query_coverage(tokens: &[String], query_terms: &[String]) -> f64 {
    if query_terms.is_empty() {
        return 1.0;
    }
    let distinct: std::collections::HashSet<&str> =
        query_terms.iter().map(|t| t.as_str()).collect();
    let covered = distinct
        .iter()
        .filter(|t| tokens.iter().any(|w| w.as_str() == **t))
        .count();
    covered as f64 / distinct.len() as f64
}

/// Repetition rate: the fraction of token *occurrences* that repeat an
/// already-seen token. 0.0 = every token unique; → 1.0 = pure looping.
fn repetition_rate(tokens: &[String]) -> f64 {
    if tokens.is_empty() {
        return 0.0;
    }
    let mut seen = std::collections::HashSet::new();
    let mut repeats = 0usize;
    for t in tokens {
        if !seen.insert(t.as_str()) {
            repeats += 1;
        }
    }
    repeats as f64 / tokens.len() as f64
}

// ---------------------------------------------------------------------------
// Convenience re-export for callers building JSON verdicts
// ---------------------------------------------------------------------------

/// Serialize a verdict into the JSON shape returned by `POST /atd/verify`.
/// Kept next to the types so the wire format and the struct never drift.
pub fn result_to_json(result: &ATDResult) -> Value {
    serde_json::json!({
        "validated": result.validated,
        "likelihood": result.likelihood,
        "entropy": result.entropy,
        "collision_delta": result.collision_delta,
        "recommendation": result.recommendation.label(),
        "diagnostics": result.diagnostics,
    })
}
