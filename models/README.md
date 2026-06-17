# Alpha-OS Models

Drop your `.gguf` model files in this folder. They will be automatically detected by the Aether Engine.

## How it works
1. Place a `.gguf` file here (e.g. `llama3.2-3b-q4_k_m.gguf`)
2. Open Alpha-OS → Model Settings → select "Aether"
3. Your model appears in the model picker
4. Select it — the Aether Engine loads it and uses it for inference with graph-augmented context

## Supported formats
- Any GGUF file (llama.cpp format)
- Works with: Llama, Mistral, Qwen, Phi, Gemma, and any GGUF-compatible model
