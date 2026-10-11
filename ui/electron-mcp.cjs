// PlotTracer as an MCP server (v2.7, docs/v2.7-mcp-cases.md), in the main
// process, so an agent drives the window the user is looking at.
//
// ⚑ Written on node's own `http` rather than the MCP SDK: the server needs
// three requests (initialize, tools/list, tools/call), and the SDK brings an
// HTTP framework and a schema library whose absence would show only in the
// packaged app. The transport is the specification's Streamable HTTP, answered
// with plain JSON, never a stream.
//
// ⚑ What this file decides is WHO may talk (M1-M3): this computer only, the
// token, no web page, no foreign host name, one agent at a time. WHAT a tool
// does is the window's business - every call is handed to `onCall`, which the
// renderer answers through the same model a click goes through.
'use strict'

const http = require('http')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const TOKEN_FILE = 'agent-token'
const HOST = '127.0.0.1'
const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const MAX_BODY = 1024 * 1024

const INSTRUCTIONS = [
  'PlotTracer extracts data from figures. You work in the window the user is looking at; every step you take appears on screen.',
  'The user picks the graph type and calibrates the figure themselves. Until they have, tools that add or change data are refused - ask the user to calibrate in PlotTracer, then call get_state.',
  'Call get_state first to see where the work stands, and view_figure to see the figure.',
].join(' ')

// The token is made once and kept beside the settings, so a configuration the
// user pasted into an agent client keeps working across restarts.
function readOrCreateToken(dir) {
  const file = path.join(dir, TOKEN_FILE)
  try {
    const t = fs.readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{48}$/.test(t)) return t
  } catch { /* none yet */ }
  const t = crypto.randomBytes(24).toString('hex')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, t, { encoding: 'utf8', mode: 0o600 })
  return t
}

function sameToken(given, token) {
  const a = Buffer.from(given || '')
  const b = Buffer.from(token)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// An Origin, when a client sends one at all, must be this computer: a web page
// in a browser always sends its own, and that is the request to refuse.
function originAllowed(origin) {
  if (!origin) return true
  try {
    const host = new URL(origin).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
  } catch {
    return false
  }
}

// DNS rebinding: a page on attacker.example re-pointed at 127.0.0.1 still says
// `Host: attacker.example`.
function hostAllowed(hostHeader, port) {
  return hostHeader === `${HOST}:${port}` || hostHeader === `localhost:${port}`
}

function createMcpServer({ token, version, onCall, listTools, onStatus }) {
  let server = null
  let port = null
  let error = null
  let session = null // { id, name, since }
  let blocked = false

  const status = () => ({
    listening: server !== null && server.listening,
    port,
    client: session ? { name: session.name, since: session.since } : null,
    blocked,
    error,
  })
  const changed = () => { if (onStatus) onStatus(status()) }

  function send(res, code, body, headers = {}) {
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    res.writeHead(code, {
      'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
      ...headers,
    })
    res.end(text)
  }
  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

  async function handleRpc(msg, res) {
    const { id, method, params } = msg
    if (method === 'initialize') {
      const name = String(params?.clientInfo?.name || 'an agent')
      if (blocked) {
        return send(res, 403, 'Disconnected in PlotTracer. The user has to press "Let it reconnect" before an agent can connect again.')
      }
      if (session && session.name !== name) {
        return send(res, 409, `Another agent (${session.name}) is connected to PlotTracer. The user can disconnect it there.`)
      }
      // the same client starting over replaces its own stale session
      session = { id: crypto.randomUUID(), name, since: Date.now() }
      changed()
      const asked = params?.protocolVersion
      return send(res, 200, {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'plottracer', version },
          instructions: INSTRUCTIONS,
        },
      }, { 'mcp-session-id': session.id })
    }
    if (id === undefined) return send(res, 202) // a notification
    if (method === 'ping') return send(res, 200, { jsonrpc: '2.0', id, result: {} })
    if (method === 'tools/list') {
      return send(res, 200, { jsonrpc: '2.0', id, result: { tools: await listTools() } })
    }
    if (method === 'tools/call') {
      try {
        const result = await onCall(String(params?.name), params?.arguments ?? {})
        return send(res, 200, { jsonrpc: '2.0', id, result })
      } catch (e) {
        return send(res, 200, { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: String(e?.message || e) }] } })
      }
    }
    return send(res, 200, rpcError(id, -32601, `PlotTracer has no method "${method}".`))
  }

  function handle(req, res) {
    if (req.url !== '/mcp' && !req.url.startsWith('/mcp?')) return send(res, 404, 'Not found')
    if (!hostAllowed(req.headers.host, port)) return send(res, 403, 'Wrong host')
    if (!originAllowed(req.headers.origin)) return send(res, 403, 'Requests from web pages are refused')
    const auth = req.headers.authorization || ''
    if (!auth.startsWith('Bearer ') || !sameToken(auth.slice(7), token)) {
      return send(res, 401, 'The token is missing or wrong. Copy the configuration from PlotTracer ▸ Settings.', { 'www-authenticate': 'Bearer' })
    }
    if (req.method === 'DELETE') {
      if (session && req.headers['mcp-session-id'] === session.id) { session = null; changed() }
      return send(res, 200, '')
    }
    if (req.method !== 'POST') return send(res, 405, 'Only POST', { allow: 'POST, DELETE' })

    let body = ''
    let tooBig = false
    req.on('data', (c) => {
      body += c
      if (body.length > MAX_BODY) { tooBig = true; req.destroy() }
    })
    req.on('end', () => {
      if (tooBig) return
      let msg
      try { msg = JSON.parse(body) } catch { return send(res, 400, rpcError(null, -32700, 'Not JSON')) }
      if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
        return send(res, 400, rpcError(null, -32600, 'One JSON-RPC message per request'))
      }
      if (msg.method !== 'initialize') {
        const sid = req.headers['mcp-session-id']
        if (!sid) return send(res, 400, rpcError(msg.id, -32000, 'No session: call initialize first'))
        if (!session || sid !== session.id) return send(res, 404, rpcError(msg.id, -32001, 'This session has ended'))
      }
      handleRpc(msg, res).catch((e) => send(res, 500, rpcError(msg.id, -32603, String(e?.message || e))))
    })
  }

  return {
    start(wantPort) {
      if (server) return Promise.resolve()
      error = null
      return new Promise((resolve) => {
        const s = http.createServer(handle)
        s.on('error', (e) => {
          error = e && e.code === 'EADDRINUSE'
            ? `Port ${wantPort} is already in use on this computer, so agents cannot connect.`
            : String(e?.message || e)
          server = null
          port = null
          changed()
          resolve()
        })
        s.listen(wantPort, HOST, () => {
          server = s
          port = s.address().port
          changed()
          resolve()
        })
      })
    },
    stop() {
      const s = server
      server = null
      port = null
      session = null
      blocked = false
      if (!s) { changed(); return Promise.resolve() }
      return new Promise((resolve) => {
        s.close(() => { changed(); resolve() })
        s.closeAllConnections?.()
      })
    },
    status,
    address: () => (server ? server.address().address : null),
    disconnect() {
      session = null
      blocked = true
      changed()
    },
    allowReconnect() {
      blocked = false
      changed()
    },
  }
}

module.exports = { createMcpServer, readOrCreateToken, TOKEN_FILE, HOST }

// ── The bridge to the window ────────────────────────────────────────────────
// The server is on while the Settings switch *Let agents use PlotTracer* is on
// (S13, M1), read from the same settings file the renderer writes. A tool call
// is handed to the window and answered there; a window that does not answer in
// time gives the agent a reason rather than a call that never returns.

const DEFAULT_PORT = 47821
const CALL_TIMEOUT_MS = 120000

function registerAgentBridge(ipcMain, getDir, getMainWindow, version) {
  const port = Number(process.env.PLOTTRACER_MCP_PORT) || DEFAULT_PORT
  let token = null
  let server = null
  let nextCall = 1
  const pending = new Map()

  function toWindow(kind, name, args) {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return Promise.reject(new Error('PlotTracer has no window open.'))
    const callId = nextCall++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(callId)
        reject(new Error('PlotTracer did not answer in time. Call get_state to see where it stands.'))
      }, CALL_TIMEOUT_MS)
      pending.set(callId, { resolve, reject, timer })
      win.webContents.send('agent:call', { callId, kind, name, args })
    })
  }
  ipcMain.on('agent:result', (_event, { callId, result, error }) => {
    const p = pending.get(callId)
    if (!p) return
    pending.delete(callId)
    clearTimeout(p.timer)
    if (error) p.reject(new Error(error))
    else p.resolve(result)
  })

  function fullStatus() {
    const s = server ? server.status() : { listening: false, port: null, client: null, blocked: false, error: null }
    return { ...s, enabled: server !== null, token: server ? token : null, host: HOST, wantPort: port }
  }
  function pushStatus() {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('agent:status', fullStatus())
  }

  async function apply(settings) {
    const on = settings && settings.agentsEnabled === true
    if (on && !server) {
      token = readOrCreateToken(getDir())
      server = createMcpServer({
        token,
        version,
        onCall: (name, args) => toWindow('call', name, args),
        listTools: () => toWindow('list'),
        onStatus: pushStatus,
      })
      await server.start(port)
    } else if (!on && server) {
      const s = server
      server = null
      await s.stop()
    }
    pushStatus()
  }

  ipcMain.handle('agent:get-status', () => fullStatus())
  ipcMain.handle('agent:disconnect', () => { server?.disconnect(); return fullStatus() })
  ipcMain.handle('agent:allow-reconnect', () => { server?.allowReconnect(); return fullStatus() })

  return { apply, stop: () => (server ? server.stop() : Promise.resolve()) }
}

module.exports.registerAgentBridge = registerAgentBridge
module.exports.DEFAULT_PORT = DEFAULT_PORT
