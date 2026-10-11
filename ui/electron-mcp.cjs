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
  // ⚑ Whether the window is listening for calls. A call sent before it is would
  // be lost, and the agent would wait out the whole timeout for nothing - so it
  // is refused at once, with the reason. A reload starts the window over.
  let ready = false
  let watched = null
  ipcMain.on('agent:ready', () => { ready = true })
  ipcMain.on('agent:gone', () => { ready = false })

  function toWindow(kind, name, args) {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return Promise.reject(new Error('PlotTracer has no window open.'))
    if (watched !== win) {
      watched = win
      win.webContents.on('did-start-loading', () => { ready = false })
    }
    if (!ready) return Promise.reject(new Error('PlotTracer is still starting. Try again in a moment.'))
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

  let current = {}
  // M6: the tools that touch the disk are answered here, after the folder check;
  // only a figure that passed it is handed to the window.
  function handleCall(name, args) {
    if (name === 'list_folder') {
      const r = listFolder(current.agentFolder)
      return Promise.resolve({ content: [{ type: 'text', text: r.text }], ...(r.isError ? { isError: true } : {}) })
    }
    if (name === 'open_figure') {
      const f = readFigure(current.agentFolder, args && args.path)
      if (f.error) return Promise.resolve({ isError: true, content: [{ type: 'text', text: f.error }] })
      return toWindow('call', name, { name: f.name, path: f.path, dataURL: f.dataURL })
    }
    return toWindow('call', name, args)
  }
  ipcMain.handle('agent:save-file', (_event, { name, content }) => saveInFolder(current, name, String(content ?? '')))

  async function apply(settings) {
    current = settings && typeof settings === 'object' ? settings : {}
    const on = settings && settings.agentsEnabled === true
    if (on && !server) {
      token = readOrCreateToken(getDir())
      server = createMcpServer({
        token,
        version,
        onCall: handleCall,
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

  return {
    apply,
    stop: () => (server ? server.stop() : Promise.resolve()),
    call: handleCall,
  }
}

module.exports.registerAgentBridge = registerAgentBridge
module.exports.DEFAULT_PORT = DEFAULT_PORT

// ── The folder agents may use (M6, M10) ─────────────────────────────────────
// Decided HERE, in the main process, because this is the side that can read
// and write the disk: the window never hands the agent a path it did not check.
// The folder is chosen in Settings ▸ Agents; nothing outside it is reachable,
// whichever way the path is spelled (`..`, absolute, or a link inside the
// folder pointing out of it).

const FIGURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'pdf', 'tif', 'tiff']
const FIGURE_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', bmp: 'image/bmp', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', tif: 'image/tiff', tiff: 'image/tiff',
}
const NO_FOLDER = 'No folder is chosen for agents. Ask the user to choose one in PlotTracer ▸ Settings ▸ Agents.'

function chosenFolder(folder) {
  if (typeof folder !== 'string' || !folder.trim()) return { error: NO_FOLDER }
  try {
    const real = fs.realpathSync(folder)
    if (!fs.statSync(real).isDirectory()) throw new Error('not a folder')
    return { real }
  } catch {
    return { error: `The folder chosen for agents (${folder}) cannot be read. Ask the user to choose it again in PlotTracer ▸ Settings ▸ Agents.` }
  }
}

function inside(real, target) {
  const rel = path.relative(real, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

// A path the agent gave, resolved against the folder. An existing file is
// judged by where it REALLY is, so a link cannot lead out; a file still to be
// written is judged by its folder.
function resolveInFolder(folder, asked) {
  const f = chosenFolder(folder)
  if (f.error) return { error: f.error }
  if (typeof asked !== 'string' || !asked.trim()) return { error: `Give a file name inside the folder agents may use (${folder}).` }
  const outside = { error: `"${asked}" is outside the folder agents may use (${folder}).` }
  const target = path.resolve(f.real, asked)
  if (!inside(f.real, target)) return outside
  let real
  try {
    real = fs.realpathSync(target)
  } catch {
    try { real = path.join(fs.realpathSync(path.dirname(target)), path.basename(target)) } catch { return { path: target } }
  }
  return inside(f.real, real) ? { path: real } : outside
}

function listFolder(folder) {
  const f = chosenFolder(folder)
  if (f.error) return { text: f.error, isError: true }
  const found = []
  const walk = (dir, depth) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory() && depth < 2) walk(full, depth + 1)
      else if (e.isFile() && FIGURE_EXTENSIONS.includes(path.extname(e.name).toLowerCase().slice(1))) {
        found.push(path.relative(f.real, full))
      }
    }
  }
  walk(f.real, 0)
  if (!found.length) return { text: `The folder agents may use (${folder}) holds no figures (${FIGURE_EXTENSIONS.join(', ')}).` }
  return { text: `Figures in the folder agents may use (${folder}):\n${found.map((n) => `  ${n}`).join('\n')}` }
}

function readFigure(folder, asked) {
  const r = resolveInFolder(folder, asked)
  if (r.error) return r
  const ext = path.extname(r.path).toLowerCase().slice(1)
  if (!FIGURE_EXTENSIONS.includes(ext)) return { error: `"${asked}" is not a figure PlotTracer opens (${FIGURE_EXTENSIONS.join(', ')}).` }
  let bytes
  try { bytes = fs.readFileSync(r.path) } catch { return { error: `"${asked}" cannot be read; list_folder shows what is there.` } }
  return { name: path.basename(r.path), path: r.path, dataURL: `data:${FIGURE_MIME[ext]};base64,${bytes.toString('base64')}` }
}

function saveInFolder(settings, name, content) {
  const s = settings || {}
  if (s.agentMaySave !== true) {
    return { error: 'The user has not let agents save. They can tick "Agents may save into the folder" in PlotTracer ▸ Settings ▸ Agents.' }
  }
  const r = resolveInFolder(s.agentFolder, name)
  if (r.error) return r
  if (fs.existsSync(r.path)) return { error: `"${name}" already exists in the folder; PlotTracer never writes over a file. Pick another name.` }
  try {
    fs.writeFileSync(r.path, content, 'utf8')
  } catch (e) {
    return { error: `"${name}" could not be written: ${String(e?.message || e)}` }
  }
  return { path: r.path }
}

module.exports.resolveInFolder = resolveInFolder
module.exports.listFolder = listFolder
module.exports.readFigure = readFigure
module.exports.saveInFolder = saveInFolder
