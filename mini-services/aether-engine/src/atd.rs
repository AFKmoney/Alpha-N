//! # Asymmetric Tensor Dueling (ATD) — Innovation #10
//!
//! A zero-cost validation mechanism. The engine instantiates the model
//! weights once but runs **two diverging execution graphs** in parallel:
//!
//! - **Graph A (The Instinct)**: maximizes likelihood — generates the most
//!   probable next token given the context. This is the standard
//!   autoregressive path.
//!
//! - **Graph B (The Verifier)**: calculates the structural entropy of the
//!   current trajectory — measures how "surprising" or "chaotic" the
//!   generation is. High entropy = the model is uncertain, potentially
//!   hallucinating. Low entropy = the model is confident and consistent.
//!
//! A token is only **VALIDATED** when Graph A's output survives Graph B's
//! entropy threshold. If Graph B flags high entropy, the token is rejected
//! and the model is forced to re-generate with a more constrained
//! temperature.
//!
//! # Software-level implementation
//!
//! Since we're middleware (not a custom runtime), we simulate ATD by:
//!
//! 1. Running the model to generate a response (**Graph A** — the Instinct).
//! 2. Computing the "entropy" of the response using TF-IDF diversity metrics:
//!    - Vocabulary diversity (unique words / total words)
//!    - Sentence variance (length distribution)
//!    - Repetition penalty (bigram overlap)
//! 3. If entropy exceeds the threshold, the response is flagged as
//!    "chaotic" and the verification fails — the caller should retry with
//!    lower temperature.
//! 4. If entropy is low, the response is "confident" and validated.
//!
//! This captures the **essence** of ATD: a dual-graph collision where
//! likelihood must overcome entropy before a response is accepted.
//!
//! # Where it sits in the pipeline
//!
//! Stage 8 of the cognitive pipeline (see [`crate::handlers`]). Replaces
//! the legacy heuristic [`crate::decompose::verify_response`] with a
//! richer, multi-signal verifier that returns both a verdict and a
//! recommended retry strategy.

use serde::Serialize;

/// The result of an ATD verification pass. Serialized into the `/pipeline`
/// telemetry so the Memory Network visualizer can render the collision
/// outcome (likelihood vs entropy) per request.
#[derive(Debug, Clone, Serialize)]
pub struct ATDResult {
    /// Whether the response survived the dueling (passed verification).
    pub validated: bool,
    /// Graph A score: likelihood estimate (`0.0` to `1.0`, higher = more
    /// confident). Computed from query-response relevance and length
    /// adequacy — see [`verify`] for the exact formula.
    pub likelihood_score: f64,
    /// Graph B score: structural entropy (`0.0` to `1.0`, lower = more
    /// stable). Computed from vocabulary diversity, repetition ratio, and
    /// sentence-length variance.
    pub entropy_score: f64,
    /// The collision outcome: `likelihood - entropy`. Positive = validated
    /// (the Instinct overcame the Verifier). Surfaced as a sortable score
    /// so the pipeline can pick the better of two failed retries.
    pub collision_delta: f64,
    /// Detailed metrics for debugging/visualization.
    pub vocabulary_diversity: f64,
    /// Detailed metrics for debugging/visualization.
    pub repetition_ratio: f64,
    /// Detailed metrics for debugging/visualization.
    pub sentence_variance: f64,
    /// Recommended action if validation failed. Drives the retry strategy
    /// in [`handlers::chat_completions`].
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

/// Configuration for the ATD verifier. Thresholds are tuned for a 3B-class
/// backend; a larger model would tolerate higher entropy (it's less prone
/// to looping) and could use looser bounds.
#[derive(Clone)]
pub struct ATDConfig {
    /// Maximum acceptable entropy (`0.0`–`1.0`). Responses above this are
    /// rejected regardless of likelihood.
    pub max_entropy: f64,
    /// Maximum acceptable repetition ratio (`0.0`–`1.0`). Responses above
    /// this are flagged as looping and trigger a rephrased-prompt retry.
    pub max_repetition: f64,
    /// Minimum acceptable likelihood score (`0.0`–`1.0`). Responses below
    /// this are flagged as off-topic or too short and trigger a retry.
    pub min_likelihood: f64,
    /// Temperature reduction factor for a retry (multiplied with the
    /// current temperature). Used by [`adjusted_temperature`].
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
/// This is the **"collision"** between Graph A (likelihood) and Graph B
/// (entropy). The response must survive the collision to be validated.
///
/// # Arguments
///
/// * `response` — The model's generated text.
/// * `query`    — The original query (for relevance scoring).
/// * `config`   — ATD configuration thresholds.
///
/// # Likelihood (Graph A) formula
///
/// `likelihood = 0.6 * relevance + 0.4 * length_score`, where:
/// - `relevance` = fraction of query keywords (length > 3) that appear in
///   the response (capped at 1.0; `0.5` if the query has no keywords).
/// - `length_score` = `0.2` for very short (<10 word) responses, `0.5`
///   for very long (>500 word) rambling responses, and a smooth `1.0 − 0.3 * |(len−50)/200|`
///   in between. The sweet spot is ~50 words.
///
/// # Entropy (Graph B) formula
///
/// `entropy = 0.4 * (1 − vocabulary_diversity) + 0.4 * repetition_ratio + 0.2 * sentence_variance`.
/// High diversity + low repetition + moderate sentence-length variance ⇒
/// low entropy (good). Any one signal going bad can push entropy above
/// the threshold.
///
/// # Collision verdict
///
/// The response is **validated** iff:
/// 1. `collision_delta > 0` (likelihood beats entropy), AND
/// 2. `entropy_score <= max_entropy`, AND
/// 3. `repetition_ratio <= max_repetition`, AND
/// 4. `likelihood_score >= min_likelihood`.
///
/// Otherwise the recommendation is selected by *which* signal failed:
/// high repetition ⇒ `RetryWithRephrasedPrompt`; high entropy + low
/// likelihood ⇒ `FallBackToSimpleShot`; everything else ⇒
/// `RetryWithLowerTemperature`.
pub fn verify(response: &str, query: &str, config: &ATDConfig) -> ATDResult {
    let words: Vec<&str> = response.split_whitespace().collect();

    // --- Graph A: Likelihood estimation ---
    // Approximate likelihood via query-response relevance + length adequacy.
    // We use keyword overlap (rather than embedding similarity) because
    // it's O(|query|) and the goal is a coarse signal, not a precise
    // semantic match — the action cache and graph retrieval already handle
    // the precise matching elsewhere in the pipeline.
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
        // No query terms to compare — assume moderate relevance. This
        // avoids penalizing responses to keyword-free queries (e.g.
        // "hello", "thanks") while still letting length_score contribute.
        0.5
    };

    // Length adequacy: too short = low confidence (the model bailed),
    // too long = rambling (the model lost focus). The sweet spot is ~50
    // words; we taper gently away from it.
    let length_score = if words.len() < 10 {
        0.2
    } else if words.len() > 500 {
        0.5
    } else {
        1.0 - ((words.len() as f64 - 50.0) / 200.0).abs().min(1.0) * 0.3
    };

    let likelihood_score = (relevance * 0.6 + length_score * 0.4).min(1.0);

    // --- Graph B: Structural entropy ---
    // 1. Vocabulary diversity: unique words / total words.
    //    Higher diversity = richer vocabulary = lower entropy (better).
    //    Note this is normalized by *total* words, not unique words, so a
    //    response that repeats the same word 100 times gets ~0 diversity.
    let unique_count = response_words.len() as f64;
    let total_count = words.len().max(1) as f64;
    let vocabulary_diversity = unique_count / total_count;

    // 2. Repetition ratio: how much of the text is repeated bigrams.
    //    High repetition = the model is looping (a common small-model
    //    failure mode where it gets stuck re-emitting the same phrase).
    let repetition_ratio = compute_repetition_ratio(&words);

    // 3. Sentence variance: how varied are sentence lengths?
    //    Very uniform sentence lengths (low variance) can indicate a
    //    template-stuck model; very high variance can indicate rambling.
    //    Either extreme is a mild entropy signal.
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
        // Coefficient-of-variation-style normalization: stddev / mean,
        // clamped to [0, 1]. This makes the metric scale-invariant
        // (a paragraph of 5-word sentences and a paragraph of 50-word
        // sentences both score the same if their relative dispersion
        // matches).
        (variance.sqrt() / mean.max(1.0)).min(1.0)
    } else {
        // Single-sentence responses can't have sentence-length variance;
        // assume a moderate default so the entropy signal isn't dominated
        // by this one term.
        0.5
    };

    // Entropy score: high diversity + low repetition + moderate variance =
    // low entropy (good). The 0.4 / 0.4 / 0.2 weighting puts equal
    // emphasis on vocabulary richness and loop detection, with sentence
    // variance as a tie-breaker.
    let entropy_score = (1.0 - vocabulary_diversity) * 0.4
        + repetition_ratio * 0.4
        + sentence_variance * 0.2;

    // --- Collision: likelihood must overcome entropy ---
    // The delta is what the pipeline sorts by when both the first attempt
    // and the retry fail ATD — it picks the "less bad" one.
    let collision_delta = likelihood_score - entropy_score;

    // --- Determine recommendation ---
    // Order matters: we check the most-specific failure modes first.
    // - High repetition ⇒ rephrase (looping won't be fixed by temperature).
    // - High entropy AND low likelihood ⇒ the model is fundamentally
    //   confused; fall back to a simple one-shot.
    // - Anything else failing ⇒ retry with lower temperature (the generic
    //   "tighten the distribution" response).
    let (validated, recommendation) = if collision_delta > 0.0
        && entropy_score <= config.max_entropy
        && repetition_ratio <= config.max_repetition
        && likelihood_score >= config.min_likelihood
    {
        (true, ATDRecommendation::Accept)
    } else if repetition_ratio > config.max_repetition {
        // High repetition = model is looping.
        (false, ATDRecommendation::RetryWithRephrasedPrompt)
    } else if entropy_score > config.max_entropy && likelihood_score < config.min_likelihood {
        // Both entropy high AND likelihood low = model is confused.
        (false, ATDRecommendation::FallBackToSimpleShot)
    } else {
        // High entropy but some likelihood = retry with lower temperature.
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
/// Returns a value between `0.0` (no repetition) and `1.0` (all repeated).
///
/// # Algorithm
///
/// Build a histogram of all bigrams, then compute
/// `sum(count where count > 1) / sum(count)`. The `> 1` threshold means a
/// bigram counts as "repeated" only if it appears at least twice — a
/// single occurrence of a common phrase (e.g. "of the") isn't penalized.
/// Responses with fewer than 4 words get a free pass (`0.0`) because
/// bigram statistics are meaningless on tiny inputs.
fn compute_repetition_ratio(words: &[&str]) -> f64 {
    if words.len() < 4 {
        return 0.0;
    }

    // Build bigram counts.
    let mut bigrams: std::collections::HashMap<(String, String), usize> =
        std::collections::HashMap::new();
    for window in words.windows(2) {
        let key = (
            window[0].to_lowercase(),
            window[1].to_lowercase(),
        );
        *bigrams.entry(key).or_insert(0) += 1;
    }

    // Total bigrams = sum of all counts (== words.len() - 1).
    // Repeated bigrams = sum of counts > 1 (each occurrence beyond the
    // first is a "repeat"). This penalizes both breadth (many distinct
    // repeats) and depth (one bigram repeated many times).
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
/// computes the new temperature. Used by callers that want to actually
/// apply the recommendation to their next backend call (the main pipeline
/// in [`crate::handlers`] currently uses the recommendation to pick a
/// prompt-injection strategy rather than a temperature tweak, so this
/// helper is exposed as a public API entry point for alternative retry
/// loops).
///
/// # Mapping
///
/// | Recommendation                  | New temperature                  |
/// |---------------------------------|----------------------------------|
/// | `Accept`                        | unchanged                        |
/// | `RetryWithLowerTemperature`     | `current * retry_temperature_factor` (default `0.6`) |
/// | `RetryWithRephrasedPrompt`      | `current * 0.8` (gentle reduction)|
/// | `FallBackToSimpleShot`          | `0.3` (very focused, fixed)      |
///
/// All scaled temperatures are clamped to a `0.1` floor so they remain
/// valid for downstream samplers.
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
