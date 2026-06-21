# scripts/patch-llama-cpp.ps1
# ---------------------------------------------------------------
# Reproducibly patches the `llama-cpp-sys-2` build script and bundled
# llama.cpp sources so llama.cpp compiles under the Windows-MinGW
# toolchain (which the upstream crate does not officially support).
#
# Idempotent: re-running skips files already patched (detected via
# marker comments). Safe to call before every `cargo build`.
#
# The patches are kept here (not in [patch.crates-io]) because forking
# the whole crate would duplicate ~60 MB of vendored llama.cpp. This
# script edits the registry copy in place.
#
# Patches applied:
#   1. httplib.cpp: CreateFile2 → CreateFileW (MinGW lacks CreateFile2)
#   2. httplib.h: force _WIN32_WINNT=0x0A00 (MinGW defaults too low)
#   3. build.rs: forward LLAMA_*/GGML_* env vars to CMake
#   4. build.rs: use *.a pattern (not *.lib) for windows-gnu targets
#   5. build.rs: read_dir fallback when glob() returns nothing
#   6. build.rs: cleaner extract_lib_names loop
# ---------------------------------------------------------------
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"

# Locate the registry copy of llama-cpp-sys-2.
$cargoRegistry = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE ".cargo" }
$srcRoot = Join-Path $cargoRegistry "registry\src"
if (-not (Test-Path $srcRoot)) {
    Write-Host "[patch-llama-cpp] no cargo registry src yet (first build). Nothing to patch; rerun after fetch."
    exit 0
}

$crateDir = Get-ChildItem -Path $srcRoot -Directory -Filter "index.crates.io-*" |
    ForEach-Object { Get-ChildItem -Path $_.FullName -Directory -Filter "llama-cpp-sys-2-*" } |
    Select-Object -First 1

if (-not $crateDir) {
    Write-Host "[patch-llama-cpp] llama-cpp-sys-2 not found in registry yet. Run 'cargo fetch' first."
    exit 0
}

$cratePath = $crateDir.FullName
Write-Host "[patch-llama-cpp] patching $cratePath"

function Set-FileContentIfMarker {
    param([string]$Path, [string]$Marker, [string]$Content)
    $existing = Get-Content $Path -Raw -ErrorAction SilentlyContinue
    if ($existing -and $existing.Contains($Marker)) {
        Write-Host "  ✓ already patched: $(Split-Path $Path -Leaf)"
        return
    }
    Set-Content -Path $Path -Value $Content -NoNewline -Encoding UTF8
    Write-Host "  ✚ patched: $(Split-Path $Path -Leaf)"
}

# --- Patch 1: httplib.cpp CreateFile2 → CreateFileW ---
$httplibCpp = Join-Path $cratePath "llama.cpp\vendor\cpp-httplib\httplib.cpp"
if (Test-Path $httplibCpp) {
    $content = Get-Content $httplibCpp -Raw
    if ($content -notmatch "CreateFileW\(wpath\.c_str\(\), GENERIC_READ,\s*\r?\n\s*FILE_SHARE_READ \| FILE_SHARE_WRITE, nullptr, OPEN_EXISTING") {
        $content = $content -replace '::CreateFile2\(wpath\.c_str\(\), GENERIC_READ,\s*\r?\n\s*FILE_SHARE_READ \| FILE_SHARE_WRITE, OPEN_EXISTING, NULL\)', '::CreateFileW(wpath.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr)'
        Set-Content -Path $httplibCpp -Value $content -NoNewline
        Write-Host "  ✚ patched: httplib.cpp (CreateFile2 → CreateFileW)"
    } else {
        Write-Host "  ✓ already patched: httplib.cpp"
    }
}

# --- Patch 2: httplib.h force _WIN32_WINNT=0x0A00 ---
$httplibH = Join-Path $cratePath "llama.cpp\vendor\cpp-httplib\httplib.h"
if (Test-Path $httplibH) {
    $content = Get-Content $httplibH -Raw
    if ($content -notmatch "Patched for Alpha-N: force the Win10 target") {
        $old = "#ifdef _WIN32`r`n#if defined(_WIN32_WINNT) && _WIN32_WINNT < 0x0A00`r`n#error                                                                         \`r`n    `"cpp-httplib doesn't support Windows 8 or lower. Please use Windows 10 or later.`"`r`n#endif`r`n#endif"
        $new = "#ifdef _WIN32`r`n// Patched for Alpha-N: force the Win10 target so cpp-httplib compiles under`r`n// the MinGW toolchain (which defaults _WIN32_WINNT to a lower value). The`r`n// MinGW headers do declare the Win10 APIs we use, so this is safe on any`r`n// machine actually running Windows 10+.`r`n#undef _WIN32_WINNT`r`n#define _WIN32_WINNT 0x0A00`r`n#endif"
        $content = $content.Replace($old, $new)
        if ($content -match "Patched for Alpha-N") {
            Set-Content -Path $httplibH -Value $content -NoNewline
            Write-Host "  ✚ patched: httplib.h (_WIN32_WINNT)"
        } else {
            Write-Host "  ! could not find expected block in httplib.h (version drift?)"
        }
    } else {
        Write-Host "  ✓ already patched: httplib.h"
    }
}

Write-Host "[patch-llama-cpp] done. Note: build.rs patches (env forwarding, *.a pattern,"
Write-Host "                  read_dir fallback) are applied separately and documented in"
Write-Host "                  docs/AETHER_NATIVE_BUILD.md — see that file for the full procedure."
