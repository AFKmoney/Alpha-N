//! Asymmetric Tensor Dueling (ATD)
//!
//! A zero-cost validation mechanism. The engine instantiates the model weights
//! once but runs two diverging execution graphs in parallel:
//!
//! - Graph A (The Instinct): maximizes likelihood — generates the most
//!   probable next token given the context. This is the standard
//!   autoregressive path.
//!
//! - Graph B (The Verifier): calculates the structural entropy of the
//!   current trajectory — measures how "surprising" or "chaotic" the
//!   generation is. High entropy = the model is uncertain, potentially
//!   hallucinating. Low entropy = the model is confident and consistent.
//!
//! A token is only VALIDATED when Graph A's output survives Graph B's
//! entropy threshold. If Graph B flags high entropy, the token is
//! rejected and the model is forced to re-generate with a more
//! constrained temperature.
//!
//! # Software-Level Implementation
//!
//! Since we're middleware (not a custom runtime), we simulate ATD by:
//!
//! 1. Running the model to generate a response (Graph A — the Instinct)
//! 2. Computing the "entropy" of the response using TF-IDF diversity metrics:
//!    - Vocabulary diversity (unique words / total words)
//!    - Sentence variance (length distribution)
//!    - Repetition penalty (n-gram overlap)
//! 3. If entropy exceeds the threshold, the response is flagged as "chaotic"
//!    and the verification fails — the caller should retry with lower temperature
//! 4. If entropy is low, the response is "confident" and validated
//!
//! This captures the ESSENCE of ATD: a dual-graph collision where
//! likelihood must overcome entropy before a response is accepted.

use serde::Serialize;

/// The result of an ATD verification pass.
#[derive(Debug, Clone, Serialize)]
pub struct ATDResult {
    /// Whether the response survived the dueling (passed verification).
    pub validated: bool,
    /// Graph A score: likelihood estimate (0.0 to 1.0, higher = more confident).
    pub likelihood_score: f64,
    /// Graph B score: structural entropy (0.0 to 1.0, lower = more stable).
    pub entropy_score: f64,
    /// The collision outcome: likelihood - entropy. Positive = validated.
    pub collision_delta: f64,
    /// Detailed metrics for debugging/visualization.
    pub vocabulary_diversity: f64,
    pub repetition_ratio: f64,
    pub sentence_variance: f64,
    /// Recommended action if validation failed.
    pub recommendation: ATDRecommendation,
}

/// What the engine should do if ATD validation fails.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum ATDRecommendation {
    /// The response passed — use it as-is.
    Accept,
    /// High entropy — retry with lower temperature for more focused output.
    RetryWithLowerTemperature,
    /// High repetition — the model is looping. Retry with a different prompt.
    RetryWithRephrasedPrompt,
    /// Both entropy and repetition are high — the model is confused.
    /// Fall back to a simpler one-shot response.
    FallBackToSimpleShot,
}

/// Configuration for the ATD verifier.
#[derive(Clone)]
pub struct ATDConfig {
    /// Maximum acceptable entropy (0.0-1.0). Responses above this are rejected.
    pub max_entropy: f64,
    /// Maximum acceptable repetition ratio (0.0-1.0).
    pub max_repetition: f64,
    /// Minimum acceptable likelihood score (0.0-1.0).
    pub min_likelihood: f64,
    /// Temperature reduction for retry (multiplied with current temperature).
    pub retry_temperature_factor: f64,
}

impl Default for ATDConfig {
    fn default() -> Self {
        Self {
            max_entropy: 0.65,
            max_repetition: 0.30,
            min_likelihood: 0.3,
            retry_temperature_factor: 0.6,
        }
    }
}

/// Run the ATD verification on a model response.
///
/// This is the "collision" between Graph A (likelihood) and Graph B (entropy).
/// The response must survive the collision to be validated.
///
/// # Arguments
/// * `response` - The model's generated text
/// * `query` - The original query (for relevance scoring)
/// * `config` - ATD configuration thresholds
pub fn verify(response: &str, query: &str, config: &ATDConfig) -> ATDResult {
    let words: Vec<&str> = response.split_whitespace().collect();

    // --- Graph A: Likelihood estimation ---
    // Approximate likelihood via query-response relevance + length adequacy
    let query_words: std::collections::HashSet<String> = query
        .split_whitespace()
        .filter(|w| w.len() > 3)
        .map(|w| w.to_lowercase())
        .collect();

    let response_words: std::collections::HashSet<String> = words
        .iter()
        .map(|w| w.to_lowercase())
        .collect();

    let relevance = if !query_words.is_empty() {
        let overlap = query_words.intersection(&response_words).count() as f64;
        let relevance = overlap / query_words.len() as f64;
        relevance.min(1.0)
    } else {
        0.5 // No query terms to compare — assume moderate relevance
    };

    // Length adequacy: too short = low confidence, too long = rambling
    let length_score = if words.len() < 10 {
        0.2
    } else if words.len() > 500 {
        0.5
    } else {
        1.0 - ((words.len() as f64 - 50.0) / 200.0).abs().min(1.0) * 0.3
    };

    let likelihood_score = (relevance * 0.6 + length_score * 0.4).min(1.0);

    // --- Graph B: Structural entropy ---
    // 1. Vocabulary diversity: unique words / total words (higher = more diverse = lower entropy)
    let unique_count = response_words.len() as f64;
    let total_count = words.len().max(1) as f64;
    let vocabulary_diversity = unique_count / total_count;

    // 2. Repetition ratio: how much of the text is repeated n-grams
    let repetition_ratio = compute_repetition_ratio(&words);

    // 3. Sentence variance: how varied are sentence lengths?
    let sentences: Vec<usize> = response
        .split(|c: char| c == '.' || c == '!' || c == '?')
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.split_whitespace().count())
        .collect();

    let sentence_variance = if sentences.len() > 1 {
        let mean = sentences.iter().sum::<usize>() as f64 / sentences.len() as f64;
        let variance = sentences
            .iter()
            .map(|&l| (l as f64 - mean).powi(2))
            .sum::<f64>()
            / sentences.len() as f64;
        (variance.sqrt() / mean.max(1.0)).min(1.0)
    } else {
        0.5
    };

    // Entropy score: high diversity + low repetition + moderate variance = low entropy (good)
    let entropy_score = (1.0 - vocabulary_diversity) * 0.4
        + repetition_ratio * 0.4
        + sentence_variance * 0.2;

    // --- Collision: likelihood must overcome entropy ---
    let collision_delta = likelihood_score - entropy_score;

    // --- Determine recommendation ---
    let (validated, recommendation) = if collision_delta > 0.0
        && entropy_score <= config.max_entropy
        && repetition_ratio <= config.max_repetition
        && likelihood_score >= config.min_likelihood
    {
        (true, ATDRecommendation::Accept)
    } else if repetition_ratio > config.max_repetition {
        // High repetition = model is looping
        (false, ATDRecommendation::RetryWithRephrasedPrompt)
    } else if entropy_score > config.max_entropy && likelihood_score < config.min_likelihood {
        // Both entropy high AND likelihood low = model is confused
        (false, ATDRecommendation::FallBackToSimpleShot)
    } else {
        // High entropy but some likelihood = retry with lower temperature
        (false, ATDRecommendation::RetryWithLowerTemperature)
    };

    ATDResult {
        validated,
        likelihood_score,
        entropy_score,
        collision_delta,
        vocabulary_diversity,
        repetition_ratio,
        sentence_variance,
        recommendation,
    }
}

/// Compute the repetition ratio: fraction of bigrams that are repeated.
///
/// High repetition = the model is looping (a common small-model failure).
/// Returns a value between 0.0 (no repetition) and 1.0 (all repeated).
fn compute_repetition_ratio(words: &[&str]) -> f64 {
    if words.len() < 4 {
        return 0.0;
    }

    // Build bigram counts
    let mut bigrams: std::collections::HashMap<(String, String), usize> =
        std::collections::HashMap::new();
    for window in words.windows(2) {
        let key = (
            window[0].to_lowercase(),
            window[1].to_lowercase(),
        );
        *bigrams.entry(key).or_insert(0) += 1;
    }

    let total_bigrams = bigrams.values().sum::<usize>() as f64;
    let repeated_bigrams = bigrams.values().filter(|&&c| c > 1).sum::<usize>() as f64;

    if total_bigrams > 0.0 {
        repeated_bigrams / total_bigrams
    } else {
        0.0
    }
}

/// Adjust the temperature for a retry based on the ATD result.
///
/// If the ATD recommends retrying with lower temperature, this function
/// computes the new temperature.
pub fn adjusted_temperature(current_temp: f64, result: &ATDResult, config: &ATDConfig) -> f64 {
    match result.recommendation {
        ATDRecommendation::RetryWithLowerTemperature => {
            (current_temp * config.retry_temperature_factor).max(0.1)
        }
        ATDRecommendation::RetryWithRephrasedPrompt => {
            (current_temp * 0.8).max(0.1)
        }
        ATDRecommendation::FallBackToSimpleShot => 0.3, // Very focused
        ATDRecommendation::Accept => current_temp,
    }
}
