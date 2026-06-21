# Alpha-N Documentation

Start here. These docs explain how the system fits together and how to keep
it healthy.

## Index

| Document | What it covers |
|----------|----------------|
| [**ARCHITECTURE.md**](../ARCHITECTURE.md) | The big picture: the OODA loop, trust levels, state stores, the Aether engine, and how data flows. **Read this first.** |
| [**MUTATIONS.md**](MUTATIONS.md) | Every mutation the AI can emit, what it does, and under which trust level it's allowed. The contract between the LLM prompt and the code. |
| [**AETHER_NATIVE_BUILD.md**](AETHER_NATIVE_BUILD.md) | How to build the native GGUF inference engine (Rust + llama.cpp) on Windows-MinGW, including the required patches. |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Architecture invariants you must never break, how to add capabilities/apps, commit conventions. |
| [../CHANGELOG.md](../CHANGELOG.md) | Release history. |

## Quick orientation

**New to the codebase?** Read ARCHITECTURE.md, then open
`src/components/alpha/autonomous-loop.tsx` and follow one cycle through.

**Adding an AI capability?** MUTATIONS.md lists the steps; CONTRIBUTING.md has
the invariants.

**Building the engine?** AETHER_NATIVE_BUILD.md is the only doc you need.

**Just want it to run?** The top-level README.md has the quick start.

## Key source locations

```
src/lib/alpha/
  autonomy-policy.ts     ← the trust dial (sandbox/moderate/yolo)
  mutations.ts           ← the mutation language (AI↔OS contract)
  evolution-store.ts     ← the mind (agents, memory, plans, metrics)
  os-store.ts            ← the desktop (windows, layout, security)
  reward-model.ts        ← objective reward from verifiable outcomes
  learning-engine.ts     ← turns the reward trail into lessons
  model-config.ts        ← cloud/Aether routing + fallback
  paths.ts               ← cross-platform path resolution (traversal-proof)

src/app/api/alpha/
  think/route.ts         ← the LLM call + prompt assembly
  exec/route.ts          ← sandboxed code execution
  files/route.ts         ← project file access
  reload-engine/route.ts ← hot-swap the model

mini-services/aether-engine/
  src/engine.rs          ← NativeEngine (load GGUF, decode, sample)
  src/handlers.rs        ← HTTP endpoints (chat, reload, health)
```
