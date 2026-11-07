// scripts/ensure-dirs.mjs
// ---------------------------------------------------------------
// Creates the runtime directories Alpha-N expects to exist. Runs on
// `npm install` (postinstall) and at dev/build startup so a fresh clone
// works without manual folder creation.
//
// Without this, the OS would throw "directory not found" the first time
// someone clones the repo and runs it — because models/, db/, etc. are
// gitignored (GGUFs and the SQLite DB are too big / machine-specific to
// commit). This script guarantees they exist, empty but present.
// ---------------------------------------------------------------
import { mkdir, access, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..");

const DIRS = ["models", "db", "logs"];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  for (const dir of DIRS) {
    const full = join(root, dir);
    await mkdir(full, { recursive: true });
    // Ensure models/ has a README so the folder is never "empty/confusing".
    if (dir === "models") {
      const readme = join(full, "README.md");
      if (!(await exists(readme))) {
        await writeFile(
          readme,
          [
            "# Alpha-N Models",
            "",
            "Drop your `.gguf` model files in this folder. They will be",
            "automatically detected by the Aether Engine and shown in the",
            "offline model picker (Model Settings → Aether).",
            "",
            "## Where to get a model",
            "- https://huggingface.co/models?other=gguf (search for 'gguf')",
            "- Recommended small models: Qwen2.5-1.5B, Llama-3.2-1B, Phi-3.5-mini",
            "- Format: GGUF, quantised (Q4_K_M or Q5_K_M for good speed/quality)",
            "",
            "After dropping a file here, restart the Aether Engine (or use",
            "reload_engine) and select it in Model Settings.",
          ].join("\n"),
          "utf8"
        );
      }
    }
  }
  console.log("[ensure-dirs] models/, db/, logs/ ready");
}

main().catch((err) => {
  // Non-fatal: the OS can still boot without these, it'll just create them
  // lazily. Don't fail the install over a directory.
  console.warn("[ensure-dirs] warning:", err.message);
});
