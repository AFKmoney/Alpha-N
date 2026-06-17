/**
 * Alpha-OS Terminal Service — Worker
 * ----------------------------------
 * The actual socket.io + node-pty service. Runs under NODE (not bun),
 * spawned by index.ts. We use node here because bun's runtime is
 * incompatible with node-pty: bun closes the PTY master fd prematurely,
 * causing bash to receive SIGHUP and exit within ~1s of spawn. Node
 * runs node-pty correctly, giving us a true interactive PTY (vim, top,
 * htop, python REPL, etc. all work).
 *
 * Port: 3003 (hardcoded).
 * socket.io path: "/" (required by the Caddy gateway — see /Caddyfile).
 * Client connects with: io("/?XTransformPort=3003", { transports: ["websocket"] })
 */

import { createServer } from 'http'
import { Server, type Socket } from 'socket.io'
import * as pty from 'node-pty'

// ---------------------------------------------------------------------------
// Configuration (hardcoded — no env)
// ---------------------------------------------------------------------------
const PORT = 3003
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const DEFAULT_CWD = '/home/z/my-project'
const SHELL = '/bin/bash'
const TERM_ENV = 'xterm-256color'

// ---------------------------------------------------------------------------
// Terminal session
// ---------------------------------------------------------------------------
interface TermSession {
  readonly backend: 'pty'
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): () => void
  onExit(cb: (exitCode: number) => void): () => void
}

function createPtySession(cols: number, rows: number): TermSession {
  const term = pty.spawn(SHELL, [], {
    name: TERM_ENV,
    cols,
    rows,
    cwd: DEFAULT_CWD,
    env: { ...process.env, TERM: TERM_ENV } as Record<string, string>,
  })

  return {
    backend: 'pty',
    pid: term.pid,
    write: (d) => {
      try {
        term.write(d)
      } catch {
        /* EPIPE / closed — ignore */
      }
    },
    resize: (c, r) => {
      try {
        term.resize(c, r)
      } catch {
        /* ignore */
      }
    },
    kill: () => {
      try {
        term.kill()
      } catch {
        /* ignore */
      }
    },
    onData: (cb) => {
      const l = term.onData(cb)
      return () => {
        try {
          l.dispose()
        } catch {
          /* ignore */
        }
      }
    },
    onExit: (cb) => {
      const l = term.onExit(({ exitCode }) => cb(exitCode ?? 0))
      return () => {
        try {
          l.dispose()
        } catch {
          /* ignore */
        }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// HTTP + socket.io server
// ---------------------------------------------------------------------------
const httpServer = createServer((req, res) => {
  // Minimal health probe so `curl http://localhost:3003/health` returns JSON.
  // NOTE: because the socket.io path is "/", socket.io intercepts most GETs
  // at "/". The /health endpoint only responds for non-socket.io requests
  // (rare direct hits). Use lsof -i:3003 or the socket.io handshake to
  // verify the service.
  if (req.url && req.url.startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        service: 'alpha-terminal-service',
        port: PORT,
        backend: 'pty',
        uptime: process.uptime(),
        sockets: sockets.size,
      })
    )
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('alpha-terminal-service\n')
})

const io = new Server(httpServer, {
  // IMPORTANT: the Caddy gateway requires the socket.io path to be "/".
  // DO NOT change it — it is used by the gateway to route to the right port
  // based on the XTransformPort query param.
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Per-socket session state
interface SocketState {
  session: TermSession | null
  detachFns: Array<() => void>
  cols: number
  rows: number
  dead: boolean
}

const sockets = new Map<string, SocketState>()

function spawnForSocket(socket: Socket, state: SocketState) {
  // Tear down any previous session (e.g. after terminal:kill).
  if (state.session) {
    try {
      state.session.kill()
    } catch {
      /* ignore */
    }
    for (const detach of state.detachFns) {
      try {
        detach()
      } catch {
        /* ignore */
      }
    }
    state.detachFns = []
    state.session = null
  }

  let session: TermSession
  try {
    session = createPtySession(state.cols, state.rows)
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    console.error(`[terminal:${socket.id}] PTY spawn failed:`, msg)
    socket.emit('terminal:error', { message: `spawn failed: ${msg}` })
    // Retry once after a short delay.
    setTimeout(() => {
      if (state.dead) return
      try {
        const s2 = createPtySession(state.cols, state.rows)
        attachSession(socket, state, s2)
      } catch (e2) {
        socket.emit('terminal:error', {
          message: `spawn retry failed: ${(e2 as Error)?.message ?? e2}`,
        })
      }
    }, 500)
    return
  }

  attachSession(socket, state, session)
}

function attachSession(socket: Socket, state: SocketState, session: TermSession) {
  state.session = session

  const offData = session.onData((data) => {
    if (state.dead) return
    socket.emit('terminal:output', { data })
  })

  const offExit = session.onExit((code) => {
    if (state.dead) return
    socket.emit('terminal:exited', { code })
    // Auto-respawn a fresh shell after exit so the client gets a working terminal again.
    setTimeout(() => {
      if (state.dead) return
      spawnForSocket(socket, state)
      socket.emit('terminal:ready', { backend: session.backend })
    }, 300)
  })

  state.detachFns.push(offData, offExit)

  socket.emit('terminal:ready', { backend: session.backend })
  console.log(
    `[terminal:${socket.id}] spawned pty shell (pid=${session.pid}, ${state.cols}x${state.rows})`
  )
}

io.on('connection', (socket: Socket) => {
  const state: SocketState = {
    session: null,
    detachFns: [],
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    dead: false,
  }
  sockets.set(socket.id, state)
  console.log(`[terminal:${socket.id}] connected`)

  spawnForSocket(socket, state)

  socket.on('terminal:input', (payload: { data: string } | string) => {
    const s = state.session
    if (!s) return
    const data = typeof payload === 'string' ? payload : payload?.data
    if (typeof data !== 'string') return
    s.write(data)
  })

  socket.on('terminal:resize', (payload: { cols: number; rows: number }) => {
    const cols = Math.max(1, Math.min(1024, Number(payload?.cols) | 0))
    const rows = Math.max(1, Math.min(1024, Number(payload?.rows) | 0))
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
    state.cols = cols
    state.rows = rows
    if (state.session) {
      state.session.resize(cols, rows)
    }
  })

  socket.on('terminal:kill', () => {
    console.log(`[terminal:${socket.id}] kill — respawning fresh shell`)
    spawnForSocket(socket, state)
  })

  socket.on('error', (err) => {
    console.error(`[terminal:${socket.id}] socket error:`, err)
  })

  socket.on('disconnect', (reason) => {
    state.dead = true
    console.log(`[terminal:${socket.id}] disconnected (${reason}) — killing shell`)
    if (state.session) {
      try {
        state.session.kill()
      } catch {
        /* ignore */
      }
    }
    for (const detach of state.detachFns) {
      try {
        detach()
      } catch {
        /* ignore */
      }
    }
    state.detachFns = []
    state.session = null
    sockets.delete(socket.id)
  })
})

// Top-level error guards — never crash the worker.
process.on('uncaughtException', (err) => {
  console.error('[terminal] uncaughtException:', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[terminal] unhandledRejection:', err)
})

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[terminal] received ${signal}, shutting down...`)
  for (const [id, state] of sockets) {
    state.dead = true
    if (state.session) {
      try {
        state.session.kill()
      } catch {
        /* ignore */
      }
    }
    try {
      io.sockets.sockets.get(id)?.disconnect(true)
    } catch {
      /* ignore */
    }
  }
  io.close(() => {
    httpServer.close(() => {
      console.log('[terminal] closed.')
      process.exit(0)
    })
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

httpServer.listen(PORT, () => {
  console.log(`Terminal service on :${PORT}`)
  console.log(`  backend: node-pty (full PTY — vim/top/htop/python REPL supported)`)
  console.log(`  shell:   ${SHELL}`)
  console.log(`  cwd:     ${DEFAULT_CWD}`)
  console.log(`  cols x rows: ${DEFAULT_COLS}x${DEFAULT_ROWS}`)
  console.log(`  socket.io path: "/"   (Caddy gateway: /?XTransformPort=${PORT})`)
  console.log(`  node:    ${process.version}    tsx-loaded worker.ts`)
})
