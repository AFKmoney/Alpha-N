//! # Engine — the native (in-process) GGUF inference engine.
//!
//! [`NativeEngine`] is the preferred inference path of `call_backend`: when
//! a model is loaded, prompts are formatted with the model's *real* chat
//! template (read from the GGUF metadata) and decoded in-process — no
//! network hop, no external server.
//!
//! # What is compiled in here
//!
//! This source tree builds with an empty dependency set beyond
//! axum/serde/tokio/reqwest/tower-http, so everything **around** the decode
//! step is fully functional here —
//!
//! - model discovery ([`NativeEngine::find_model_path`]: the
//!   `AETHER_MODEL` env var, then a `models/` directory searched across the
//!   candidate roots cwd → exe dir → `CARGO_MANIFEST_DIR` → `.`),
//! - GGUF header parsing (magic, version, tensor/vocabulary counts and the
//!   metadata key-value block, including the `*.chat_template` string),
//! - chat-template rendering ([`NativeEngine::apply_messages`]),
//! - hot-swapping (the `/admin/reload` handler stores the engine behind an
//!   `Arc<tokio::sync::Mutex<…>>` swap-lock),
//!
//! — while [`NativeEngine::complete`] itself returns an error explaining
//! that the native decode backend is not compiled into this build. Every
//! generation therefore falls through to the OpenAI-compatible HTTP
//! backend (`AETHER_BACKEND`), exactly as `call_backend`'s fallback path
//! documents. The production build swaps `complete`'s body for llama.cpp
//! bindings; the surrounding machinery is unchanged.
//!
//! # Threading
//!
//! The engine is *not* `Sync`-free: it lives in
//! `Arc<tokio::sync::Mutex<NativeEngine>>`, and every generation acquires
//! the inner lock inside `tokio::task::spawn_blocking` (see
//! `call_backend`) so the slow decode never stalls a tokio worker. Loads
//! (`/admin/reload`, startup) are serialized by the outer swap-lock.

use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

/// GGUF magic bytes at offset 0 of every conforming file.
const GGUF_MAGIC: [u8; 4] = *b"GGUF";

/// Maximum metadata key-value pairs parsed before bailing (guards against
/// corrupt headers asking us to loop forever).
const MAX_METADATA_ENTRIES: u64 = 4096;

/// Maximum length of any single metadata string we will read (chat
/// templates run a few KB; anything beyond this is treated as corrupt).
const MAX_STRING_BYTES: u64 = 1 << 20;

// ---------------------------------------------------------------------------
// NativeEngine
// ---------------------------------------------------------------------------

/// A loaded native model: where it came from, its context window, and the
/// header facts needed to format prompts for it.
#[derive(Debug, Clone)]
pub struct NativeEngine {
    /// Canonical path of the loaded `.gguf` file.
    model_path: PathBuf,
    /// Context window (tokens) the engine was loaded with. `/admin/reload`
    /// uses 2048.
    context_size: u32,
    /// The model's chat template, if the GGUF metadata carried one
    /// (conventionally `tokenizer.chat_template`). `None` → ChatML.
    chat_template: Option<String>,
    /// Selected string metadata entries (e.g. `general.architecture`,
    /// `general.name`) for diagnostics.
    metadata: HashMap<String, String>,
    /// Tokenizer vocabulary size from the header.
    vocab_size: u64,
    /// Tensor count from the header.
    tensor_count: u64,
}

impl NativeEngine {
    /// Load a model for inference.
    ///
    /// Resolves the model file via [`NativeEngine::find_model_path`]
    /// (honoring the `AETHER_MODEL` env var when set), parses its GGUF
    /// header for the chat template and identity metadata, and returns the
    /// engine. Errors are human-readable strings — they are surfaced
    /// verbatim by `/admin/reload` and logged at startup.
    ///
    /// Synchronous and (mildly) blocking: file header reads only, no
    /// tensor loading — callers run it inside `spawn_blocking`.
    pub fn load(context_size: u32) -> Result<Self, String> {
        let model_path = Self::find_model_path()
            .ok_or_else(|| "no .gguf model found: drop one in models/ or set AETHER_MODEL".to_string())?;
        let header = parse_gguf_header(&model_path)?;
        let chat_template = header
            .strings
            .iter()
            .find(|(k, _)| k.ends_with("chat_template"))
            .map(|(_, v)| v.clone());
        let engine = Self {
            model_path,
            context_size,
            chat_template,
            metadata: header.strings,
            vocab_size: header.vocab_size,
            tensor_count: header.tensor_count,
        };
        eprintln!(
            "[aether-engine] native model loaded: {} (arch {}, vocab {}, {} tensors, template {})",
            engine.model_path.display(),
            engine.metadata.get("general.architecture").map(String::as_str).unwrap_or("?"),
            engine.vocab_size,
            engine.tensor_count,
            if engine.chat_template.is_some() { "present" } else { "absent (ChatML assumed)" },
        );
        Ok(engine)
    }

    /// Resolve the model file to load.
    ///
    /// Order: the `AETHER_MODEL` env var (if it points at an existing
    /// `.gguf`), then the **newest** `*.gguf` inside the first existing
    /// `models/` directory among the candidate bases cwd → exe dir →
    /// `CARGO_MANIFEST_DIR` → `.` (the same walk `models_root()` in
    /// `handlers.rs` validates `/admin/reload` paths against). Ties break
    /// by file name so the choice is deterministic.
    ///
    /// Reading `AETHER_MODEL` is safe: the only writer is `/admin/reload`,
    /// which serializes the write behind the `native_engine` swap-lock
    /// inside `spawn_blocking` (see the THREAD-SAFETY note there).
    pub fn find_model_path() -> Option<PathBuf> {
        if let Ok(path) = std::env::var("AETHER_MODEL") {
            let p = PathBuf::from(path);
            if p.is_file() && is_gguf(&p) {
                return Some(p);
            }
        }
        let candidates = [
            std::env::current_dir().ok(),
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf())),
            Some(PathBuf::from(env!("CARGO_MANIFEST_DIR"))),
            Some(PathBuf::from(".")),
        ];
        for base in candidates.into_iter().flatten() {
            let dir = base.join("models");
            if !dir.is_dir() {
                continue;
            }
            let mut models: Vec<PathBuf> = match std::fs::read_dir(&dir) {
                Ok(entries) => entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.is_file() && is_gguf(p))
                    .collect(),
                Err(_) => continue,
            };
            models.sort_by(|a, b| {
                let ma = std::fs::metadata(a).and_then(|m| m.modified()).ok();
                let mb = std::fs::metadata(b).and_then(|m| m.modified()).ok();
                mb.cmp(&ma).then_with(|| a.cmp(b))
            });
            if let Some(newest) = models.into_iter().next() {
                return Some(newest);
            }
        }
        None
    }

    /// The identity of the loaded model (`general.name` when present,
    /// else the file name) — used in startup/reload logging.
    pub fn model_name(&self) -> &str {
        self.metadata
            .get("general.name")
            .map(String::as_str)
            .unwrap_or_else(|| {
                self.model_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
            })
    }

    /// Render an OpenAI-shaped `messages` array into a single prompt string
    /// using the model's real chat template.
    ///
    /// With no template in the GGUF (or an unrenderable one) ChatML is
    /// used. The template subset understood here covers the templates
    /// shipped by the common model families: a `{% for message in
    /// messages %}` block repeated per message, `{{ role }}` /
    /// `{{ content }}` (and `message['role']` / `message['content']`)
    /// placeholders, and a leading system block for templates that carry
    /// one; all other Jinja directives are dropped.
    pub fn apply_messages(&self, messages: &Value) -> Result<String, String> {
        let array = messages
            .get("messages")
            .and_then(|m| m.as_array())
            .ok_or("body has no messages array")?;
        let parsed: Vec<(String, String)> = array
            .iter()
            .filter_map(|m| {
                let role = m.get("role")?.as_str()?.to_string();
                let content = m.get("content")?;
                let text = match content {
                    Value::String(s) => s.clone(),
                    Value::Array(parts) => parts
                        .iter()
                        .filter_map(|p| {
                            if p.get("type").and_then(|t| t.as_str()) == Some("text") {
                                p.get("text").and_then(|t| t.as_str()).map(String::from)
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" "),
                    _ => return None,
                };
                Some((role, text))
            })
            .collect();
        if parsed.is_empty() {
            return Err("messages array contains no usable entries".to_string());
        }
        let system = parsed.iter().find(|(r, _)| r == "system").map(|(_, c)| c.clone());
        let conversation: Vec<(String, String)> = parsed
            .into_iter()
            .filter(|(r, _)| r != "system")
            .collect();

        match &self.chat_template {
            Some(template) => render_template(template, system.as_deref(), &conversation),
            None => {
                // ChatML fallback.
                let mut out = String::new();
                if let Some(sys) = &system {
                    out.push_str(&format!("<|im_start|>system\n{sys}<|im_end|>\n"));
                }
                for (role, content) in &conversation {
                    out.push_str(&format!("<|im_start|>{role}\n{content}<|im_end|>\n"));
                }
                out.push_str("<|im_start|>assistant\n");
                Ok(out)
            }
        }
    }

    /// Decode `prompt` for up to `max_tokens` tokens.
    ///
    /// **Stub in this build**: the native decode backend (llama.cpp
    /// bindings) is not compiled into this dependency-free source tree, so
    /// this always returns an error and `call_backend` falls through to
    /// the OpenAI-compatible HTTP backend. The signature and semantics are
    /// final — the production build replaces only the body.
    pub fn complete(&self, prompt: &str, max_tokens: u32) -> Result<String, String> {
        Err(format!(
            "native decode backend not compiled into this build (model {}, context {}, prompt {} chars, max_tokens {max_tokens}); using the HTTP backend instead",
            self.model_name(),
            self.context_size,
            prompt.chars().count(),
        ))
    }
}

/// `true` when `path` exists, is a regular file, and has a `.gguf`
/// extension (case-insensitive).
fn is_gguf(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("gguf"))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// GGUF header parsing
// ---------------------------------------------------------------------------

/// The subset of a GGUF header this engine cares about.
struct GgufHeader {
    /// Metadata string key-value entries (identity + template).
    strings: HashMap<String, String>,
    /// Tokenizer vocabulary size.
    vocab_size: u64,
    /// Tensor count.
    tensor_count: u64,
}

/// Little-endian buffered reader over a GGUF file's header region.
struct GgufReader<R: Read> {
    inner: R,
}

impl<R: Read> GgufReader<R> {
    fn read_exact_n(&mut self, n: usize) -> Result<Vec<u8>, String> {
        let mut buf = vec![0u8; n];
        self.inner
            .read_exact(&mut buf)
            .map_err(|e| format!("truncated GGUF header: {e}"))?;
        Ok(buf)
    }

    fn read_u8(&mut self) -> Result<u8, String> {
        Ok(self.read_exact_n(1)?[0])
    }

    fn read_u32(&mut self) -> Result<u32, String> {
        let b = self.read_exact_n(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn read_u64(&mut self) -> Result<u64, String> {
        let b = self.read_exact_n(8)?;
        Ok(u64::from_le_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }

    fn read_string(&mut self) -> Result<String, String> {
        let len = self.read_u64()?;
        if len > MAX_STRING_BYTES {
            return Err(format!("metadata string length {len} exceeds the safety cap"));
        }
        let bytes = self.read_exact_n(len as usize)?;
        String::from_utf8(bytes).map_err(|e| format!("metadata string is not UTF-8: {e}"))
    }

    /// Skip one metadata value of GGUF type `tag` (recursive for arrays).
    ///
    /// Type tags and sizes follow the GGUF v2/v3 spec: 0/1 = u8/i8,
    /// 2/3 = u16/i16, 4/5 = u32/i32, 6 = f32, 7 = bool (1 byte),
    /// 8 = string, 9 = array, 10/11 = u64/i64, 12 = f64.
    fn skip_value(&mut self, tag: u32) -> Result<(), String> {
        match tag {
            0 | 1 | 7 => {
                self.read_u8()?;
            }
            2 | 3 => {
                self.read_exact_n(2)?;
            }
            4 | 5 | 6 => {
                self.read_exact_n(4)?;
            }
            8 => {
                self.read_string()?;
            }
            9 => {
                // Array: element type + count.
                let elem = self.read_u32()?;
                let count = self.read_u64()?;
                if count > MAX_METADATA_ENTRIES * 64 {
                    return Err(format!("metadata array count {count} exceeds the safety cap"));
                }
                for _ in 0..count {
                    self.skip_value(elem)?;
                }
            }
            10 | 11 | 12 => {
                self.read_exact_n(8)?;
            }
            _ => return Err(format!("unknown GGUF metadata type tag {tag}")),
        }
        Ok(())
    }
}

/// Parse the GGUF header of `path`: validate the magic, read the counts,
/// and harvest string metadata (notably `*.chat_template`). Reads only the
/// first few KB of the file (a 64 KiB buffer covers every known header
/// with room to spare) — tensor data is never touched.
fn parse_gguf_header(path: &Path) -> Result<GgufHeader, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("cannot open model: {e}"))?;
    let mut reader = GgufReader {
        inner: std::io::BufReader::with_capacity(64 * 1024, file),
    };
    let magic = reader.read_exact_n(4)?;
    if magic != GGUF_MAGIC {
        return Err(format!("not a GGUF file (bad magic: {magic:?})"));
    }
    let version = reader.read_u32()?;
    if version == 0 || version > 3 {
        return Err(format!("unsupported GGUF version {version}"));
    }
    // v1 uses u32 counts; v2+ use u64.
    let (tensor_count, kv_count) = if version == 1 {
        (reader.read_u32()? as u64, reader.read_u32()? as u64)
    } else {
        (reader.read_u64()?, reader.read_u64()?)
    };
    if kv_count > MAX_METADATA_ENTRIES {
        return Err(format!("metadata entry count {kv_count} exceeds the safety cap"));
    }

    let mut strings: HashMap<String, String> = HashMap::new();
    let mut vocab_size: u64 = 0;
    for _ in 0..kv_count {
        let key = reader.read_string()?;
        let tag = reader.read_u32()?;
        // Harvest the values we care about; skip everything else.
        if tag == 8 {
            let value = reader.read_string()?;
            if key.ends_with("chat_template") || key.starts_with("general.") {
                strings.insert(key, value);
            }
        } else if tag == 4 {
            let v = reader.read_u32()? as u64;
            if key == "tokenizer.ggml.vocab_size" || key.ends_with(".vocab_size") {
                vocab_size = v;
            }
        } else if tag == 10 {
            let v = reader.read_u64()?;
            if key == "tokenizer.ggml.vocab_size" || key.ends_with(".vocab_size") {
                vocab_size = v;
            }
        } else {
            reader.skip_value(tag)?;
        }
    }
    Ok(GgufHeader {
        strings,
        vocab_size,
        tensor_count,
    })
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/// Render `template` for one conversation using the supported subset (see
/// [`NativeEngine::apply_messages`]).
///
/// Concretely: the template is split on `{% … %}` directives. A
/// `{% for message in messages %}` block is expanded once per message
/// with the placeholders `{{ role }}`, `{{ content }}`,
/// `{{ message['role'] }}`, `{{ message['content'] }}` and
/// `{{ system_message }}` substituted; every other directive block is
/// dropped; text outside the loop is emitted once with
/// `{{ system_message }}` substituted when a system message exists.
fn render_template(
    template: &str,
    system: Option<&str>,
    conversation: &[(String, String)],
) -> Result<String, String> {
    // Split into segments: literal text and {% directives %}.
    let mut segments: Vec<Segment> = Vec::new();
    let mut rest = template;
    while let Some(start) = rest.find("{%") {
        if start > 0 {
            segments.push(Segment::Text(rest[..start].to_string()));
        }
        let after = &rest[start + 2..];
        let end = after
            .find("%}")
            .ok_or_else(|| "unterminated {# directive #} in chat template".to_string())?;
        segments.push(Segment::Directive(after[..end].trim().to_string()));
        rest = &after[end + 2..];
    }
    if !rest.is_empty() {
        segments.push(Segment::Text(rest.to_string()));
    }

    let mut out = String::new();
    let mut in_message_loop = false;
    let mut loop_body = String::new();
    for segment in &segments {
        match segment {
            Segment::Text(text) => {
                if in_message_loop {
                    loop_body.push_str(text);
                } else if let Some(sys) = system {
                    out.push_str(&substitute_system(text, sys));
                }
                // No system message → emit the literal text unchanged
                // (templates guard the system block with {% if %}, which
                // is dropped, so this is the safe default).
                else {
                    out.push_str(text);
                }
            }
            Segment::Directive(directive) => {
                if directive.starts_with("for message in messages") {
                    if in_message_loop {
                        return Err("nested for-loop in chat template".to_string());
                    }
                    in_message_loop = true;
                    loop_body.clear();
                } else if directive.starts_with("endfor") {
                    if !in_message_loop {
                        return Err("endfor without for in chat template".to_string());
                    }
                    in_message_loop = false;
                    for (role, content) in conversation {
                        out.push_str(&substitute_message(&loop_body, role, content));
                    }
                }
                // All other directives (if / else / endif / generation
                // markers / …) are dropped.
            }
        }
    }
    if in_message_loop {
        return Err("unterminated for-loop in chat template".to_string());
    }
    if out.trim().is_empty() {
        return Err("chat template rendered to an empty prompt".to_string());
    }
    Ok(out)
}

/// One piece of a split template: literal text or a `{% … %}` directive.
enum Segment {
    /// Literal text between directives.
    Text(String),
    /// The trimmed body of a `{% … %}` directive.
    Directive(String),
}

/// Substitute the per-message placeholders inside a loop body.
fn substitute_message(body: &str, role: &str, content: &str) -> String {
    body.replace("{{ message['role'] }}", role)
        .replace("{{ message['content'] }}", content)
        .replace("{{ role }}", role)
        .replace("{{ content }}", content)
}

/// Substitute `{{ system_message }}` (and the common
/// `{{ messages[0]['content'] }}` form) in loop-external text.
fn substitute_system(text: &str, system: &str) -> String {
    text.replace("{{ system_message }}", system)
        .replace("{{ messages[0]['content'] }}", system)
}
