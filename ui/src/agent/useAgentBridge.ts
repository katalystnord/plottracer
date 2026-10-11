import { useEffect, useState, type RefObject } from 'react';
import type { AgentCall, AgentStatus } from '../electronApi.js';
import { describeState, planView } from './agentTools.js';
import { AGENT_TOOLS, doAgentTool, type AgentDoingHost, type ToolResult } from './agentDoing.js';
import { isStep, type AgentRounds } from './agentRounds.js';

/**
 * The window's half of the agent server (v2.7, docs/v2.7-mcp-cases.md): the
 * main process hands each tool call over, and this answers it from the
 * Workspace through `hostRef`, which Workspace refreshes every render so a call
 * always reads the figure as it is NOW.
 */
export interface AgentHost extends AgentDoingHost {
  /** M6: open a figure the main process has already checked and read. */
  openFigure: (figure: { name: string; dataURL: string; page?: number }) => Promise<ToolResult>;
  /** M14: the connected agent's rounds, or null when none is connected. */
  rounds?: () => AgentRounds | null;
}

const refuse = (text: string): ToolResult => ({ isError: true, content: [{ type: 'text', text }] });

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export async function answerAgentCall(call: AgentCall, host: AgentHost): Promise<unknown> {
  if (call.kind === 'list') return AGENT_TOOLS;
  const args = (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, unknown>;
  switch (call.name) {
    case 'get_state': {
      // R4: an Undo this round the agent has not heard about yet comes first
      const notice = host.rounds?.()?.takeNotice();
      return { content: [{ type: 'text', text: (notice ? `${notice}\n\n` : '') + describeState(host.getState()) }] } satisfies ToolResult;
    }
    case 'view_figure': {
      const st = host.getState();
      if (!st.figure) return refuse('No figure is open in PlotTracer. Ask the user to open one.');
      let region: { x: number; y: number; width: number; height: number } | undefined;
      if (args.region !== undefined) {
        const r = args.region as Record<string, unknown>;
        const [x, y, width, height] = [num(r?.x), num(r?.y), num(r?.width), num(r?.height)];
        if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
          return refuse('region needs x, y, width and height as numbers, with width and height above 0, in figure pixels.');
        }
        region = { x, y, width, height };
      }
      const zoom = num(args.zoom);
      if (args.zoom !== undefined && (zoom === undefined || zoom <= 0)) return refuse('zoom has to be a number above 0.');
      const plan = planView({ imageWidth: st.figure.width, imageHeight: st.figure.height, ...(region ? { region } : {}), ...(zoom !== undefined ? { zoom } : {}) });
      if ('error' in plan) return refuse(plan.error);
      if (args.marks !== undefined && typeof args.marks !== 'boolean') return refuse('marks has to be true or false.');
      const url = host.renderRegion({ ...plan, marks: args.marks !== false });
      if (!url) return refuse('PlotTracer could not draw the figure just now. Call get_state, then try again.');
      const s = +plan.scale.toFixed(3);
      const text =
        `Figure pixels x ${plan.x} to ${plan.x + plan.width}, y ${plan.y} to ${plan.y + plan.height}, ` +
        `at zoom ${s} (one figure pixel is ${s} picture ${s === 1 ? 'pixel' : 'pixels'}; picture ${plan.outWidth} × ${plan.outHeight}).` +
        (plan.note ? ` ${plan.note}` : '') +
        (args.marks === false ? ' Without PlotTracer\'s marks.' : '');
      return {
        content: [
          { type: 'image', data: url.slice(url.indexOf(',') + 1), mimeType: 'image/png' },
          { type: 'text', text },
        ],
      } satisfies ToolResult;
    }
    case 'open_figure': {
      const name = typeof args.name === 'string' ? args.name : null;
      const dataURL = typeof args.dataURL === 'string' ? args.dataURL : null;
      if (!name || !dataURL) return refuse('open_figure is answered through the folder chosen in Settings; call list_folder.');
      const page = typeof args.page === 'number' && Number.isInteger(args.page) && args.page >= 1 ? args.page : undefined;
      return host.openFigure({ name, dataURL, ...(page ? { page } : {}) });
    }
    case 'list_folder':
      return refuse('The folder is listed by PlotTracer itself, outside this window; try again.');
    default: {
      // M14: a step waits its turn in the round; looking never does (R7)
      const rounds = host.rounds?.();
      if (rounds && isStep(String(call.name)) && host.getState().calibrated) {
        const notice = rounds.takeNotice();
        if (notice) return refuse(notice);
        const gate = await rounds.beforeStep();
        if (!gate.go) return refuse(gate.message);
      }
      const done = await doAgentTool(String(call.name), call.args, host);
      if (done) return done;
      return refuse(`PlotTracer has no tool "${String(call.name)}". Its tools are: ${AGENT_TOOLS.map((t) => t.name).join(', ')}.`);
    }
  }
}

/** The tools that only read, and never wait behind a step. */
const LOOKING: ReadonlySet<string> = new Set(['get_state', 'view_figure', 'list_points', 'select_points', 'export']);

export function useAgentBridge(hostRef: RefObject<AgentHost | null>): void {
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onAgentCall || !api.answerAgent) return;
    const answer = api.answerAgent;
    // ⚑ One call at a time, in the order they came: a step (Find lines reading
    // labels) can take a while, and a second step must not start on a figure
    // the first one is still changing.
    let queue: Promise<void> = Promise.resolve();
    const run = async (call: AgentCall) => {
      try {
        const host = hostRef.current;
        if (!host) throw new Error('PlotTracer is still starting. Try again in a moment.');
        answer(call.callId, await answerAgentCall(call, host));
      } catch (e) {
        answer(call.callId, undefined, e instanceof Error ? e.message : String(e));
      }
    };
    const off = api.onAgentCall((call) => {
      // ⚑ Looking goes straight through (R7): an agent whose step is held for
      // approval can still look at the figure while it waits.
      if (call.kind === 'call' && LOOKING.has(String(call.name))) void run(call);
      else queue = queue.then(() => run(call));
    });
    // only now can a call be answered, so only now is the main process told
    api.notifyAgentReady?.(true);
    return () => {
      api.notifyAgentReady?.(false);
      off();
    };
  }, [hostRef]);
}

/** The server's state, kept current by the main process's pushes. */
export function useAgentStatus(): AgentStatus | null {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getAgentStatus || !api.onAgentStatus) return;
    let live = true;
    void api.getAgentStatus().then((s) => { if (live) setStatus(s); }).catch(() => undefined);
    const off = api.onAgentStatus((s) => setStatus(s));
    return () => { live = false; off(); };
  }, []);
  return status;
}

/** What to paste into an agent client to connect it. */
export function agentConfig(status: AgentStatus): { url: string; claudeCode: string; json: string } | null {
  if (!status.listening || status.port === null || !status.token) return null;
  const url = `http://${status.host}:${status.port}/mcp`;
  const header = `Authorization: Bearer ${status.token}`;
  return {
    url,
    claudeCode: `claude mcp add --transport http plottracer ${url} --header "${header}"`,
    json: JSON.stringify({ mcpServers: { plottracer: { type: 'http', url, headers: { Authorization: `Bearer ${status.token}` } } } }, null, 2),
  };
}
