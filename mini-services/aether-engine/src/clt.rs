//! # Continuous Latent Trajectory (CLT) Reasoning — Innovation #9
//!
//! Bypasses discrete token generation during reasoning. Instead of
//! generating text token-by-token (which is slow and error-prone for small
//! models), the engine executes an N-step recurrent loop strictly within
//! the model's high-dimensional latent space. It resolves logical states
//! as continuous vectors, only collapsing the wave-function to discrete
//! tokens when the latent trajectory stabilizes (converges).
//!
//! # The insight
//!
//! A small model's vocabulary projection (logits → softmax → token) is the
//! main source of errors. Each token is a lossy compression of the model's
//! rich internal state. By staying in latent space and iterating, the model
//! can "think" in pure concepts without the quantization noise of tokens.
//!
//! # How it works (software-level simulation)
//!
//! In a real implementation, CLT would intercept the model's hidden states
//! before the LM head and feed them back as input. Since we're building a
//! middleware engine (not a custom model runtime), we simulate this by:
//!
//! 1. Running the model N times with progressively refined prompts (each
//!    iteration's output becomes the next iteration's context).
//! 2. Measuring the semantic distance between consecutive outputs.
//! 3. When the distance drops below a threshold (convergence), the
//!    trajectory has stabilized — we output the final result.
//! 4. If it doesn't converge within `max_steps`, we take the last output.
//!
//! This captures the **essence** of CLT: iterative refinement in concept
//! space until stability, rather than one-shot token generation.
//!
//! # Convergence detection
//!
//! The engine measures cosine similarity between consecutive latent states
//! (approximated by TF-IDF vectors of consecutive outputs — see
//! [`extract_latent_state`]). When similarity exceeds the convergence
//! threshold (`0.92` by default), the trajectory is declared stable. This
//! prevents over-iteration (wasting compute) and under-iteration
//! (premature output).
//!
//! # Where it sits in the pipeline
//!
//! The functions in this module are the **public API** of the CLT
//! innovation. They are currently surfaced in `/health` and `/pipeline`
//! telemetry (`clt_loops`, `clt_convergences`, `clt_total_steps`) but are
//! **not yet wired into the main `chat_completions` pipeline** — they
//! remain a ready-to-integrate scaffold. When enabled, a CLT loop will
//! wrap the existing Stage-5–7 solve/synthesize steps for Complex queries:
//! each iteration's output becomes the next iteration's `prev_output`,
//! [`check_convergence`] decides when to stop, and [`build_iteration_prompt`]
//! formats the recurrent prompt.

use crate::tfidf::{cosine, SparseVec, TfidfVectorizer};

/// Configuration for a CLT reasoning loop. Tuneable per-call (the engine
/// can pass different configs to different query-complexity buckets).
#[derive(Clone)]
pub struct CLTConfig {
    /// Maximum number of latent iterations before forced collapse. Acts as
    /// a safety bound so a non-converging trajectory still terminates.
    pub max_steps: usize,
    /// Convergence threshold: if cosine similarity between consecutive
    /// outputs exceeds this, the trajectory is declared stable. The
    /// default of `0.92` corresponds to "the model's output barely changed
    /// between iterations" — a strong signal that further iteration would
    /// be wasted compute.
    pub convergence_threshold: f64,
    /// Minimum number of steps before checking convergence (allow warmup).
    /// Early iterations always look "converged" because the trajectory is
    /// still in its initial ascent, so we skip the convergence check until
    /// `min_steps` have executed.
    pub min_steps: usize,
}

impl Default for CLTConfig {
    fn default() -> Self {
        Self {
            max_steps: 10,
            convergence_threshold: 0.92,
            min_steps: 3,
        }
    }
}

/// The state of a CLT reasoning loop. Serialized by `/pipeline` so the
/// Memory Network visualizer can render the trajectory live.
#[derive(Clone, serde::Serialize)]
pub struct CLTState {
    /// The original query being reasoned about.
    pub query: String,
    /// The history of latent states (text representations of each iteration).
    pub trajectory: Vec<String>,
    /// Convergence similarity scores between consecutive iterations.
    /// `convergence_scores[i]` is the cosine similarity between
    /// `trajectory[i]` and `trajectory[i+1]`. Length is therefore
    /// `trajectory.len() - 1` (or 0 if the trajectory has fewer than 2
    /// entries).
    pub convergence_scores: Vec<f64>,
    /// Whether the trajectory converged (reached stability).
    pub converged: bool,
    /// The step at which convergence was detected (`None` if not converged).
    pub convergence_step: Option<usize>,
    /// Total number of steps executed.
    pub steps_executed: usize,
}

impl CLTState {
    /// Create a fresh state for a new CLT loop. The trajectory and
    /// convergence scores start empty; the first iteration's output will
    /// be appended by the caller.
    pub fn new(query: &str) -> Self {
        Self {
            query: query.to_string(),
            trajectory: Vec::new(),
            convergence_scores: Vec::new(),
            converged: false,
            convergence_step: None,
            steps_executed: 0,
        }
    }
}

/// Check if the trajectory has converged by comparing the last two outputs.
///
/// Uses TF-IDF cosine similarity. If the model's output hasn't changed
/// significantly between iterations, it has reached a stable point in
/// latent space and further iteration would be wasted compute.
///
/// Returns the raw cosine similarity in `[0.0, 1.0]`; the caller compares
/// it against [`CLTConfig::convergence_threshold`] to decide. Returning
/// the raw score (rather than a bool) lets the caller also track the
/// *trajectory* of convergence (e.g. "is the similarity monotonically
/// increasing?") for richer stopping criteria.
///
/// # Why TF-IDF and not embeddings?
///
/// A 3B-parameter backend can't cheaply expose its hidden states through
/// an OpenAI-compatible API, so we use the text output as a proxy. The
/// TF-IDF vector of each iteration's text serves as a cheap, deterministic
/// approximation of the latent state. This is the same trick the action
/// cache and the distillation store use, so it shares the same
/// [`TfidfVectorizer`] infrastructure.
pub fn check_convergence(
    prev_output: &str,
    curr_output: &str,
    vectorizer: &TfidfVectorizer,
) -> f64 {
    let prev_vec = vectorizer.vectorize(prev_output);
    let curr_vec = vectorizer.vectorize(curr_output);
    cosine(&prev_vec, &curr_vec)
}

/// Determine if the CLT loop should continue based on convergence state.
///
/// Returns `true` if the loop should continue, `false` if it should stop
/// (either converged or hit `max_steps`).
///
/// # Stopping rules
///
/// 1. **Hard bound**: stop if `steps_executed >= max_steps`. Prevents an
///    non-converging trajectory from running forever.
/// 2. **Already converged**: stop if `converged` is set (the caller flipped
///    it after a convergence detection).
/// 3. **Stable convergence**: stop only after `min_steps` warmup iterations
///    AND if the **last two** convergence scores are both above
///    `convergence_threshold`. Requiring *two* consecutive high-similarity
///    steps guards against a single coincidental match (e.g. the model
///    echoing the same boilerplate twice while still refining the body).
pub fn should_continue(state: &CLTState, config: &CLTConfig) -> bool {
    if state.steps_executed >= config.max_steps {
        return false;
    }
    if state.converged {
        return false;
    }
    if state.steps_executed >= config.min_steps && state.convergence_scores.len() >= 2 {
        // Check if the last 2 convergence scores are both above threshold.
        // Two-in-a-row requirement filters out single-step coincidences.
        let last_two = &state.convergence_scores[state.convergence_scores.len() - 2..];
        if last_two.iter().all(|&s| s >= config.convergence_threshold) {
            return false;
        }
    }
    true
}

/// Build the prompt for the next CLT iteration.
///
/// Each iteration sees:
/// 1. The original query.
/// 2. The previous iteration's output (as "your previous reasoning").
/// 3. An instruction to refine and improve.
///
/// This creates a recurrent loop where the model iteratively refines its
/// answer in concept space. The `iteration` parameter is 0-indexed and
/// surfaces in the prompt header so the model is aware of how many
/// refinement passes it has already done (and can self-correct more
/// aggressively on later passes).
pub fn build_iteration_prompt(query: &str, prev_output: Option<&str>, iteration: usize) -> String {
    match prev_output {
        None => {
            // First iteration — just the query, with a directive to explore
            // the problem space before committing to an answer.
            format!(
                "# AETHER CLT — LATENT TRAJECTORY ITERATION {}/{}\n\
                 Reason about the following. Do not rush to a final answer — explore the problem space.\n\n\
                 Query: {}\n\n\
                 Provide your initial reasoning:",
                iteration + 1,
                "N",
                query
            )
        }
        Some(prev) => {
            // Subsequent iterations — refine based on previous output.
            // The "if your previous answer is correct, output it unchanged"
            // clause is what enables convergence: once the model is happy,
            // it stops changing the answer and cosine similarity hits 1.0.
            format!(
                "# AETHER CLT — LATENT TRAJECTORY ITERATION {}/{}\n\
                 Your previous reasoning (iteration {}):\n\
                 {}\n\n\
                 Query: {}\n\n\
                 Refine your reasoning. Fix any errors. Deepen the analysis. \
                 If your previous answer is correct and complete, output it unchanged.",
                iteration + 1,
                "N",
                iteration,
                prev,
                query
            )
        }
    }
}

/// Extract the "latent state" from a model response for convergence tracking.
///
/// In a real CLT implementation, this would be the model's hidden state
/// vector. Here, we use the text output as a proxy — the TF-IDF vector of
/// the text serves as an approximation of the latent state.
///
/// This is a thin wrapper around `TfidfVectorizer::vectorize`; it exists
/// as a named entry point so CLT callers don't reach directly into the
/// TF-IDF module (keeps the conceptual boundary clean: the *CLT* layer
/// decides what counts as a "latent state", the *TF-IDF* layer just
/// produces vectors).
pub fn extract_latent_state(output: &str, vectorizer: &TfidfVectorizer) -> SparseVec {
    vectorizer.vectorize(output)
}
