//! Continuous Latent Trajectory (CLT) Reasoning
//!
//! Bypasses discrete token generation during reasoning. Instead of generating
//! text token-by-token (which is slow and error-prone for small models), the
//! engine executes an N-step recurrent loop strictly within the model's
//! high-dimensional latent space. It resolves logical states as continuous
//! vectors, only collapsing the wave-function to discrete tokens when the
//! latent trajectory stabilizes (converges).
//!
//! # The Insight
//!
//! A small model's vocabulary projection (logits → softmax → token) is the
//! main source of errors. Each token is a lossy compression of the model's
//! rich internal state. By staying in latent space and iterating, the model
//! can "think" in pure concepts without the quantization noise of tokens.
//!
//! # How It Works (Software-Level Simulation)
//!
//! In a real implementation, CLT would intercept the model's hidden states
//! before the LM head and feed them back as input. Since we're building a
//! middleware engine (not a custom model runtime), we simulate this by:
//!
//! 1. Running the model N times with progressively refined prompts
//!    (each iteration's output becomes the next iteration's context)
//! 2. Measuring the semantic distance between consecutive outputs
//! 3. When the distance drops below a threshold (convergence), the trajectory
//!    has stabilized — we output the final result
//! 4. If it doesn't converge within max_steps, we take the last output
//!
//! This captures the ESSENCE of CLT: iterative refinement in concept space
//! until stability, rather than one-shot token generation.
//!
//! # Convergence Detection
//!
//! The engine measures cosine similarity between consecutive latent states
//! (approximated by TF-IDF vectors of consecutive outputs). When similarity
//! exceeds the convergence threshold (0.92), the trajectory is declared stable.
//! This prevents over-iteration (wasting compute) and under-iteration
//! (premature output).

use crate::tfidf::{cosine, SparseVec, TfidfVectorizer};

/// Configuration for a CLT reasoning loop.
#[derive(Clone)]
pub struct CLTConfig {
    /// Maximum number of latent iterations before forced collapse.
    pub max_steps: usize,
    /// Convergence threshold: if cosine similarity between consecutive
    /// outputs exceeds this, the trajectory is declared stable.
    pub convergence_threshold: f64,
    /// Minimum number of steps before checking convergence (allow warmup).
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

/// The state of a CLT reasoning loop.
#[derive(Clone, serde::Serialize)]
pub struct CLTState {
    /// The original query being reasoned about.
    pub query: String,
    /// The history of latent states (text representations of each iteration).
    pub trajectory: Vec<String>,
    /// Convergence similarity scores between consecutive iterations.
    pub convergence_scores: Vec<f64>,
    /// Whether the trajectory converged (reached stability).
    pub converged: bool,
    /// The step at which convergence was detected.
    pub convergence_step: Option<usize>,
    /// Total number of steps executed.
    pub steps_executed: usize,
}

impl CLTState {
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
/// Returns true if the loop should continue, false if it should stop
/// (either converged or hit max_steps).
pub fn should_continue(state: &CLTState, config: &CLTConfig) -> bool {
    if state.steps_executed >= config.max_steps {
        return false;
    }
    if state.converged {
        return false;
    }
    if state.steps_executed >= config.min_steps && state.convergence_scores.len() >= 2 {
        // Check if the last 2 convergence scores are both above threshold
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
/// 1. The original query
/// 2. The previous iteration's output (as "your previous reasoning")
/// 3. An instruction to refine and improve
///
/// This creates a recurrent loop where the model iteratively refines its
/// answer in concept space.
pub fn build_iteration_prompt(query: &str, prev_output: Option<&str>, iteration: usize) -> String {
    match prev_output {
        None => {
            // First iteration — just the query
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
            // Subsequent iterations — refine based on previous output
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
/// In a real CLT implementation, this would be the model's hidden state vector.
/// Here, we use the text output as a proxy — the TF-IDF vector of the text
/// serves as an approximation of the latent state.
pub fn extract_latent_state(output: &str, vectorizer: &TfidfVectorizer) -> SparseVec {
    vectorizer.vectorize(output)
}
