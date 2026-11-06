#!/usr/bin/env python3
"""Cross-verification: every call into the rebuilt modules from the three
recovered files must match an implementation signature in the new sources."""

import re, sys

SRC = "/home/z/my-project/mini-services/aether-engine/src/"

def read(name):
    with open(SRC + name, encoding="utf-8") as f:
        return f.read()

new_files = ["main.rs", "graph.rs", "tfidf.rs", "cache.rs", "compress.rs",
             "decompose.rs", "hcm.rs", "clt.rs", "atd.rs", "dashboard.rs", "engine.rs"]
recovered = ["handlers.rs", "agent.rs", "tools.rs"]

new_src = {n: read(n) for n in new_files}
all_new = "\n".join(new_src.values())
rec_src = {n: read(n) for n in recovered}
all_rec = "\n".join(rec_src.values())

failures = []
def check(name, pattern, where, flags=0):
    if re.search(pattern, where, flags):
        print(f"  OK   {name}")
    else:
        failures.append(name)
        print(f"  FAIL {name}")

print("== graph.rs API (called from handlers.rs) ==")
g = new_src["graph.rs"]
check("pub struct AddNodeRequest", r"pub struct AddNodeRequest", g)
check("pub struct ScoredNode", r"pub struct ScoredNode", g)
check("pub struct MemoryNode", r"pub struct MemoryNode", g)
check("pub struct MemoryGraph", r"pub struct MemoryGraph", g)
for f in ["id", "text", "kind", "metadata"]:
    check(f"AddNodeRequest field {f}", rf"pub {f}:", g)
# AddNodeRequest must have EXACTLY 4 fields (struct literal in handlers)
m = re.search(r"pub struct AddNodeRequest \{([^}]*)\}", g, re.S)
fields = re.findall(r"pub (\w+):", m.group(1))
if sorted(fields) == sorted(["id", "text", "kind", "metadata"]):
    print(f"  OK   AddNodeRequest has exactly 4 fields: {fields}")
else:
    failures.append("AddNodeRequest field set")
    print(f"  FAIL AddNodeRequest fields: {fields}")
for f in ["nodes", "adjacency", "vectorizer"]:
    check(f"MemoryGraph pub field {f}", rf"pub {f}:", g)
check("fn len(&self) -> usize", r"pub fn len\(&self\) -> usize", g)
check("fn edge_count(&self)", r"pub fn edge_count\(&self\) -> usize", g)
check("fn add(&mut self, req: AddNodeRequest) -> usize",
      r"pub fn add\(&mut self, req: AddNodeRequest\) -> usize", g)
check("fn to_response(&self) -> Value", r"pub fn to_response\(&self\) -> (serde_json::)?Value", g)
check("fn search(&self, query: &str, limit: usize) -> Vec<ScoredNode>",
      r"pub fn search\(&self, query: &str, limit: usize\) -> Vec<ScoredNode>", g)
check("fn retrieve(&self, query: &str, top_k: usize) -> Vec<ScoredNode>",
      r"pub fn retrieve\(&self, query: &str, top_k: usize\) -> Vec<ScoredNode>", g)
check("fn clear(&mut self)", r"pub fn clear\(&mut self\)", g)
check("nodes: HashMap<String, MemoryNode>", r"pub nodes: HashMap<String, MemoryNode>", g)
check("adjacency: HashMap<String, Vec<String>>", r"pub adjacency: HashMap<String, Vec<String>>", g)
check("MemoryNode pub text: String", r"pub text: String", g)
# to_response must produce "nodes" and "edges" keys
check('to_response emits "nodes" + "edges"', r'"nodes"', g)
check('to_response emits "edges"', r'"edges"', g)

print("== tfidf.rs API ==")
t = new_src["tfidf.rs"]
check("pub struct SparseVec", r"pub struct SparseVec", t)
check("pub fn tokenize", r"pub fn tokenize\(text: &str\) -> Vec<String>", t)
check("pub struct TfIdfVectorizer", r"pub struct TfIdfVectorizer", t)
check("fn vectorize(&self, text: &str) -> SparseVec",
      r"pub fn vectorize\(&self, text: &str\) -> SparseVec", t)
check("fn cosine(&self, other: &SparseVec) -> f64",
      r"pub fn cosine\(&self, other: &SparseVec\) -> f64", t)
check("sklearn idf formula", r"ln\(\(1\.0 \+ self\.doc_count as f64\) / \(1\.0 \+ df\)\)\.ln\(\) \+ 1\.0|/\(1\.0 \+ df\)\)\.ln\(\) \+ 1\.0", t)
check("shorter-vector iteration in dot", r"if self\.terms\.len\(\) <= other\.terms\.len\(\)", t)

print("== cache.rs API ==")
c = new_src["cache.rs"]
check("pub struct ActionCache", r"pub struct ActionCache", c)
check("fn get(&self, query: &str, vector: &SparseVec) -> Option<(String, f64)>",
      r"pub fn get\(&self, query: &str, vector: &SparseVec\) -> Option<\(String, f64\)>", c)
check("fn put(&mut self, query: &str, vector: SparseVec, response: String)",
      r"pub fn put\(&mut self, query: &str, vector: SparseVec, response: String\)", c)
check("fn get_retrieval(&self, ...) -> Option<String>",
      r"pub fn get_retrieval\(&self, query: &str, vector: &SparseVec\) -> Option<String>", c)
check("fn put_retrieval(&mut self, query: &str, vector: SparseVec, context: String)",
      r"pub fn put_retrieval\(&mut self, query: &str, vector: SparseVec, context: String\)", c)
check("fn len(&self) -> usize", r"pub fn len\(&self\) -> usize", c)
check("fn clear(&mut self)", r"pub fn clear\(&mut self\)", c)
check("ACTION_SIMILARITY_THRESHOLD = 0.95", r"ACTION_SIMILARITY_THRESHOLD: f64 = 0\.95", c)
check("RETRIEVAL_SIMILARITY_THRESHOLD = 0.92", r"RETRIEVAL_SIMILARITY_THRESHOLD: f64 = 0\.92", c)
check("action_len()", r"pub fn action_len\(&self\) -> usize", c)
check("retrieval_len()", r"pub fn retrieval_len\(&self\) -> usize", c)

print("== compress.rs API ==")
cp = new_src["compress.rs"]
check("pub fn compress(nodes: &[ScoredNode], query: &str, budget: usize) -> String",
      r"pub fn compress\(nodes: &\[ScoredNode\], query: &str, budget: usize\) -> String", cp)

print("== decompose.rs API ==")
d = new_src["decompose.rs"]
check("pub enum Complexity {Simple, Moderate, Complex}",
      r"pub enum Complexity \{[^}]*Simple[^}]*Moderate[^}]*Complex", d, re.S)
check("pub struct SubQuestion", r"pub struct SubQuestion", d)
check("SubQuestion pub id: String", r"pub id: String", d)
check("pub struct PipelineState", r"pub struct PipelineState", d)
for f in ["complexity", "stages_completed", "sub_questions", "synthesis",
          "verification_passed", "total_backend_calls", "total_latency_ms"]:
    check(f"PipelineState pub field {f}", rf"pub {f}:", d)
check("pub fn new(query: &str) -> Self (PipelineState)",
      r"impl PipelineState \{[\s\S]*?pub fn new\(query: &str\) -> Self", d)
check("pub fn analyze_complexity(query: &str) -> Complexity",
      r"pub fn analyze_complexity\(query: &str\) -> Complexity", d)
check("pub fn decompose(query: &str, retrieved: &[ScoredNode]) -> Vec<SubQuestion>",
      r"pub fn decompose\(query: &str, retrieved: &\[ScoredNode\]\) -> Vec<SubQuestion>", d)
check("pub fn build_sub_prompt(sub: &SubQuestion, answers: &HashMap<String, String>) -> String",
      r"pub fn build_sub_prompt\(\s*sub: &SubQuestion,\s*answers: &HashMap<String, String>,?\s*\) -> String", d)
check("pub struct DistillationStore", r"pub struct DistillationStore", d)
check("fn len(&self) -> usize (DistillationStore)",
      r"impl DistillationStore \{[\s\S]*?pub fn len\(&self\) -> usize", d)
check("fn store(&mut self, query: &str, vector: SparseVec, sub_questions: Vec<SubQuestion>)",
      r"pub fn store\(&mut self, query: &str, vector: SparseVec, sub_questions: Vec<SubQuestion>\)", d)
check("fn find(&self, query: &str, vector: &SparseVec) -> Option<Vec<SubQuestion>>",
      r"pub fn find\(&self, query: &str, vector: &SparseVec\) -> Option<Vec<SubQuestion>>", d)
# 4 strategies
strategies = re.findall(r"^\s{4}(\w+),", re.search(r"pub enum Strategy \{(.*?)\}", d, re.S).group(1), re.M)
if len(strategies) == 4:
    print(f"  OK   4 strategies: {strategies}")
else:
    failures.append("4 strategies")
    print(f"  FAIL strategies: {strategies}")

print("== hcm.rs API ==")
h = new_src["hcm.rs"]
check("pub fn hash_to_vector(text: &str, dim: usize) -> Vec<f64>",
      r"pub fn hash_to_vector\(text: &str, dim: usize\) -> Vec<f64>", h)
check("pub struct Hcm", r"pub struct Hcm", h)
check("pub dim: usize", r"pub dim: usize", h)
check("pub pair_count: usize", r"pub pair_count: usize", h)
check("fn fold(&mut self, key: &[f64], value: &[f64])",
      r"pub fn fold\(&mut self, key: &\[f64\], value: &\[f64\]\)", h)
check("fn interference(&self) -> f64", r"pub fn interference\(&self\) -> f64", h)
check("fn memory_bytes(&self) -> usize", r"pub fn memory_bytes\(&self\) -> usize", h)
check("fn capacity(&self) -> usize", r"pub fn capacity\(&self\) -> usize", h)
check("FFT butterfly present", r"fn fft_butterfly", h)

print("== clt.rs API (unused-by-design) ==")
cl = new_src["clt.rs"]
for fn in ["verify_response", "adjusted_temperature", "check_convergence",
           "should_continue", "build_iteration_prompt", "extract_latent_state"]:
    check(f"pub fn {fn}", rf"pub fn {fn}\(", cl)
check("#![allow(dead_code)]", r"#!\[allow\(dead_code\)\]", cl)

print("== atd.rs API ==")
a = new_src["atd.rs"]
check("pub struct ATDConfig", r"pub struct ATDConfig", a)
check("impl Default for ATDConfig", r"impl Default for ATDConfig", a)
check("pub enum ATDRecommendation", r"pub enum ATDRecommendation", a)
check("FallBackToSimpleShot variant", r"FallBackToSimpleShot", a)
check("pub struct ATDResult", r"pub struct ATDResult", a)
for f in ["validated", "likelihood", "entropy", "collision_delta", "recommendation"]:
    check(f"ATDResult pub field {f}", rf"pub {f}:", a)
check("pub fn verify(response: &str, query: &str, config: &ATDConfig) -> ATDResult",
      r"pub fn verify\(response: &str, query: &str, config: &ATDConfig\) -> ATDResult", a)

print("== dashboard.rs API ==")
db = new_src["dashboard.rs"]
check("pub struct DashboardData", r"pub struct DashboardData", db)
m = re.search(r"pub struct DashboardData \{([^}]*)\}", db, re.S)
dfields = re.findall(r"pub (\w+):", m.group(1))
expected = ["engine_name", "version", "uptime_seconds", "node_count", "edge_count",
            "cache_size", "decompositions", "atd_verdicts", "hcm_state_bytes",
            "hcm_pairs", "hcm_capacity", "requests", "cache_hits"]
if sorted(dfields) == sorted(expected) and len(dfields) == 13:
    print(f"  OK   DashboardData has exactly the 13 required fields")
else:
    failures.append("DashboardData fields")
    print(f"  FAIL DashboardData fields: {dfields} vs {expected}")
check("pub fn render_dashboard(data: &DashboardData) -> String",
      r"pub fn render_dashboard\(data: &DashboardData\) -> String", db)
check("pub fn uptime_seconds() -> u64", r"pub fn uptime_seconds\(\) -> u64", db)
check("OnceLock<Instant>", r"OnceLock<Instant>", db)
for helper in ["fn write_html", "fn write_card", "fn format_bytes", "fn esc"]:
    check(f"private helper {helper}", helper, db)
check("{{ escaping used in writeln!", r"writeln!\([^)]*\{\{", db)
for color in ["#0a0a0f", "#a78bfa", "#22d3ee", "#131318", "#27272a"]:
    check(f"design token {color}", color, db)
check("monospace stack", r"SF Mono.*JetBrains Mono.*Fira Code.*Consolas", db)

print("== engine.rs API ==")
e = new_src["engine.rs"]
check("pub struct NativeEngine", r"pub struct NativeEngine", e)
check("pub fn load(context_size: u32) -> Result<Self, String>",
      r"pub fn load\(context_size: u32\) -> Result<Self, String>", e)
check("pub fn find_model_path() -> Option<PathBuf>",
      r"pub fn find_model_path\(\) -> Option<PathBuf>", e)
check("pub fn apply_messages(&self, messages: &Value) -> Result<String, String>",
      r"pub fn apply_messages\(&self, messages: &Value\) -> Result<String, String>", e)
check("pub fn complete(&self, prompt: &str, max_tokens: u32) -> Result<String, String>",
      r"pub fn complete\(&self, prompt: &str, max_tokens: u32\) -> Result<String, String>", e)

print("== main.rs: AppState, Stats, router ==")
mn = new_src["main.rs"]
check("pub struct AppState", r"pub struct AppState", mn)
check("pub struct Stats", r"pub struct Stats", mn)
stats_fields = re.findall(r"pub (\w+): u64", re.search(r"pub struct Stats \{([^}]*)\}", mn, re.S).group(1))
expected_stats = ["requests", "cache_hits", "decompositions", "verifications",
                  "verifications_passed", "distillation_hits", "hcm_pairs_folded",
                  "hcm_probes", "clt_loops", "clt_convergences", "clt_total_steps",
                  "atd_verifications", "atd_validated", "atd_rejected"]
if sorted(stats_fields) == sorted(expected_stats) and len(stats_fields) == 14:
    print("  OK   Stats has all 14 counters")
else:
    failures.append("Stats fields")
    print(f"  FAIL Stats fields: {sorted(stats_fields)}")
for f in ["graph", "cache", "stats", "distillation", "hcm", "native_engine", "backend", "client", "token"]:
    check(f"AppState pub field {f}", rf"pub {f}:", mn)
check("AppState derives Clone", r"#\[derive\(Clone\)\]\s*\npub struct AppState", mn)
check("native_engine double-Arc-tokio-Mutex type",
      r"pub native_engine:\s*\n?\s*Arc<tokio::sync::Mutex<Option<Arc<tokio::sync::Mutex<NativeEngine>>>>>", mn)
check("const PORT: u16 = 3004", r"const PORT: u16 = 3004;", mn)

# Every route named in handlers.rs doc comments must be wired in main.rs
routes_expected = [
    ("/health", "health"), ("/pipeline", "pipeline_stats"),
    ("/graph/add", "graph_add"), ("/graph", "graph_get"),
    ("/graph/search", "graph_search"), ("/graph/clear", "graph_clear"),
    ("/v1/interrupt", "interrupt"), ("/v1/chat/completions", "chat_completions"),
    ("/v1/chat/stream", "chat_completions_stream"), ("/dashboard", "dashboard"),
    ("/metrics", "prometheus_metrics"), ("/graph/export", "graph_export"),
    ("/graph/import", "graph_import"), ("/config", "get_config"),
    ("/admin/reload", "admin_reload"), ("/v1/models", "list_models"),
    ("/graph/stats", "graph_stats"), ("/v1/agent/run", "agent_run"),
    ("/v1/tools", "list_tools"),
    # additional worklog routes
    ("/cache/stats", "cache_stats"), ("/cache/clear", "cache_clear"),
    ("/cache/prefetch", "cache_prefetch"), ("/decompose", "decompose_query"),
    ("/hcm/stats", "hcm_stats"), ("/hcm/save", "hcm_save"),
    ("/hcm/load", "hcm_load"), ("/atd/verify", "atd_verify"),
]
for path, handler in routes_expected:
    check(f"route {path} -> {handler}", rf'route\("{path}", (?:get|post)\((?:handlers::)?{handler}\)\)', mn)

# every pub async fn in handlers.rs must be wired
pub_handlers = re.findall(r"pub async fn (\w+)", rec_src["handlers.rs"])
wired = set(re.findall(r'(?:handlers::)?(\w+)\)\)', mn))
for ph in set(pub_handlers):
    check(f"handler {ph} wired in router", ph, mn)

print("== mod statements ==")
for mod in ["agent", "atd", "cache", "clt", "compress", "dashboard", "decompose",
            "engine", "graph", "handlers", "hcm", "tfidf", "tools"]:
    check(f"mod {mod};", rf"^mod {mod};", mn, re.M)

print()
print(f"RESULT: {len(failures)} failures" + (f": {failures}" if failures else " — ALL CHECKS PASSED"))
sys.exit(1 if failures else 0)
