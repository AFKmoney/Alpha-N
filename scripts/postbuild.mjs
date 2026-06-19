// Cross-platform post-build step: copies the static assets and public
// folder into the standalone server directory. The original package.json
// used bash `cp -r` which only worked on Linux.
import { cp, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..");

const standaloneDir = join(root, ".next", "standalone");
const staticSrc = join(root, ".next", "static");
const staticDst = join(standaloneDir, ".next", "static");
const publicSrc = join(root, "public");
const publicDst = join(standaloneDir, "public");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(standaloneDir))) {
    console.log("[postbuild] no standalone dir — skipping (dev build?)");
    return;
  }
  if (await exists(staticSrc)) {
    await mkdir(staticDst, { recursive: true });
    await cp(staticSrc, staticDst, { recursive: true });
    console.log("[postbuild] copied .next/static -> standalone");
  }
  if (await exists(publicSrc)) {
    await mkdir(publicDst, { recursive: true });
    await cp(publicSrc, publicDst, { recursive: true });
    console.log("[postbuild] copied public -> standalone");
  }
}

main().catch((err) => {
  console.error("[postbuild] failed:", err);
  process.exit(0); // non-fatal — build still succeeded
});
