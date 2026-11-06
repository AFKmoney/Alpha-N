//! # Tools — OS-control tool definitions for the Aether agentic layer.
//!
//! This module defines the **tool surface** the autonomous agent can use to
//! perceive and manage a Linux-like OS. Each tool is:
//!
//! - a [`Tool`] enum variant (carries the parsed parameters),
//! - a [`ToolSpec`] entry in the [`ToolRegistry`] catalog (carries the
//!   name + description + JSON-Schema parameters used to advertise the tool
//!   to the LLM and to the `GET /v1/tools` introspection endpoint),
//! - a dispatch arm in [`ToolRegistry::execute`] (carries the placeholder
//!   executor).
//!
//! # Why placeholders?
//!
//! The Aether Engine runs as a Rust HTTP service; it does not itself touch
//! the filesystem, spawn shells, or open GUI windows. The actual OS
//! integration happens through the Next.js layer in Alpha-OS, which:
//!
//! 1. Calls `POST /v1/agent/run` to start the agentic loop,
//! 2. Receives the parsed [`ToolCall`](crate::agent::ToolCall)s back as JSON,
//! 3. Performs the real OS action (file IO, PTY exec, window manager
//!    mutation, graph memory add, …),
//! 4. Feeds the resulting observation back into the next agent iteration via
//!    the `context` field of the next `POST /v1/agent/run` call.
//!
//! The placeholder executors here return **canonical "what would happen"
//! responses** so the agent loop can be tested end-to-end (perceive → think
//! → act → observe) before the OS wiring is complete, and so the structure
//! of the tool registry is exercised by every iteration even when no real
//! side-effects are available.
//!
//! # Adding a new tool
//!
//! 1. Add a variant to [`Tool`] carrying its parsed parameters.
//! 2. Add a `(name, description, schema)` triple to
//!    [`ToolRegistry::catalog`].
//! 3. Add a dispatch arm to [`ToolRegistry::execute`] returning a
//!    placeholder result.
//! 4. Add a constructor arm to [`Tool::from_request`].

use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// Tool enum — one variant per available tool, carrying parsed params
// ---------------------------------------------------------------------------

/// A parsed tool call — the variant identifies *which* tool, and the fields
/// carry the validated parameters extracted from the LLM's JSON payload by
/// [`Tool::from_request`].
///
/// Variants are constructed only by [`Tool::from_request`]; the agent loop
/// never builds them directly. Unknown tool names or missing required
/// parameters yield `None`, which the agent loop surfaces as a
/// `tool_not_found` error message back to the LLM.
#[derive(Clone, Debug)]
pub enum Tool {
    /// Read a file from disk. Returns the file contents as a UTF-8 string.
    FileRead {
        /// Absolute or relative path of the file to read.
        path: String,
    },
    /// Write `content` to `path`, overwriting if the file already exists and
    /// creating it (including parent directories) if it does not.
    FileWrite {
        /// Path of the file to write.
        path: String,
        /// The full text content to write.
        content: String,
    },
    /// List the entries of a directory. Returns `{ name, is_dir }` per entry.
    FileList {
        /// Path of the directory to list.
        path: String,
    },
    /// Delete a file or directory. Directories are removed recursively.
    FileDelete {
        /// Path of the file or directory to delete.
        path: String,
    },
    /// Run a shell command in the user's default shell. Returns
    /// `{ stdout, stderr, exit_code }`.
    Exec {
        /// The full shell command line (interpreted by `/bin/bash -c`).
        command: String,
    },
    /// Open an application window in the Alpha-OS desktop.
    WindowOpen {
        /// App identifier (e.g. `"terminal"`, `"editor"`, `"browser"`).
        app: String,
    },
    /// Close an open application window by its id.
    WindowClose {
        /// The window id returned by `window_open` or listed in the OS state.
        window_id: String,
    },
    /// Add a memory to Akasha (the semantic memory graph). The memory
    /// becomes a new node and is automatically linked to its semantic
    /// neighbors.
    MemoryAdd {
        /// The memory text.
        text: String,
        /// Memory kind: `"fact"`, `"lesson"`, `"plan"`, `"goal"`,
        /// `"intention"`, `"log"`, or `"code"`.
        kind: String,
    },
    /// Search the semantic memory graph for memories matching `query`.
    /// Returns the top results with cosine-similarity scores.
    MemorySearch {
        /// The free-text query to search for.
        query: String,
    },
    /// Search the public web for `query`. Returns a list of result snippets
    /// with URLs.
    WebSearch {
        /// The search query.
        query: String,
    },
    /// Create a multi-step plan. The plan is stored and surfaced back to the
    /// agent on subsequent iterations as part of the OS state, so the agent
    /// can track its progress through the steps.
    PlanCreate {
        /// The high-level goal the plan achieves.
        goal: String,
        /// The ordered list of step descriptions.
        steps: Vec<String>,
    },
    /// Mark a step in the current plan as done. Steps are 0-indexed.
    PlanUpdate {
        /// The index of the step to mark as done.
        step_index: usize,
    },
}

impl Tool {
    /// Canonical name the LLM uses to reference this tool. Mirrors the
    /// `name` field in the corresponding [`ToolSpec`].
    pub fn name(&self) -> &'static str {
        match self {
            Tool::FileRead { .. } => "file_read",
            Tool::FileWrite { .. } => "file_write",
            Tool::FileList { .. } => "file_list",
            Tool::FileDelete { .. } => "file_delete",
            Tool::Exec { .. } => "exec",
            Tool::WindowOpen { .. } => "window_open",
            Tool::WindowClose { .. } => "window_close",
            Tool::MemoryAdd { .. } => "memory_add",
            Tool::MemorySearch { .. } => "memory_search",
            Tool::WebSearch { .. } => "web_search",
            Tool::PlanCreate { .. } => "plan_create",
            Tool::PlanUpdate { .. } => "plan_update",
        }
    }

    /// Human-readable description shown to the LLM in the system prompt and
    /// to clients via `GET /v1/tools`. Mirrors the `description` field in
    /// the corresponding [`ToolSpec`].
    pub fn description(&self) -> &'static str {
        match self {
            Tool::FileRead { .. } => "Read the full contents of a file from disk.",
            Tool::FileWrite { .. } => {
                "Write text content to a file, overwriting if present and creating \
                 parent directories as needed."
            }
            Tool::FileList { .. } => "List the entries of a directory.",
            Tool::FileDelete { .. } => {
                "Delete a file or directory (directories are removed recursively)."
            }
            Tool::Exec { .. } => {
                "Run a shell command in the user's default shell and return \
                 stdout, stderr, and exit code."
            }
            Tool::WindowOpen { .. } => "Open an application window on the OS desktop.",
            Tool::WindowClose { .. } => "Close an open application window by id.",
            Tool::MemoryAdd { .. } => {
                "Add a memory (fact/lesson/plan/goal/intention/log/code) to \
                 the Akasha semantic memory graph."
            }
            Tool::MemorySearch { .. } => {
                "Search the semantic memory graph for matching memories, \
                 ranked by cosine similarity."
            }
            Tool::WebSearch { .. } => "Search the public web for fresh information.",
            Tool::PlanCreate { .. } => {
                "Create a multi-step plan for a goal. The plan is persisted \
                 and surfaced back to the agent on subsequent iterations."
            }
            Tool::PlanUpdate { .. } => "Mark a step (0-indexed) in the current plan as done.",
        }
    }

    /// Construct a [`Tool`] from a `(name, params)` pair extracted from the
    /// LLM's tool-call payload by
    /// [`parse_tool_calls`](crate::agent::parse_tool_calls).
    ///
    /// Returns `None` when:
    /// - the tool name is unknown to the registry,
    /// - a required parameter is missing,
    /// - a parameter has the wrong JSON type.
    ///
    /// The agent loop converts `None` into a `tool_not_found` /
    /// `invalid_params` tool-result message so the LLM can self-correct on
    /// the next iteration.
    pub fn from_request(name: &str, params: &Value) -> Option<Self> {
        match name {
            "file_read" => {
                let path = params.get("path")?.as_str()?.to_string();
                Some(Tool::FileRead { path })
            }
            "file_write" => {
                let path = params.get("path")?.as_str()?.to_string();
                let content = params
                    .get("content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();
                Some(Tool::FileWrite { path, content })
            }
            "file_list" => {
                let path = params.get("path")?.as_str()?.to_string();
                Some(Tool::FileList { path })
            }
            "file_delete" => {
                let path = params.get("path")?.as_str()?.to_string();
                Some(Tool::FileDelete { path })
            }
            "exec" => {
                let command = params.get("command")?.as_str()?.to_string();
                Some(Tool::Exec { command })
            }
            "window_open" => {
                let app = params.get("app")?.as_str()?.to_string();
                Some(Tool::WindowOpen { app })
            }
            "window_close" => {
                let window_id = params.get("window_id")?.as_str()?.to_string();
                Some(Tool::WindowClose { window_id })
            }
            "memory_add" => {
                let text = params.get("text")?.as_str()?.to_string();
                let kind = params
                    .get("kind")
                    .and_then(|k| k.as_str())
                    .unwrap_or("fact")
                    .to_string();
                Some(Tool::MemoryAdd { text, kind })
            }
            "memory_search" => {
                let query = params.get("query")?.as_str()?.to_string();
                Some(Tool::MemorySearch { query })
            }
            "web_search" => {
                let query = params.get("query")?.as_str()?.to_string();
                Some(Tool::WebSearch { query })
            }
            "plan_create" => {
                let goal = params.get("goal")?.as_str()?.to_string();
                let steps = params
                    .get("steps")
                    .and_then(|s| s.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|s| s.as_str().map(|s| s.to_string()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                Some(Tool::PlanCreate { goal, steps })
            }
            "plan_update" => {
                let step_index = params.get("step_index")?.as_u64()? as usize;
                Some(Tool::PlanUpdate { step_index })
            }
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// ToolSpec — name + description + JSON-Schema parameters
// ---------------------------------------------------------------------------

/// A tool advertisement: name, description, and a JSON Schema describing
/// the tool's parameters. Returned by [`ToolRegistry::catalog`] for
/// injection into the agent system prompt and for the `GET /v1/tools`
/// introspection endpoint.
#[derive(Clone, Debug)]
pub struct ToolSpec {
    /// Canonical tool name (matches [`Tool::name`]).
    pub name: &'static str,
    /// Human-readable description (matches [`Tool::description`]).
    pub description: &'static str,
    /// JSON Schema (draft-07 subset) describing the tool's parameters.
    /// `type: "object"` with `properties` and `required` arrays.
    pub parameters: Value,
}

// ---------------------------------------------------------------------------
// ToolRegistry — catalog + dispatch
// ---------------------------------------------------------------------------

/// Stateless registry of all tools available to the autonomous agent.
///
/// Despite having no fields, this is a struct (not free functions) so that
/// future evolution (per-agent tool whitelisting, dynamic tool registration,
/// rate limits, capability scopes, …) has an obvious extension point. Today
/// every call to [`ToolRegistry::new`] returns an identical catalog.
///
/// # Example
///
/// ```ignore
/// use crate::tools::{Tool, ToolRegistry};
///
/// let registry = ToolRegistry::new();
/// let catalog = registry.catalog();
/// assert_eq!(catalog.len(), 12);
///
/// let params = serde_json::json!({ "path": "/etc/hostname" });
/// let tool = Tool::from_request("file_read", &params).unwrap();
/// let (output, success) = futures::executor::block_on(registry.execute(&tool));
/// assert!(success);
/// ```
pub struct ToolRegistry;

impl ToolRegistry {
    /// Construct a new registry. Today this is a no-op (the registry is
    /// stateless); the constructor exists for future extensibility.
    pub fn new() -> Self {
        Self
    }

    /// Return the full catalog of tools in a stable order. The order is
    /// preserved across calls so the system prompt and the introspection
    /// endpoint emit identical tool lists.
    ///
    /// The 12 tools cover: file IO (`file_read`, `file_write`, `file_list`,
    /// `file_delete`), shell (`exec`), window manager (`window_open`,
    /// `window_close`), memory/Akasha (`memory_add`, `memory_search`),
    /// external information (`web_search`), and planning (`plan_create`,
    /// `plan_update`).
    pub fn catalog(&self) -> Vec<ToolSpec> {
        vec![
            ToolSpec {
                name: "file_read",
                description: Tool::FileRead { path: String::new() }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute or relative path of the file to read."
                        }
                    },
                    "required": ["path"]
                }),
            },
            ToolSpec {
                name: "file_write",
                description: Tool::FileWrite { path: String::new(), content: String::new() }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path of the file to write."
                        },
                        "content": {
                            "type": "string",
                            "description": "The full text content to write."
                        }
                    },
                    "required": ["path", "content"]
                }),
            },
            ToolSpec {
                name: "file_list",
                description: Tool::FileList { path: String::new() }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path of the directory to list."
                        }
                    },
                    "required": ["path"]
                }),
            },
            ToolSpec {
                name: "file_delete",
                description: Tool::FileDelete { path: String::new() }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path of the file or directory to delete."
                        }
                    },
                    "required": ["path"]
                }),
            },
            ToolSpec {
                name: "exec",
                description: Tool::Exec { command: String::new() }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The full shell command line (run via `/bin/bash -c`)."
                        }
                    },
                    "required": ["command"]
                }),
            },
            ToolSpec {
                name: "window_open",
                description: Tool::WindowOpen { app: String::new() }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "app": {
                            "type": "string",
                            "description": "App identifier (e.g. \"terminal\", \"editor\", \"browser\")."
                        }
                    },
                    "required": ["app"]
                }),
            },
            ToolSpec {
                name: "window_close",
                description: Tool::WindowClose { window_id: String::new() }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "window_id": {
                            "type": "string",
                            "description": "The id of the window to close."
                        }
                    },
                    "required": ["window_id"]
                }),
            },
            ToolSpec {
                name: "memory_add",
                description: Tool::MemoryAdd { text: String::new(), kind: String::new() }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "The memory text to store."
                        },
                        "kind": {
                            "type": "string",
                            "enum": ["fact", "lesson", "plan", "goal", "intention", "log", "code"],
                            "description": "Memory kind. Defaults to \"fact\"."
                        }
                    },
                    "required": ["text"]
                }),
            },
            ToolSpec {
                name: "memory_search",
                description: Tool::MemorySearch { query: String::new() }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The free-text query to search memories for."
                        }
                    },
                    "required": ["query"]
                }),
            },
            ToolSpec {
                name: "web_search",
                description: Tool::WebSearch { query: String::new() }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The web search query."
                        }
                    },
                    "required": ["query"]
                }),
            },
            ToolSpec {
                name: "plan_create",
                description: Tool::PlanCreate { goal: String::new(), steps: Vec::new() }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "goal": {
                            "type": "string",
                            "description": "The high-level goal the plan achieves."
                        },
                        "steps": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Ordered list of step descriptions."
                        }
                    },
                    "required": ["goal", "steps"]
                }),
            },
            ToolSpec {
                name: "plan_update",
                description: Tool::PlanUpdate { step_index: 0 }.description(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "step_index": {
                            "type": "integer",
                            "minimum": 0,
                            "description": "0-indexed step to mark as done."
                        }
                    },
                    "required": ["step_index"]
                }),
            },
        ]
    }

    /// Execute a parsed [`Tool`].
    ///
    /// Returns `(output, success)` where:
    /// - `output` is a human/LLM-readable string describing the result,
    /// - `success` is `true` when the tool "succeeded" (placeholder logic;
    ///   see the module docs for why real OS integration happens via the
    ///   Next.js layer).
    ///
    /// Placeholder behavior:
    ///
    /// - File/shell/window/web tools always succeed and return a canonical
    ///   `[<tool> placeholder] would <action>: <params>` string. The Next.js
    ///   layer intercepts these and performs the real side-effect.
    /// - Memory tools (`memory_add`, `memory_search`) and plan tools
    ///   (`plan_create`, `plan_update`) also return placeholders — the
    ///   Next.js layer is responsible for POSTing to `/graph/add` /
    ///   `/graph/search` and updating the plan store respectively.
    ///
    /// This split keeps the tool registry self-contained (no `AppState`
    /// dependency, no async I/O for files, no PTY plumbing) while still
    /// exercising the full agent loop end-to-end.
    pub async fn execute(&self, tool: &Tool) -> (String, bool) {
        match tool {
            Tool::FileRead { path } => (
                format!(
                    "[file_read placeholder] would read file at \"{path}\" and return its contents."
                ),
                true,
            ),
            Tool::FileWrite { path, content } => (
                format!(
                    "[file_write placeholder] would write {} byte(s) to \"{path}\".",
                    content.len()
                ),
                true,
            ),
            Tool::FileList { path } => (
                format!(
                    "[file_list placeholder] would list the directory entries of \"{path}\"."
                ),
                true,
            ),
            Tool::FileDelete { path } => (
                format!(
                    "[file_delete placeholder] would delete the file or directory at \"{path}\"."
                ),
                true,
            ),
            Tool::Exec { command } => (
                format!(
                    "[exec placeholder] would run shell command: `{command}`"
                ),
                true,
            ),
            Tool::WindowOpen { app } => (
                format!(
                    "[window_open placeholder] would open the \"{app}\" application window."
                ),
                true,
            ),
            Tool::WindowClose { window_id } => (
                format!(
                    "[window_close placeholder] would close window \"{window_id}\"."
                ),
                true,
            ),
            Tool::MemoryAdd { text, kind } => (
                format!(
                    "[memory_add placeholder] would add a \"{kind}\" memory to Akasha: {}",
                    truncate(text, 200)
                ),
                true,
            ),
            Tool::MemorySearch { query } => (
                format!(
                    "[memory_search placeholder] would search the semantic memory graph for: {}",
                    truncate(query, 200)
                ),
                true,
            ),
            Tool::WebSearch { query } => (
                format!(
                    "[web_search placeholder] would search the web for: {}",
                    truncate(query, 200)
                ),
                true,
            ),
            Tool::PlanCreate { goal, steps } => (
                format!(
                    "[plan_create placeholder] would create a {}-step plan for goal: {}\n  - {}",
                    steps.len(),
                    truncate(goal, 200),
                    steps
                        .iter()
                        .map(|s| truncate(s, 100))
                        .collect::<Vec<_>>()
                        .join("\n  - ")
                ),
                true,
            ),
            Tool::PlanUpdate { step_index } => (
                format!(
                    "[plan_update placeholder] would mark plan step #{step_index} as done."
                ),
                true,
            ),
        }
    }
}

impl Default for ToolRegistry {
    /// Default instance with the standard 12-tool catalog.
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Truncate `s` to at most `max` characters, appending an ellipsis when
/// truncation occurs. Used to keep placeholder tool outputs short enough
/// to fit comfortably inside the LLM's context window across many
/// iterations.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max).collect();
        format!("{truncated}…")
    }
}
