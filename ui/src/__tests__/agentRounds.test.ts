import { describe, expect, it } from 'vitest';
import { AgentRounds, HOLD_LIMIT_MS, STILL_WAITING, isStep } from '../agent/agentRounds.js';

// M14, phase 3 (docs/v2.7-mcp-cases.md R1-R11): rounds of steps the person
// approves. The gate is pure, so its cases run without a window; a fake clock
// stands in for the 60-second bound.

function rounds(size = 5, mode: 'rounds' | 'automatic' = 'rounds') {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const r = new AgentRounds({
    size,
    mode,
    setTimer: (ms, fn) => {
      const t = { at: now + ms, fn };
      timers.push(t);
      return () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); };
    },
  });
  const advance = (ms: number) => {
    now += ms;
    for (const t of [...timers].filter((x) => x.at <= now)) { timers.splice(timers.indexOf(t), 1); t.fn(); }
  };
  return { r, advance };
}

async function step(r: AgentRounds, label: string) {
  const gate = await r.beforeStep();
  if (gate.go) r.afterStep(label);
  return gate;
}

describe('M14: rounds of steps the person approves', () => {
  it('R1: in rounds of 5, the first five steps go at once, and the round counts them', async () => {
    const { r } = rounds();
    for (let i = 1; i <= 4; i++) expect((await step(r, `step ${i}`)).go).toBe(true);
    expect(r.view()).toMatchObject({ mode: 'rounds', size: 5, steps: ['step 1', 'step 2', 'step 3', 'step 4'], waiting: false });
    expect((await step(r, 'step 5')).go).toBe(true);
    // a complete round is offered for approval at once, before the agent asks again
    expect(r.view()).toMatchObject({ steps: ['step 1', 'step 2', 'step 3', 'step 4', 'step 5'], waiting: true });
  });

  it('R2: the sixth step is held, and the screen is told the agent waits', async () => {
    const { r } = rounds();
    for (let i = 1; i <= 5; i++) await step(r, `s${i}`);
    let settled = false;
    const sixth = r.beforeStep().then((g) => { settled = true; return g; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(r.view().waiting).toBe(true);
    r.approve();
    expect((await sixth).go).toBe(true);
  });

  it('R3: Approve and continue runs the held step and starts a new round at 1', async () => {
    const { r } = rounds(2);
    await step(r, 'a');
    await step(r, 'b');
    const held = r.beforeStep();
    r.approve();
    expect((await held).go).toBe(true);
    r.afterStep('c');
    expect(r.view().steps).toEqual(['c']);
  });

  it('R4: Undo this round hands back the round, does not run the held step, and tells the agent', async () => {
    const { r } = rounds(3);
    for (const s of ['a', 'b', 'c']) await step(r, s);
    const held = r.beforeStep();
    expect(r.undoRound()).toBe(3);
    const g = await held;
    expect(g.go).toBe(false);
    expect(!g.go && g.message).toBe('The user undid your last 3 steps. Call get_state to see the figure as it is now.');
    expect(r.view().steps).toEqual([]);
  });

  it('R4: told once - after an Undo this round, the agent hears it on its next call too if nothing was held', async () => {
    const { r } = rounds(3);
    await step(r, 'a');
    r.undoRound();
    expect(r.takeNotice()).toBe('The user undid your last 1 step. Call get_state to see the figure as it is now.');
    expect(r.takeNotice()).toBeNull();
  });

  it('R5: Continue automatically runs the held step and holds nothing more', async () => {
    const { r } = rounds(1);
    await step(r, 'a');
    const held = r.beforeStep();
    r.continueAutomatically();
    expect((await held).go).toBe(true);
    r.afterStep('b');
    for (let i = 0; i < 10; i++) expect((await step(r, `x${i}`)).go).toBe(true);
    expect(r.view().mode).toBe('automatic');
  });

  it('R6: Pause holds the next step in either mode, and Resume lets it go', async () => {
    const { r } = rounds(5, 'automatic');
    r.pause();
    expect(r.view().paused).toBe(true);
    const held = r.beforeStep();
    r.resume();
    expect((await held).go).toBe(true);
  });

  it('R7: looking is never a step', () => {
    for (const t of ['get_state', 'view_figure', 'list_folder', 'list_points', 'select_points', 'export', 'undo', 'open_figure']) expect(isStep(t), t).toBe(false);
    for (const t of ['place_points', 'place_guide_points', 'move_point', 'delete_points', 'cut_line', 'join_lines', 'move_to_line', 'set_level', 'use_label_read', 'find_lines', 'mask_area', 'add_series', 'rename_series', 'remove_series']) expect(isStep(t), t).toBe(true);
  });

  it('R8: a held call answers after 60 seconds that the agent should call again, and the round stays', async () => {
    const { r, advance } = rounds(1);
    await step(r, 'a');
    const held = r.beforeStep();
    advance(HOLD_LIMIT_MS);
    const g = await held;
    expect(g.go).toBe(false);
    expect(!g.go && g.message).toBe(STILL_WAITING);
    expect(r.view()).toMatchObject({ steps: ['a'], waiting: true });
  });

  it('R9: the state says the mode, the size, the steps taken and whether it waits', async () => {
    const { r } = rounds(5);
    await step(r, 'a');
    expect(r.describe()).toBe('Working mode: in rounds of 5 steps, chosen by the user; 1 step taken this round. After 5 the user approves before you go on.');
    r.pause();
    expect(r.describe()).toMatch(/Paused by the user/);
    const { r: auto } = rounds(5, 'automatic');
    expect(auto.describe()).toBe('Working mode: automatic, chosen by the user; your steps are not held for approval.');
  });

  it('R10: the mode can be switched for this connection, and a round size below 1 is not accepted', () => {
    const { r } = rounds(0);
    expect(r.view().size).toBe(1);
    r.setMode('automatic');
    expect(r.view().mode).toBe('automatic');
    r.setMode('rounds');
    expect(r.view()).toMatchObject({ mode: 'rounds', steps: [] });
  });

  it('R1 / M11: a step the agent undoes itself leaves the round', async () => {
    const { r } = rounds(3);
    await step(r, 'a');
    await step(r, 'b');
    r.stepUndone();
    expect(r.view().steps).toEqual(['a']);
  });
});
