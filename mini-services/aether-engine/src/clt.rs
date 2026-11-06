//! # CLT — Central Limit Theorem convergence adjustment.
//!
//! ## Status: dormant scaffolding (unused by design)
//!
//! This module implements the *iterative self-refinement loop* the engine
//! used before v3.x replaced it with Asymmetric Tensor Dueling (see
//! [`crate::atd`]): ask the model the same question several times, score
//! each attempt, and stop when the running mean of the scores converges —
//! the Central Limit Theorem says the standard error of the mean shrinks
//! as `σ/√n`, so a stable mean across attempts means the answer has
//! stopped wandering.
//!
//! None of it is called by the live pipeline today. The 10-stage pipeline
//! in `handlers.rs` keeps the CLT counters on [`crate::Stats`]
//! (`clt_loops`, `clt_convergences`, `clt_total_steps`) and surfaces them
//! on `/health` and `/pipeline`, but the loop itself is superseded: ATD
//! verification (Stage 8) achieves the same quality gate in a single
//! pass plus one retry, without N× backend calls.
//!
//! The public functions below are retained deliberately, as documented API
//! scaffolding for the planned *budgeted* refinement loop (CLT convergence
//! as a cheap early-stop for multi-sample decoding). They are kept
//! compiling, tested-by-inspection, and warning-suppressed via
//! `#![allow(dead_code)]` at the module level.

#![allow(dead_code)]
// (Everything in this module is intentionally uncalled; see above.)

use crate::tfidf::tokenize;

/// Maximum refinement iterations per query (surfaced as `clt_max_steps:
/// 10` by `GET /config`).
pub const MAX_STEPS: usize = 10;

/// Minimum samples before convergence may be declared — below this the
/// CLT's `σ/√n` shrinkage is too noisy to trust.
pub const MIN_SAMPLES: usize = 3;

/// Convergence threshold (surfaced as `clt_convergence: 0.92` by
/// `GET /config`): the loop is converged when the standard error of the
/// mean score falls below `(1 - CONVERGENCE_THRESHOLD)` of the mean.
pub const CONVERGENCE_THRESHOLD: f64 = 0.92;

/// Base sampling temperature for the first iteration (see
/// [`adjusted_temperature`]).
pub const BASE_TEMPERATURE: f64 = 0.7;

/// Floor sampling temperature for the last iteration (see
/// [`adjusted_temperature`]).
pub const MIN_TEMPERATURE: f64 = 0.2;

/// Number of latent-state dimensions produced by
/// [`extract_latent_state`].
pub const LATENT_DIM: usize = 64;

// ---------------------------------------------------------------------------
// Live-instrumented convergence state
// ---------------------------------------------------------------------------

/// Running convergence bookkeeping for one refinement loop.
///
/// One `CltState` is created per query and fed one score per completed
/// iteration via [`CltState::update`]; the loop driver then consults
/// [`CltState::mean`] / [`CltState::standard_error`] (or the free function
/// [`check_convergence`]) to decide whether to continue.
#[derive(Debug, Clone, Default)]
pub struct CltState {
    /// Number of completed iterations.
    pub step: usize,
    /// One score per completed iteration, in order.
    pub scores: Vec<f64>,
    /// Sum of the scores (kept incremental; `mean` divides by `step`).
    sum: f64,
    /// Sum of squared scores (kept incremental; used by the variance).
    sum_sq: f64,
}

impl CltState {
    /// Construct an empty state (zero iterations).
    pub fn new() -> Self {
        Self::default()
    }

    /// Record the score of one completed iteration.
    pub fn update(&mut self, score: f64) {
        self.step += 1;
        self.scores.push(score);
        self.sum += score;
        self.sum_sq += score * score;
    }

    /// Arithmetic mean of the recorded scores (`0.0` before any sample).
    pub fn mean(&self) -> f64 {
        if self.step == 0 {
            0.0
        } else {
            self.sum / self.step as f64
        }
    }

    /// Sample standard deviation of the recorded scores (`0.0` before two
    /// samples).
    pub fn std_dev(&self) -> f64 {
        if self.step < 2 {
            return 0.0;
        }
        let n = self.step as f64;
        let variance = ((self.sum_sq - self.sum * self.sum / n) / (n - 1.0)).max(0.0);
        variance.sqrt()
    }

    /// Standard error of the mean: `σ/√n` — the CLT quantity the loop's
    /// early-stop is built on.
    pub fn standard_error(&self) -> f64 {
        if self.step == 0 {
            0.0
        } else {
            self.std_dev() / (self.step as f64).sqrt()
        }
    }
}

// ---------------------------------------------------------------------------
// Documented (currently unused) public API
// ---------------------------------------------------------------------------

/// Score how well `response` answers `original_query`, in `[0, 1]`.
///
/// **Currently unused** — superseded as the pipeline's verifier by
/// [`crate::atd::verify`] (Stage 8), which scores a *dual-graph collision*
/// instead of plain term coverage. Retained for the planned multi-sample
/// loop, where it prices individual samples cheaply before ATD prices the
/// final answer.
///
/// The score blends query-term coverage (0.6), response substance in
/// words (0.2) and sentence structure (0.2) — deliberately simple so it
/// stays O(response length).
pub fn verify_response(response: &str, original_query: &str) -> f64 {
    let query_terms: Vec<String> = tokenize(original_query);
    let words = tokenize(response);
    if words.is_empty() || query_terms.is_empty() {
        return 0.0;
    }
    let distinct: std::collections::HashSet<&str> =
        query_terms.iter().map(|t| t.as_str()).collect();
    let covered = distinct
        .iter()
        .filter(|t| words.iter().any(|w| w.as_str() == **t))
        .count();
    let coverage = covered as f64 / distinct.len() as f64;
    let substance = (words.len() as f64 / 60.0).clamp(0.0, 1.0);
    let sentence_count = response
        .matches(|c: char| c == '.' || c == '!' || c == '?')
        .count()
        .max(1) as f64;
    let structure = (sentence_count / 5.0).clamp(0.0, 1.0);
    0.6 * coverage + 0.2 * substance + 0.2 * structure
}

/// Sampling temperature for refinement iteration `step` of `max_steps`.
///
/// **Currently unused.** Decays linearly from [`BASE_TEMPERATURE`] (0.7)
/// to [`MIN_TEMPERATURE`] (0.2): early samples explore, late samples
/// exploit — the standard simulated-annealing schedule adapted to
/// multi-sample decoding.
pub fn adjusted_temperature(step: usize, max_steps: usize) -> f64 {
    if max_steps <= 1 {
        return BASE_TEMPERATURE;
    }
    let progress = (step.min(max_steps - 1) as f64) / (max_steps - 1) as f64;
    BASE_TEMPERATURE + (MIN_TEMPERATURE - BASE_TEMPERATURE) * progress
}

/// Check a score history for CLT convergence.
///
/// **Currently unused.** Returns `Some(mean)` when the history has at
/// least [`MIN_SAMPLES`] samples and the standard error of the mean has
/// shrunk below `(1 - [`CONVERGENCE_THRESHOLD`]) × mean` — i.e. the mean
/// is stable to within 8% — and `None` otherwise (too few samples, or the
/// answer is still wandering).
pub fn check_convergence(history: &[f64]) -> Option<f64> {
    if history.len() < MIN_SAMPLES {
        return None;
    }
    let n = history.len() as f64;
    let mean = history.iter().sum::<f64>() / n;
    let variance = if history.len() < 2 {
        0.0
    } else {
        let ss = history.iter().map(|s| (s - mean) * (s - mean)).sum::<f64>();
        ss / (n - 1.0)
    };
    let sem = variance.sqrt() / n.sqrt();
    let tolerance = (1.0 - CONVERGENCE_THRESHOLD) * mean.abs().max(f64::EPSILON);
    if sem <= tolerance {
        Some(mean)
    } else {
        None
    }
}

/// Whether the refinement loop should run another iteration.
///
/// **Currently unused.** `true` while `step < max_steps` AND convergence
/// has not been reached — the loop driver's entire termination condition
/// in one predicate.
pub fn should_continue(step: usize, max_steps: usize, convergence: Option<f64>) -> bool {
    step < max_steps && convergence.is_none()
}

/// Build the system prompt for refinement iteration `step`.
///
/// **Currently unused.** Frames the model's N-th attempt: it shows the
/// prior attempts (up to the last three, excerpted) and instructs the
/// model to either confirm a stable answer or improve on the previous
/// ones — the textual half of the convergence loop.
pub fn build_iteration_prompt(query: &str, history: &[String]) -> String {
    let step = history.len() + 1;
    let mut prompt = format!(
        "# AETHER REFINEMENT — ITERATION {step}\n\
         Answer the question below as accurately as you can.\n\
         Question: {query}\n"
    );
    match history.len() {
        0 => {}
        n => {
            prompt.push_str("\nYour previous attempts (most recent last):\n");
            for (i, answer) in history.iter().skip(n.saturating_sub(3)).enumerate() {
                let excerpt: String = answer.chars().take(300).collect();
                prompt.push_str(&format!("[attempt {}] {excerpt}\n", n.saturating_sub(3) + i + 1));
            }
            prompt.push_str(
                "\nIf an earlier attempt was already correct, restate its answer cleanly. \
                 Otherwise, correct and improve it.\n",
            );
        }
    }
    prompt
}

/// Extract a fixed-dim ([`LATENT_DIM`]) latent feature vector from a
/// response, for comparing successive attempts geometrically.
///
/// **Currently unused.** Feature-hashes the response's tokens into
/// `LATENT_DIM` signed buckets and L2-normalizes (the same scheme as
/// [`crate::hcm::hash_to_vector`], at a smaller dimension). Two attempts
/// that use the same vocabulary point in the same direction; a drifted
/// answer rotates away — a cheap convergence signal that complements the
/// scalar [`verify_response`] score.
pub fn extract_latent_state(response: &str) -> Vec<f64> {
    let mut out = vec![0.0; LATENT_DIM];
    for token in tokenize(response) {
        let mut hash: u64 = 0xcbf29ce484222325;
        for b in token.as_bytes() {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        let bucket = (hash % LATENT_DIM as u64) as usize;
        out[bucket] += if (hash >> 63) & 1 == 0 { 1.0 } else { -1.0 };
    }
    let norm: f64 = out.iter().map(|x| x * x).sum::<f64>().sqrt();
    if norm > f64::EPSILON {
        for x in &mut out {
            *x /= norm;
        }
    }
    out
}
