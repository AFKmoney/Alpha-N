/**
 * Alpha-OS Terminal Service — Bun Launcher
 * -----------------------------------------
 * `bun --hot index.ts` runs THIS file. It spawns the actual service
 * (worker.ts) under NODE via tsx, and restarts it whenever source files
 * change.
 *
 * Why a two-runtime launcher?
 *   node-pty is a native PTY module. With bun, bash spawned through
 *   node-pty dies with SIGHUP within ~1s (bun closes the PTY master fd
 *   prematurely — confirmed: node works, bun doesn't). The task requires
 *   a TRUE PTY so vim/top/htop/python REPL all work, which the
 *   child_process fallback cannot provide. So we keep `bun --hot` as the
 *   dev entrypoint (per spec) but delegate the service runtime to node,
 *   where node-pty works correctly.
 *
 *   `bun --hot` provides auto-restart on index.ts changes; this launcher
 *   additionally watches worker.ts (and other .ts files) and restarts
 *   the node child on change — so editing worker.ts hot-reloads.
 */

import { spawn, type ChildProcess } from 'child_process'
import { watch } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKER = resolve(__dirname, 'worker.ts')

// `bun --hot` re-evaluates this module on index.ts changes. We must NOT
// spawn a second node child or register a second watcher. Guard with a
// global flag so only the first evaluation sets up.
const g = globalThis as unknown as {
  __alphaTerminalLaunched?: boolean
  __alphaTerminalChild?: ChildProcess | null
  __alphaTerminalRestartTimer?: NodeJS.Timeout | null
  __alphaTerminalShuttingDown?: boolean
  __alphaTerminalWatcher?: ReturnType<typeof watch> | null
}

function spawnWorker() {
  if (g.__alphaTerminalShuttingDown) return
  console.log('[launcher] spawning node + tsx worker.ts')
  const child = spawn('node', ['--import', 'tsx', WORKER], {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Ensure the worker inherits a clean NODE_ENV.
      NODE_ENV: process.env.NODE_ENV ?? 'development',
    },
  })
  g.__alphaTerminalChild = child

  child.on('exit', (code, signal) => {
    console.log(`[launcher] worker exited code=${code} signal=${signal}`)
    g.__alphaTerminalChild = null
    if (!g.__alphaTerminalShuttingDown) {
      // Auto-restart on crash after a short backoff.
      setTimeout(spawnWorker, 400)
    }
  })

  child.on('error', (err) => {
    console.error('[launcher] worker spawn error:', err)
  })
}

function scheduleRestart(reason: string) {
  if (g.__alphaTerminalRestartTimer) return
  g.__alphaTerminalRestartTimer = setTimeout(() => {
    g.__alphaTerminalRestartTimer = null
    const child = g.__alphaTerminalChild
    if (child) {
      console.log(`[launcher] ${reason} — restarting worker`)
      child.kill('SIGTERM')
      // The exit handler above will respawn.
    } else {
      spawnWorker()
    }
  }, 150)
}

function shutdown(sig: string) {
  if (g.__alphaTerminalShuttingDown) return
  g.__alphaTerminalShuttingDown = true
  console.log(`[launcher] ${sig} — killing worker and exiting`)
  const child = g.__alphaTerminalChild
  if (child) {
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      process.exit(0)
    }, 800)
  } else {
    process.exit(0)
  }
}

if (!g.__alphaTerminalLaunched) {
  g.__alphaTerminalLaunched = true
  g.__alphaTerminalShuttingDown = false

  console.log('[launcher] Alpha-OS Terminal Service')
  console.log(`[launcher] dev script: bun --hot index.ts`)
  console.log(`[launcher] worker:    node --import tsx worker.ts`)
  console.log(`[launcher] watching:  ${__dirname}/*.ts (excluding index.ts)`)

  // Watch for source changes (auto-restart the worker).
  // index.ts changes are handled by `bun --hot` itself (which re-evaluates
  // this module — but the global guard prevents duplicate spawns).
  g.__alphaTerminalWatcher = watch(
    __dirname,
    { recursive: true },
    (_event, filename) => {
      if (!filename) return
      // Only watch .ts files in this directory.
      if (!filename.endsWith('.ts')) return
      if (filename === 'index.ts') return
      if (filename.startsWith('_')) return
      if (filename.includes('node_modules')) return
      if (filename.startsWith('.')) return
      scheduleRestart(`source changed: ${filename}`)
    }
  )

  spawnWorker()

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
