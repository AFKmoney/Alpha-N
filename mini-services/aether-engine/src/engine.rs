//! # Native inference engine (llama.cpp bindings).
//!
//! This is the *real* brain of Alpha-OS: a GGUF model loaded directly into
//! the Aether process via the `llama-cpp-2` crate (bindings to llama.cpp).
//! No external backend (Ollama, cloud) is required — inference runs in the
//! same process as the OS's cognitive pipeline.
//!
//! The engine is loaded once at startup (lazy on first request) and kept in
//! memory for the lifetime of the process. The model path is auto-detected
//! from the `models/` directory (first `.gguf` file), or overridden via the
//! `AETHER_MODEL` env var.
//!
//! ## Integration with the cognitive pipeline
//!
//! [`NativeEngine::complete`] takes a chat-formatted prompt and returns a
//! generated string. The 10-stage pipeline (TF-IDF, HCM, decompose, etc.)
//! calls this instead of an HTTP backend, so the full capacity multiplier
//! runs on top of local inference.

use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::OnceLock;

use llama_cpp_2::{
    context::params::LlamaContextParams,
    context::LlamaContext,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::params::LlamaModelParams,
    model::{AddBos, LlamaModel, Special},
    token::LlamaToken,
};

/// A loaded native model. The global `BACKEND` (llama.cpp init) lives in a
/// static OnceLock and is referenced, not owned, here — LlamaBackend is not
/// Clone and frees itself on drop, so it must be a process-wide singleton.
pub struct NativeEngine {
    model: LlamaModel,
    ctx_capacity: u32,
}

static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();

impl NativeEngine {
    /// Locate the GGUF model to load. Priority:
    ///   1. `AETHER_MODEL` env var (absolute path)
    ///   2. the first `.gguf` file in `<repo>/models/`
    pub fn find_model_path() -> Option<PathBuf> {
        if let Ok(path) = std::env::var("AETHER_MODEL") {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
        // Walk up from the executable / cwd looking for a models/ dir.
        let candidates = [
            std::env::current_dir().ok(),
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf())),
            Some(PathBuf::from(env!("CARGO_MANIFEST_DIR"))),
            Some(PathBuf::from(".")),
        ];
        for base in candidates.into_iter().flatten() {
            let models_dir = base.join("models");
            if let Ok(entries) = std::fs::read_dir(&models_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("gguf") {
                        return Some(path);
                    }
                }
            }
        }
        None
    }

    /// Initialise the global llama.cpp backend exactly once. Subsequent calls
    /// return the cached result (Ok or the original error).
    fn backend() -> Result<&'static LlamaBackend, String> {
        let res = BACKEND.get_or_init(|| match LlamaBackend::init() {
            Ok(b) => Ok(b),
            Err(e) => Err(format!("backend init failed: {e:?}")),
        });
        res.as_ref().map_err(|e| e.clone())
    }

    /// Load the engine. Expensive — call once at startup.
    pub fn load(ctx_capacity: u32) -> Result<Self, String> {
        let backend = Self::backend()?;
        let model_path = Self::find_model_path()
            .ok_or_else(|| "no .gguf model found in models/ (set AETHER_MODEL)".to_string())?;

        eprintln!(
            "[aether-engine] loading native model: {}",
            model_path.display()
        );

        let model_params = LlamaModelParams::default();
        let model = LlamaModel::load_from_file(backend, &model_path, &model_params)
            .map_err(|e| format!("model load failed: {e:?}"))?;

        eprintln!(
            "[aether-engine] model loaded (vocab {} tokens)",
            model.n_vocab()
        );

        Ok(Self {
            model,
            ctx_capacity,
        })
    }

    /// Generate a completion for the given prompt. Uses greedy sampling for
    /// determinism + speed; temperature/top-k can be wired later via params.
    pub fn complete(&self, prompt: &str, max_tokens: u32) -> Result<String, String> {
        let backend = Self::backend()?;
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(self.ctx_capacity));
        let mut ctx = self
            .model
            .new_context(backend, ctx_params)
            .map_err(|e| format!("context creation failed: {e:?}"))?;

        // Tokenise the prompt (with BOS).
        let tokens = self
            .model
            .str_to_token(prompt, AddBos::Always)
            .map_err(|e| format!("tokenisation failed: {e:?}"))?;
        if tokens.is_empty() {
            return Err("empty prompt tokens".to_string());
        }

        // Feed the prompt into the KV cache.
        let mut batch = LlamaBatch::new(self.ctx_capacity as usize, 1);
        let last_idx = tokens.len() as i32 - 1;
        for (i, tok) in tokens.iter().enumerate() {
            batch
                .add(*tok, i as i32, &[0], i as i32 == last_idx)
                .map_err(|e| format!("batch add failed: {e:?}"))?;
        }
        ctx.decode(&mut batch)
            .map_err(|e| format!("prompt decode failed: {e:?}"))?;

        // Greedy autoregressive generation.
        let eos = self.model.token_eos();
        let mut n_cur = batch.n_tokens();
        let mut output = String::new();
        for _ in 0..max_tokens {
            let last = batch.n_tokens() - 1;
            let logits = ctx.get_logits_ith(last);
            let best = logits
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(i, _)| i)
                .unwrap_or(0);
            let tok = LlamaToken(best as i32);
            if tok == eos {
                break;
            }
            match self.model.token_to_str(tok, Special::Tokenize) {
                Ok(piece) => output.push_str(&piece),
                Err(_) => break,
            }
            batch.clear();
            batch
                .add(tok, n_cur, &[0], true)
                .map_err(|e| format!("gen batch add failed: {e:?}"))?;
            ctx.decode(&mut batch)
                .map_err(|e| format!("gen decode failed: {e:?}"))?;
            n_cur += 1;
        }
        Ok(output)
    }
}

/// Convert an OpenAI-style messages array into a single prompt string the
/// model can consume. Simple chat-template concatenation (role: content).
pub fn messages_to_prompt(messages: &serde_json::Value) -> String {
    let mut out = String::new();
    if let Some(arr) = messages.as_array() {
        for msg in arr {
            let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("user");
            let content = msg
                .get("content")
                .map(|c| {
                    // content may be a string or an array of {text} parts.
                    if let Some(s) = c.as_str() {
                        s.to_string()
                    } else if let Some(parts) = c.as_array() {
                        parts
                            .iter()
                            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join("")
                    } else {
                        String::new()
                    }
                })
                .unwrap_or_default();
            out.push_str(&format!("{role}: {content}\n"));
        }
    }
    out.push_str("assistant: ");
    out
}

// Provide a LlamaContext reference for callers that need lower-level access.
// Kept minimal for now; expand if the pipeline needs streaming/logits.
#[allow(dead_code)]
fn _touch(_ctx: &LlamaContext<'_>) {}
