# Aether Engine — Native GGUF Inference Build Guide

The Aether Engine (`mini-services/aether-engine/`) runs GGUF models **natively
in-process** via `llama-cpp-2` (Rust bindings to llama.cpp). This makes the OS
self-sufficient: drop a `.gguf` in `models/`, build the engine, and the AI
generates text with no Ollama, no cloud, no external server.

> **Why this doc exists.** llama.cpp's official build targets MSVC on Windows.
> Alpha-N uses the MinGW (`windows-gnu`) toolchain, so the upstream
> `llama-cpp-sys-2` build script fails out of the box. This guide documents
> the exact environment + patches that make it build.

## Prerequisites (Windows)

Install these once (winget or manual):

| Tool | Purpose | Install |
|------|---------|---------|
| **Rust** (stable, windows-gnu) | Compiler | `winget install Rustlang.Rustup` then `rustup default stable-x86_64-pc-windows-gnu` |
| **LLVM** (libclang.dll) | bindgen (generates Rust↔C bindings) | `winget install LLVM.LLVM` |
| **CMake** | Compiles llama.cpp's C++ | `winget install Kitware.CMake` |
| **MSYS2 + mingw-w64** | gcc/g++ (the actual C++ compiler) | https://www.msys2.org/ then `pacman -S mingw-w64-x86_64-gcc` |

Verify: `gcc --version`, `cmake --version`, and `libclang.dll` exists under
`C:\Program Files\LLVM\bin\`.

## Build environment

Set these before every `cargo build` of the Aether (a `.env.local` or shell
snippet works):

```powershell
# Toolchain + headers so bindgen can find stdbool.h etc.
$env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"
$env:BINDGEN_EXTRA_CLANG_ARGS = "--target=x86_64-pc-windows-gnu -isystem C:/msys64/mingw64/include -isystem C:/msys64/mingw64/lib/gcc/x86_64-w64-mingw32/15.2.0/include"
$env:PATH = "C:\Program Files\CMake\bin;C:\msys64\mingw64\bin;C:\Program Files\LLVM\bin;" + $env:PATH
```

And a `.cargo/config.toml` in the engine crate to point at MinGW's gcc and link
`advapi32` (registry API used by ggml-cpu):

```toml
[target.x86_64-pc-windows-gnu]
linker = "C:/msys64/mingw64/bin/x86_64-w64-mingw32-gcc.exe"
ar = "C:/msys64/mingw64/bin/ar.exe"
rustflags = ["-C", "link-args=-ladvapi32"]

[env]
CC_x86_64_pc_windows_gnu = "C:/msys64/mingw64/bin/gcc.exe"
CXX_x86_64_pc_windows_gnu = "C:/msys64/mingw64/bin/g++.exe"
```

## The 6 patches (applied to `llama-cpp-sys-2` in the cargo registry)

The upstream build script assumes MSVC. Under MinGW it needs these patches.
**`scripts/patch-llama-cpp.ps1`** applies the C-source patches (1 & 2)
reproducibly. The `build.rs` patches (3–6) are documented below and should be
applied manually to `…/llama-cpp-sys-2-0.1.150/build.rs` until upstreamed:

1. **httplib.cpp** — `CreateFile2` (Win8+, missing in MinGW) → `CreateFileW`.
2. **httplib.h** — force `#define _WIN32_WINNT 0x0A00` before the version check
   (MinGW defaults lower; httplib hard-errors otherwise).
3. **build.rs** — forward `LLAMA_*` / `GGML_*` env vars to CMake (so
   `LLAMA_BUILD_COMMON=OFF` etc. work).
4. **build.rs** — use `*.a` (not `*.lib`) as the lib glob for `windows-gnu`.
5. **build.rs** — add a `read_dir` fallback when `glob()` returns nothing on
   Windows wildcard paths.
6. **build.rs** — rewrite `extract_lib_names` to filter archives explicitly.

## First build

```powershell
# 1. cargo fetch so the registry sources exist
cd mini-services/aether-engine
cargo fetch
# 2. apply the C-source patches (idempotent)
powershell -File ../../scripts/patch-llama-cpp.ps1
# 3. apply the build.rs patches manually (see above) OR keep a patched copy
# 4. build (5–15 min the first time — compiles all of llama.cpp)
cargo build --release
```

The first build downloads and compiles llama.cpp's C++ (~3000 files). It is
slow but cached afterward.

## Running

Drop a `.gguf` in `models/` (e.g. `Agent.Nano.Coder-Q5_K_M.gguf`), then:

```powershell
cargo run --release
# → [aether-engine] native model detected: models/Agent.Nano.Coder-Q5_K_M.gguf
# → [aether-engine] ✓ native engine online
# → [aether-engine] v3.0 listening on :3004
```

The OS's `model-config.ts` probes `localhost:3004` at boot and routes
inference there automatically. If no GGUF is present, the engine falls back to
the `AETHER_BACKEND` URL (default Ollama).

## Model selection

- Default: the first `.gguf` found in `models/`.
- Override: `AETHER_MODEL=/absolute/path/to/model.gguf`.

## Troubleshooting

- **`CreateFile2 has not been declared`** → re-run `patch-llama-cpp.ps1`.
- **`0 libs` panic in build.rs** → you hit an unpatched build.rs; apply patches
  4–6, then `cargo clean && cargo build`.
- **`undefined reference to __imp_RegOpenKeyExA`** → add `-ladvapi32` to
  rustflags (see config.toml above).
- **bindgen `stdbool.h not found`** → `BINDGEN_EXTRA_CLANG_ARGS` is missing the
  mingw include paths.
- **build is slow** → normal. First compile builds all of llama.cpp. Subsequent
  builds are incremental.
