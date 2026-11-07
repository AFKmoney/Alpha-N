@echo off
REM ============================================================
REM start-aether.bat — launch the native GGUF inference engine.
REM
REM The Aether Engine must be running on port 3004 for the OS's
REM offline AI mode to work. Run this BEFORE `npm run dev` (or in
REM a second terminal). It loads the first .gguf found in models/.
REM
REM If you haven't built the engine yet, see
REM   docs\AETHER_NATIVE_BUILD.md
REM ============================================================
setlocal
cd /d "%~dp0"

set "AETHER=mini-services\aether-engine\target\release\aether-engine.exe"

if not exist "%AETHER%" (
  echo [start-aether] Engine binary not found at %AETHER%
  echo [start-aether] You need to build it first. See docs\AETHER_NATIVE_BUILD.md
  echo [start-aether] Quick: cd mini-services\aether-engine ^&^& cargo build --release
  exit /b 1
)

echo [start-aether] launching native inference engine...
"%AETHER%"
endlocal
