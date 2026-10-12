import { describe, expect, it } from 'vitest';
import { agentConfig } from '../agent/useAgentBridge.js';

// M2, corrected 2026-10-12 (David: "We need to make ONE settings for connecting
// ANY agent, the same. Not a special case for you."): Settings ▸ Agents offers
// one connection, the MCP settings block, and names no particular agent.
describe('M2: one connection for any agent', () => {
  const status = { listening: true, host: '127.0.0.1', port: 47821, token: 'abc123', client: null, blocked: false, error: null } as never;

  it('offers one MCP settings block holding the address and the key, and nothing aimed at one agent', () => {
    const cfg = agentConfig(status)!;
    expect(Object.keys(cfg).sort()).toEqual(['json', 'url']);
    expect(JSON.parse(cfg.json)).toEqual({
      mcpServers: { plottracer: { type: 'http', url: 'http://127.0.0.1:47821/mcp', headers: { Authorization: 'Bearer abc123' } } },
    });
    expect(JSON.stringify(cfg)).not.toMatch(/claude/i);
  });
});
