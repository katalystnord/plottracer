import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// electron-mcp.cjs is the main-process MCP server (v2.7, docs/v2.7-mcp-cases.md).
// It is plain node `http`, handed its token and its tool handler, so the
// connecting cases run here without launching Electron.
const require = createRequire(import.meta.url);
const { createMcpServer, readOrCreateToken, TOKEN_FILE } = require('../electron-mcp.cjs') as {
  createMcpServer: (opts: {
    token: string;
    version: string;
    onCall: (name: string, args: unknown) => Promise<unknown>;
    listTools: () => Promise<unknown[]>;
    onStatus?: (s: unknown) => void;
  }) => {
    start: (port: number) => Promise<void>;
    stop: () => Promise<void>;
    status: () => { listening: boolean; port: number | null; client: { name: string; since: number } | null; blocked: boolean; error: string | null };
    disconnect: () => void;
    allowReconnect: () => void;
  };
  readOrCreateToken: (dir: string) => string;
  TOKEN_FILE: string;
};

const TOKEN = 'test-token-0123456789';
let server: ReturnType<typeof createMcpServer> | null = null;

afterEach(async () => {
  await server?.stop();
  server = null;
});

async function startServer(onCall: (name: string, args: unknown) => Promise<unknown> = async () => ({ content: [] })) {
  server = createMcpServer({
    token: TOKEN,
    version: '9.9.9',
    onCall,
    listTools: async () => [{ name: 'get_state', description: 'd', inputSchema: { type: 'object', properties: {} } }],
  });
  await server.start(0);
  return server.status().port!;
}

interface RpcReply {
  result: {
    serverInfo: { name: string };
    protocolVersion: string;
    capabilities: { tools?: object };
    instructions: string;
    tools: { name: string }[];
    content: { text: string }[];
  };
}

// node's own http, not fetch: fetch will not let a test set the Host header,
// and the rebinding case is exactly a wrong Host.
function post(port: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = JSON.stringify(body);
  const merged: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${TOKEN}`,
    host: `127.0.0.1:${port}`,
    ...headers,
  };
  for (const k of Object.keys(merged)) if (merged[k] === '') delete merged[k];
  return new Promise<{ status: number; headers: { get: (k: string) => string | null }; text: () => Promise<string>; json: () => Promise<RpcReply> }>(
    (resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: merged }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: { get: (k) => (res.headers[k.toLowerCase()] as string | undefined) ?? null },
            text: async () => data,
            json: async () => JSON.parse(data),
          })
        );
      });
      req.on('error', reject);
      req.end(payload);
    }
  );
}

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } },
};

async function connect(port: number): Promise<string> {
  const res = await post(port, INIT);
  expect(res.status).toBe(200);
  const session = res.headers.get('mcp-session-id');
  expect(session).toBeTruthy();
  return session!;
}

describe('PlotTracer as an MCP server - connecting (v2.7, docs/v2.7-mcp-cases.md)', () => {
  it('M1: with agents off, nothing listens', async () => {
    const port = await startServer();
    await server!.stop();
    expect(server!.status().listening).toBe(false);
    await expect(post(port, INIT)).rejects.toThrow();
  });

  it('M2: the server listens on this computer only', async () => {
    await startServer();
    expect(server!.status().listening).toBe(true);
    // the address is checked by the server itself, not assumed from the call
    expect((server as unknown as { address: () => string }).address()).toBe('127.0.0.1');
  });

  it('M2: an agent with the token connects and is told what PlotTracer is', async () => {
    const port = await startServer();
    const res = await post(port, INIT);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.serverInfo.name).toBe('plottracer');
    expect(json.result.protocolVersion).toBe('2025-06-18');
    expect(json.result.capabilities.tools).toBeDefined();
    expect(json.result.instructions).toMatch(/calibrat/i);
  });

  it('M2: a connection without the token, or with a wrong one, is refused', async () => {
    const port = await startServer();
    expect((await post(port, INIT, { authorization: '' })).status).toBe(401);
    expect((await post(port, INIT, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect(server!.status().client).toBeNull();
  });

  it('M2: a request from a web page (wrong Origin) is refused', async () => {
    const port = await startServer();
    expect((await post(port, INIT, { origin: 'https://example.com' })).status).toBe(403);
    expect(server!.status().client).toBeNull();
  });

  it('M2: a request addressed to another host name (DNS rebinding) is refused', async () => {
    const port = await startServer();
    expect((await post(port, INIT, { host: `attacker.example:${port}` })).status).toBe(403);
  });

  it('M3: a connected agent is reported by name and since when', async () => {
    const port = await startServer();
    const before = Date.now();
    await connect(port);
    const client = server!.status().client;
    expect(client?.name).toBe('claude-code');
    expect(client!.since).toBeGreaterThanOrEqual(before);
  });

  it('M3: Disconnect ends the session and keeps the agent out until it is let back', async () => {
    const port = await startServer();
    const session = await connect(port);
    server!.disconnect();
    expect(server!.status().client).toBeNull();
    expect(server!.status().blocked).toBe(true);
    const after = await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-session-id': session });
    expect(after.status).toBe(404);
    const again = await post(port, INIT);
    expect(again.status).toBe(403);
    expect(await again.text()).toMatch(/disconnected/i);
    server!.allowReconnect();
    await connect(port);
    expect(server!.status().client?.name).toBe('claude-code');
  });

  it('a request without a session, or with an unknown one, is refused', async () => {
    const port = await startServer();
    await connect(port);
    expect((await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(400);
    expect((await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-session-id': 'nope' })).status).toBe(404);
  });

  it('tools/list and tools/call reach the window, and the answer comes back', async () => {
    const calls: [string, unknown][] = [];
    const port = await startServer(async (name, args) => {
      calls.push([name, args]);
      return { content: [{ type: 'text', text: 'Graph type: XY' }] };
    });
    const session = await connect(port);
    const list = await (await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-session-id': session })).json();
    expect(list.result.tools.map((t) => t.name)).toEqual(['get_state']);
    const call = await (
      await post(port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_state', arguments: { a: 1 } } }, { 'mcp-session-id': session })
    ).json();
    expect(calls).toEqual([['get_state', { a: 1 }]]);
    expect(call.result.content[0]?.text).toBe('Graph type: XY');
  });

  it('a notification is accepted with no answer', async () => {
    const port = await startServer();
    const session = await connect(port);
    const res = await post(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': session });
    expect(res.status).toBe(202);
  });

  it('a second, different agent is refused while one is connected', async () => {
    const port = await startServer();
    await connect(port);
    const other = await post(port, { ...INIT, params: { ...INIT.params, clientInfo: { name: 'other-agent', version: '1' } } });
    expect(other.status).toBe(409);
    expect(await other.text()).toMatch(/claude-code/);
  });
});

describe('the agent token', () => {
  it('is made once and kept, so a pasted configuration keeps working', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plottracer-mcp-token-'));
    const a = readOrCreateToken(dir);
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(readOrCreateToken(dir)).toBe(a);
    expect(fs.existsSync(path.join(dir, TOKEN_FILE))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
