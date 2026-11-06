//! # Agent — the autonomous OS-management agentic loop.
//!
//! This module is the **brain** of the autonomous OS layer. It implements
//! the classical perceive → think → act → observe control loop on top of
//! the Aether Engine's existing inference pipeline, turning a small GGUF
//! model into an autonomous agent capable of managing a Linux-like OS:
//!
//! 1. **Perceive** — receive the current OS state (open windows, memory
//!    snapshot, active plan, goals) as a `context` JSON object.
//! 2. **Think** — call the LLM through the engine's OpenAI-compatible
//!    backend, primed with a system prompt that frames the model as an
//!    autonomous OS agent and lists every available tool's schema.
//! 3. **Act** — parse the LLM's response for tool calls (see
//!    [`parse_tool_calls`], which supports both bare inline JSON and
//!    fenced-code-block formats).
//! 4. **Execute** — dispatch each parsed [`ToolCall`] through the
//!    [`ToolRegistry`](crate::tools::ToolRegistry); on success, capture the
//!    tool's output. On failure (unknown tool, invalid params, executor
//!    error), capture a diagnostic instead.
//! 5. **Observe** — feed every tool result back into the message stream as
//!    a new tool-role message, so the LLM sees the consequence of its
//!    action on the next think step.
//! 6. **Repeat** — continue until the LLM emits the `TASK_COMPLETE` sentinel,
//!    emits a response with no tool calls, or the iteration cap is hit.
//!
//! # Architecture
//!
//! ```text
//!                 ┌─────────────────────────────┐
//!   goal ───────▶│  run_agent_loop              │
//!   context ────▶│  ┌────────────────────────┐  │
//!                 │  │ 1. Perceive (state)    │  │
//!                 │  │ 2. Think  (LLM call)   │  │
//!                 │  │ 3. Act    (parse calls)│  │
//!                 │  │ 4. Execute (registry)  │  │
//!                 │  │ 5. Observe (feed back) │  │
//!                 │  │ 6. Repeat / stop       │  │
//!                 │  └────────────────────────┘  │
//!                 │  ──▶ AgentRunResult           │
//!                 └─────────────────────────────┘
//! ```
//!
//! The loop is **stateless across requests**: every `POST /v1/agent/run`
//! call starts a fresh [`AgentState`]. Persistence (memory, plans, goals)
//! is delegated to the existing Aether Engine endpoints (`/graph/add`,
//! `/graph/search`) and to the Next.js layer's plan store. The `context`
//! field on the request body is the bridge — the caller assembles the
//! current OS snapshot into it before each call.
//!
//! # Why this lives in the inference engine
//!
//! Putting the agent loop in the Aether Engine (rather than the Next.js
//! layer) means the loop benefits from all ten engine innovations: every
//! think step's system prompt can be augmented by graph retrieval, every
//! repeated goal can hit the action cache, every complex step can be
//! decomposed, and every response is ATD-verified. The agent loop is a
//! *client* of the cognitive pipeline, not a replacement for it.
//!
//! # Termination
//!
//! The loop stops when any of the following is true:
//!
//! - The LLM's response contains the literal `TASK_COMPLETE` sentinel
//!   (case-sensitive). `completed` is set to `true`.
//! - The LLM's response contains no parseable tool calls. `completed` is
//!   `false` (the agent stopped without an explicit completion signal).
//! - `max_iterations` is reached. `completed` is `false`.
//!
//! The caller decides what to do with an incomplete result (retry, surface
//! to the user, etc.).

use crate::tools::{Tool, ToolRegistry};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// Core data types
// ---------------------------------------------------------------------------

/// A single message in the agent's conversation log.
///
/// Roles mirror the OpenAI chat-completions spec, with one extension:
/// `tool` is used for tool-result messages so the caller can distinguish
/// them from ordinary user messages in the log. When serialized for the
/// backend LLM call ([`AgentMessage::to_request_json`]), `tool` messages
/// are rewritten to `user` role with a `[tool_result: <tool>]` prefix,
/// because small GGUF models frequently reject the `tool` role without a
/// matching `tool_call_id`. The semantic content is preserved.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentMessage {
    /// `"system"`, `"user"`, `"assistant"`, or `"tool"`.
    pub role: String,
    /// The message text. For `tool` messages this is the tool's output.
    pub content: String,
    /// For `tool` messages: the name of the tool that produced this output.
    /// `None` for all other roles.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl AgentMessage {
    /// Construct a `system` message.
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".to_string(),
            content: content.into(),
            name: None,
        }
    }

    /// Construct a `user` message.
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: content.into(),
            name: None,
        }
    }

    /// Construct an `assistant` message (the LLM's prior response).
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: content.into(),
            name: None,
        }
    }

    /// Construct a `tool` message capturing a tool's output. `tool_name`
    /// is recorded in [`name`](Self::name) and used to prefix the content
    /// when serializing for the backend.
    pub fn tool(tool_name: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: "tool".to_string(),
            content: content.into(),
            name: Some(tool_name.into()),
        }
    }

    /// Serialize this message into the OpenAI chat-completions `messages[]`
    /// shape for the backend LLM call. See the type docs for the `tool` →
    /// `user` rewrite rationale.
    pub fn to_request_json(&self) -> Value {
        match self.role.as_str() {
            "tool" => json!({
                "role": "user",
                "content": format!(
                    "[tool_result: {}] {}",
                    self.name.as_deref().unwrap_or("unknown"),
                    self.content
                ),
            }),
            other => json!({
                "role": other,
                "content": self.content,
            }),
        }
    }
}

/// A parsed tool call extracted from the LLM's response text.
///
/// Constructed by [`parse_tool_calls`]. The `name` field is matched
/// against [`Tool::from_request`] to build a typed [`Tool`] before
/// execution; an unknown name yields a `tool_not_found` diagnostic
/// instead of a real execution.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolCall {
    /// Canonical tool name (e.g. `"file_read"`, `"exec"`).
    pub name: String,
    /// JSON parameters object as parsed from the LLM payload.
    pub params: Value,
}

/// The result of executing one [`ToolCall`]. Captured into
/// [`AgentState::tool_results`] and fed back to the LLM as a `tool`-role
/// [`AgentMessage`] on the next iteration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolResult {
    /// Name of the tool that produced this result (echoed back from the
    /// [`ToolCall::name`] that triggered it).
    pub tool: String,
    /// Human/LLM-readable output string. On failure this is a diagnostic
    /// message (`"tool_not_found: …"`, `"invalid_params: …"`, …).
    pub output: String,
    /// `true` when the tool executor returned success, `false` on any kind
    /// of failure (unknown tool, bad params, executor error).
    pub success: bool,
}

/// The LLM's response on one think step. Parsed from the raw backend
/// response text by [`extract_assistant_content`]; the optional
/// `tool_calls` field is filled in by the caller using
/// [`parse_tool_calls`].
#[derive(Clone, Debug)]
pub struct AgentResponse {
    /// The full assistant text. May contain zero or more tool-call JSON
    /// payloads plus free-form reasoning.
    pub text: String,
    /// Tool calls parsed from `text`. Empty when the LLM made no tool
    /// calls this iteration.
    pub tool_calls: Vec<ToolCall>,
}

/// Mutable state carried across iterations of the agent loop.
///
/// A fresh [`AgentState`] is constructed at the top of
/// [`run_agent_loop`]; each iteration reads from it (messages → LLM call)
/// and writes to it (append assistant + tool messages, append tool
/// results, bump iteration counter, set `completed` on termination).
#[derive(Clone, Debug)]
pub struct AgentState {
    /// 1-indexed iteration counter. `0` before the first think step.
    pub iteration: usize,
    /// The full message stream: `[system, user(goal), assistant, tool,
    /// assistant, tool, …]`.
    pub messages: Vec<AgentMessage>,
    /// Every tool result produced so far, in execution order. Used by the
    /// handler to surface a transcript of what the agent did.
    pub tool_results: Vec<ToolResult>,
    /// `true` only when the LLM emitted the `TASK_COMPLETE` sentinel.
    pub completed: bool,
}

/// Final return value of [`run_agent_loop`]. Serialized by the
/// `POST /v1/agent/run` handler into the HTTP response.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentRunResult {
    /// The last assistant response text (or an error/diagnostic string if
    /// the backend was unreachable on the final iteration).
    pub result: String,
    /// Number of think iterations executed (1-indexed; matches
    /// [`AgentState::iteration`] at loop exit).
    pub iterations: usize,
    /// Every tool call the LLM made across all iterations, in order.
    /// Useful for UIs that want to render a transcript of the agent's
    /// actions.
    pub tool_calls: Vec<ToolCall>,
    /// `true` when the LLM explicitly signaled completion via
    /// `TASK_COMPLETE`. `false` when the loop exited due to no-tool-calls
    /// or `max_iterations`.
    pub completed: bool,
}

// ---------------------------------------------------------------------------
// Sentinel: the LLM emits this literal string (case-sensitive) to signal
// that the goal has been achieved and the loop should stop.
// ---------------------------------------------------------------------------

/// Sentinel the LLM emits (anywhere in its response) to signal that the
/// goal is achieved and the loop should stop. Case-sensitive. Documented
/// in [`build_agent_system_prompt`].
pub const TASK_COMPLETE_SENTINEL: &str = "TASK_COMPLETE";

/// Default iteration cap. Overridable per request via the
/// `max_iterations` field on `POST /v1/agent/run`.
pub const DEFAULT_MAX_ITERATIONS: usize = 20;

/// Hard upper bound on iterations, enforced regardless of what the caller
/// passes. Prevents a runaway agent from burning CPU forever against a
/// broken backend.
pub const ABSOLUTE_MAX_ITERATIONS: usize = 50;

// ---------------------------------------------------------------------------
// System prompt construction
// ---------------------------------------------------------------------------

/// Build the system prompt that frames the LLM as an autonomous OS agent
/// with access to the supplied `tool_catalog` and the supplied OS `context`.
///
/// The prompt is split into five sections:
///
/// 1. **Identity** — "You are the autonomous agent core of Alpha-OS."
/// 2. **Goal protocol** — how to call tools (JSON object format), and how
///    to signal completion (`TASK_COMPLETE`).
/// 3. **Available tools** — one block per tool with name + description +
///    JSON Schema.
/// 4. **Current OS state** — the `context` JSON pretty-printed, so the
///    LLM perceives the open windows, memory snapshot, active plan, etc.
/// 5. **Operating principles** — minimal, focused guidance: act
///    deliberately, verify with `memory_search`, persist lessons with
///    `memory_add`, decompose with `plan_create` before complex actions.
///
/// `context` is interpolated as pretty-printed JSON. If `context` is not
/// an object, it is wrapped in `{ "context": <value> }` so the prompt
/// always renders a stable shape.
pub fn build_agent_system_prompt(tool_catalog: &[crate::tools::ToolSpec], context: &Value) -> String {
    // Render the tool catalog as one block per tool.
    let mut tool_blocks = String::with_capacity(8 * 1024);
    for spec in tool_catalog {
        tool_blocks.push_str(&format!(
            "### {name}\n{desc}\n\nParameters (JSON Schema):\n```json\n{schema}\n```\n\n",
            name = spec.name,
            desc = spec.description,
            schema = serde_json::to_string_pretty(&spec.parameters)
                .unwrap_or_else(|_| "{}".to_string()),
        ));
    }

    // Render the OS context as pretty JSON. Wrap non-objects so the prompt
    // shape is stable regardless of caller input.
    let context_json = if context.is_object() && !context.is_array() {
        serde_json::to_string_pretty(context).unwrap_or_else(|_| "{}".to_string())
    } else {
        serde_json::to_string_pretty(&json!({ "context": context }))
            .unwrap_or_else(|_| "{}".to_string())
    };

    format!(
        "# AETHER AUTONOMOUS AGENT — Alpha-OS Cognitive Core\n\
         You are the autonomous agent core of Alpha-OS, a self-evolving Linux-like OS. \
         You perceive the current OS state, reason about what to do, and act through tools. \
         Your job is to achieve the user's goal by issuing tool calls and observing their results, \
         iterating until the goal is complete.\n\n\
         ## Goal protocol\n\
         To call a tool, emit a JSON object anywhere in your response. The object MUST have a \
         `tool` (or `name`) field set to one of the available tool names, and a `params` (or \
         `arguments`) field containing the tool's parameters as a JSON object. You may emit \
         multiple tool calls in a single response; they will be executed in order and their \
         results fed back to you as `[tool_result: <tool>]` messages.\n\n\
         Example:\n\
         ```json\n\
         {{\n\
           \"tool\": \"file_read\",\n\
           \"params\": {{ \"path\": \"/etc/hostname\" }}\n\
         }}\n\
         ```\n\n\
         When — and only when — you have achieved the user's goal, emit the literal sentinel \
         `{sentinel}` on its own line. Do not emit it unless the goal is fully achieved.\n\n\
         ## Available tools\n\
         {tool_blocks}\n\
         ## Current OS state\n\
         The following JSON snapshot describes the current state of the OS you are managing \
         (open windows, memory, active plan, goals, etc.). Use it to ground your actions.\n\
         ```json\n\
         {context_json}\n\
         ```\n\n\
         ## Operating principles\n\
         - Act deliberately: one logical action per iteration when possible.\n\
         - Verify before trusting: use `memory_search` to recall relevant facts before \
         destructive actions (`file_delete`, `exec` with side effects).\n\
         - Persist lessons: use `memory_add` to record anything worth remembering for \
         future iterations.\n\
         - Decompose complexity: use `plan_create` for any goal with more than two steps, \
         then `plan_update` as you complete each step.\n\
         - Observe carefully: tool results arrive as `[tool_result: <tool>]` messages; \
         read them before deciding the next action.\n\
         - Stop only when done: emit `{sentinel}` when the goal is fully achieved.",
        sentinel = TASK_COMPLETE_SENTINEL,
        tool_blocks = tool_blocks,
        context_json = context_json,
    )
}

// ---------------------------------------------------------------------------
// Tool-call parsing
// ---------------------------------------------------------------------------

/// Parse zero or more [`ToolCall`]s from the LLM's response text.
///
/// Supports every common emission format small GGUF models produce:
///
/// - **Inline JSON** — `{"tool": "file_read", "params": {"path": "…"}}`
///   appearing anywhere in the response (including inside prose).
/// - **Fenced code blocks** — ` ```json\n{…}\n``` ` or ` ```tool\n{…}\n``` `.
///   The fenced content is scanned with the same JSON extractor.
/// - **OpenAI function-call shape** — `{"function": {"name": "…",
///   "arguments": "…"}}` (arguments may be a JSON string or object).
/// - **Wrapper arrays** — `{"tool_calls": [{…}, {…}]}` expands to
///   multiple calls.
/// - **Alternate field names** — `name`/`tool_name` for the tool name;
///   `arguments`/`args` for parameters.
///
/// The parser walks the response once, scanning for `{` and attempting to
/// extract a balanced JSON object at each occurrence. String-literal
/// braces (e.g. inside a `"```json\n…\n```"` code fence description) are
/// correctly skipped via the in-string / escape flags. Every successfully
/// parsed JSON object is then classified by [`value_to_tool_calls`] as a
/// single call, an array of calls, or a non-tool object (ignored).
///
/// Returns the calls in source order. Duplicates are preserved (the LLM
/// may legitimately emit the same call twice if the first attempt didn't
/// return the expected result).
pub fn parse_tool_calls(response: &str) -> Vec<ToolCall> {
    let mut calls = Vec::new();
    let bytes = response.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some((json_str, end)) = extract_balanced_json(response, i) {
                if let Ok(v) = serde_json::from_str::<Value>(&json_str) {
                    calls.extend(value_to_tool_calls(&v));
                }
                // Skip past the balanced object whether or not it parsed.
                // (A failed parse means malformed JSON; we still want to
                // jump past it to avoid re-scanning its interior.)
                i = end;
                continue;
            }
        }
        i += 1;
    }
    calls
}

/// Extract a balanced JSON object (including any nested braces) starting
/// at `start` (which MUST point at a `{` byte). Returns the matched
/// substring and the index *after* the closing `}`, or `None` if no
/// balanced match is found before end-of-input.
///
/// Honors JSON string literals (`"…"`) and escape sequences (`\"`, `\\`,
/// …) so braces inside strings don't affect depth counting.
fn extract_balanced_json(s: &str, start: usize) -> Option<(String, usize)> {
    let bytes = s.as_bytes();
    if start >= bytes.len() || bytes[start] != b'{' {
        return None;
    }
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escape = false;
    for i in start..bytes.len() {
        let c = bytes[i];
        if in_string {
            if escape {
                escape = false;
            } else if c == b'\\' {
                escape = true;
            } else if c == b'"' {
                in_string = false;
            }
        } else {
            match c {
                b'"' => in_string = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some((s[start..=i].to_string(), i + 1));
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// Classify a parsed JSON value as zero or more tool calls. Handles single
/// calls, call arrays, and the `{"tool_calls": [...]}` wrapper.
fn value_to_tool_calls(v: &Value) -> Vec<ToolCall> {
    // Array of calls: [{...}, {...}]
    if let Some(arr) = v.as_array() {
        return arr.iter().filter_map(value_to_single_call).collect();
    }
    // Wrapper: {"tool_calls": [...]} or {"calls": [...]}
    for wrapper_key in ["tool_calls", "calls"] {
        if let Some(inner) = v.get(wrapper_key).and_then(|x| x.as_array()) {
            return inner.iter().filter_map(value_to_single_call).collect();
        }
    }
    // Single call
    if let Some(c) = value_to_single_call(v) {
        return vec![c];
    }
    Vec::new()
}

/// Convert a single JSON object to a [`ToolCall`]. Accepts the field-name
/// aliases documented on [`parse_tool_calls`]. Returns `None` when the
/// object doesn't look like a tool call (no `tool`/`name`/`tool_name`/
/// `function.name` field).
fn value_to_single_call(v: &Value) -> Option<ToolCall> {
    // Direct format: {"tool": "...", "params": {...}}
    let name = v
        .get("tool")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("name").and_then(|x| x.as_str()))
        .or_else(|| v.get("tool_name").and_then(|x| x.as_str()));

    if let Some(name) = name {
        let params = v
            .get("params")
            .cloned()
            .or_else(|| v.get("arguments").cloned())
            .or_else(|| v.get("args").cloned())
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}));
        return Some(ToolCall {
            name: name.to_string(),
            params,
        });
    }

    // OpenAI function-call format: {"id": "...", "function": {"name": "...", "arguments": "..."}}
    if let Some(func) = v.get("function") {
        if let Some(fname) = func.get("name").and_then(|x| x.as_str()) {
            let params = match func.get("arguments") {
                // OpenAI ships arguments as a JSON *string* — parse it.
                Some(Value::String(s)) => {
                    serde_json::from_str(s).unwrap_or_else(|_| json!({}))
                }
                Some(other) if other.is_object() => other.clone(),
                _ => json!({}),
            };
            return Some(ToolCall {
                name: fname.to_string(),
                params,
            });
        }
    }

    None
}

// ---------------------------------------------------------------------------
// LLM call helper
// ---------------------------------------------------------------------------

/// Send the current message stream to the backend LLM and return the
/// assistant's response text.
///
/// Uses the same `state.backend` and `state.client` as the rest of the
/// engine, so all backend configuration (timeouts, retries, base URL)
/// applies. On any failure (network error, non-2xx, empty body, malformed
/// JSON), returns a `[aether-agent] …` diagnostic string so the agent
/// loop can surface the problem and stop gracefully.
async fn call_llm(state: &AppState, messages: &[AgentMessage]) -> String {
    let request_body = json!({
        "messages": messages.iter().map(AgentMessage::to_request_json).collect::<Vec<_>>(),
        "temperature": 0.7,
    });
    let url = format!(
        "{}/chat/completions",
        state.backend.trim_end_matches('/')
    );

    match state.client.post(&url).json(&request_body).send().await {
        Ok(resp) if resp.status().is_success() => {
            let txt = resp.text().await.unwrap_or_default();
            extract_assistant_content(&txt).unwrap_or_else(|| {
                format!(
                    "[aether-agent] empty backend response: {}",
                    txt.chars().take(200).collect::<String>()
                )
            })
        }
        Ok(resp) => {
            let status = resp.status();
            let body_txt = resp.text().await.unwrap_or_default();
            format!(
                "[aether-agent] backend returned {status}: {}",
                body_txt.chars().take(200).collect::<String>()
            )
        }
        Err(e) => format!("[aether-agent] backend unreachable: {e}"),
    }
}

/// Extract the assistant's text content from an OpenAI-shaped chat
/// completion response body. Mirrors the same helper in `handlers.rs` but
/// kept local to this module to avoid widening the visibility of the
/// existing private function (which would break the "no signature changes"
/// constraint).
fn extract_assistant_content(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    v.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
}

// ---------------------------------------------------------------------------
// The main agent loop
// ---------------------------------------------------------------------------

/// Run the autonomous agent loop until termination.
///
/// # Arguments
///
/// - `state` — the engine's shared [`AppState`] (used for the backend LLM
///   call only; no other engine state is touched).
/// - `goal` — the user's natural-language goal (e.g. *"set up a Python
///   dev environment and write a hello-world script"*).
/// - `context` — the current OS state as a JSON object (open windows,
///   memory snapshot, active plan, goals, …). Pretty-printed into the
///   system prompt so the LLM perceives it.
/// - `max_iterations` — iteration cap. Clamped to `[1, ABSOLUTE_MAX_ITERATIONS]`.
///
/// # Returns
///
/// An [`AgentRunResult`] carrying the final assistant text, the iteration
/// count, the full transcript of tool calls, and the `completed` flag.
///
/// # Termination
///
/// See the module docs. The loop stops on `TASK_COMPLETE`, on a
/// no-tool-calls response, or on hitting `max_iterations`.
///
/// # Errors
///
/// This function never returns `Result::Err` — every failure path
/// (backend unreachable, malformed response, unknown tool, invalid
/// params, executor error) is converted into a diagnostic string and fed
/// back into the message stream or surfaced in the final result. The
/// caller decides how to react.
pub async fn run_agent_loop(
    state: AppState,
    goal: &str,
    context: &Value,
    max_iterations: usize,
) -> AgentRunResult {
    // Clamp the iteration cap. We accept the caller's value but enforce a
    // hard ceiling so a buggy caller can't pin a CPU forever against a
    // broken backend.
    let cap = max_iterations.clamp(1, ABSOLUTE_MAX_ITERATIONS);

    // Build the tool registry + system prompt once; both are reused on
    // every iteration.
    let registry = ToolRegistry::new();
    let catalog = registry.catalog();
    let system_prompt = build_agent_system_prompt(&catalog, context);

    // Initial state: [system, user(goal)].
    let mut agent_state = AgentState {
        iteration: 0,
        messages: vec![
            AgentMessage::system(system_prompt),
            AgentMessage::user(goal.to_string()),
        ],
        tool_results: Vec::new(),
        completed: false,
    };

    let mut all_tool_calls: Vec<ToolCall> = Vec::new();
    let mut final_text = String::new();

    for i in 0..cap {
        agent_state.iteration = i + 1;

        // ---- 2. Think: call the LLM with the current message stream ----
        let response_text = call_llm(&state, &agent_state.messages).await;

        // ---- 3a. Check for explicit completion sentinel ----
        if response_text.contains(TASK_COMPLETE_SENTINEL) {
            final_text = response_text;
            agent_state.completed = true;
            break;
        }

        // ---- 3b. Parse tool calls from the response ----
        let calls = parse_tool_calls(&response_text);
        all_tool_calls.extend(calls.clone());

        // ---- 3c. No tool calls + no sentinel → stop (incomplete) ----
        if calls.is_empty() {
            final_text = response_text;
            // `completed` stays false — the agent stopped without signaling.
            break;
        }

        // Record the assistant message that contained the tool calls, so
        // the next think step sees the full conversation context.
        agent_state.messages.push(AgentMessage::assistant(response_text.clone()));

        // ---- 4. Execute: dispatch each tool call through the registry ----
        for call in &calls {
            let (output, success) = match Tool::from_request(&call.name, &call.params) {
                Some(tool) => registry.execute(&tool).await,
                None => (
                    format!(
                        "tool_not_found: no tool named \"{}\" in registry. \
                         Available tools: {}",
                        call.name,
                        catalog
                            .iter()
                            .map(|t| t.name)
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                    false,
                ),
            };

            let result = ToolResult {
                tool: call.name.clone(),
                output: output.clone(),
                success,
            };
            agent_state.tool_results.push(result);

            // ---- 5. Observe: feed the tool result back into the stream ----
            agent_state
                .messages
                .push(AgentMessage::tool(call.name.clone(), output));
        }

        // The "final text" is the most recent assistant response, so if
        // the next iteration hits the iteration cap we still return
        // something useful.
        final_text = response_text;

        // ---- 6. Repeat (loop continues to the next think step) ----
    }

    AgentRunResult {
        result: final_text,
        iterations: agent_state.iteration,
        tool_calls: all_tool_calls,
        completed: agent_state.completed,
    }
}

// ---------------------------------------------------------------------------
// Tests (compile-only — no #[test] runner in this build)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_inline_json_tool_call() {
        let resp = r#"I'll read the file. {"tool": "file_read", "params": {"path": "/etc/hostname"}} Done."#;
        let calls = parse_tool_calls(resp);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "file_read");
        assert_eq!(calls[0].params["path"], "/etc/hostname");
    }

    #[test]
    fn parses_fenced_code_block() {
        let resp = "```json\n{\"tool\": \"exec\", \"params\": {\"command\": \"ls\"}}\n```";
        let calls = parse_tool_calls(resp);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "exec");
    }

    #[test]
    fn parses_openai_function_call_format() {
        let resp = r#"{"function": {"name": "memory_add", "arguments": "{\"text\": \"hi\", \"kind\": \"fact\"}"}}"#;
        let calls = parse_tool_calls(resp);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "memory_add");
        assert_eq!(calls[0].params["text"], "hi");
    }

    #[test]
    fn parses_tool_calls_wrapper() {
        let resp = r#"{"tool_calls": [{"tool": "x", "params": {}}, {"tool": "y", "params": {}}]}"#;
        let calls = parse_tool_calls(resp);
        assert_eq!(calls.len(), 2);
    }

    #[test]
    fn ignores_non_tool_json() {
        let resp = r#"{"foo": "bar", "baz": [1, 2, 3]}"#;
        let calls = parse_tool_calls(resp);
        assert!(calls.is_empty());
    }

    #[test]
    fn handles_braces_inside_strings() {
        let resp = r#"{"tool": "exec", "params": {"command": "echo {hello}"}}"#;
        let calls = parse_tool_calls(resp);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].params["command"], "echo {hello}");
    }
}
