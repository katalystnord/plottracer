import { describe, expect, it, vi } from 'vitest';
import { reporting } from '../asyncAction.js';

/** Let the microtask queue drain, since the handler is deliberately fire-and-forget. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('an async action that fails', () => {
  it('⚑⚑ a rejection reaches the reporter instead of vanishing', async () => {
    const report = vi.fn();
    reporting('Could not save the project', () => Promise.reject(new Error('EACCES: permission denied')), report)();
    await settle();
    expect(report).toHaveBeenCalledWith('Could not save the project - EACCES: permission denied');
  });

  it('⚑ a throw before the first await is caught too', async () => {
    // `async` turns a synchronous throw into a rejection, but only if the call
    // itself is inside the promise chain - which is what the `void run().catch`
    // shape guarantees and a bare `try { await f() }` around the call site does
    // not, if someone later drops the await.
    const report = vi.fn();
    reporting('Could not open the image', async () => { throw new Error('boom'); }, report)();
    await settle();
    expect(report).toHaveBeenCalledWith('Could not open the image - boom');
  });

  it('⚑ a success reports nothing at all', async () => {
    const report = vi.fn();
    reporting('Could not save the project', () => Promise.resolve('/tmp/p.zip'), report)();
    await settle();
    expect(report).not.toHaveBeenCalled();
  });

  it('⚑ something thrown that is not an Error still says something usable', async () => {
    const report = vi.fn();
    reporting('Could not save the project', () => Promise.reject('disk went away'), report)();
    await settle();
    expect(report).toHaveBeenCalledWith('Could not save the project - disk went away');
  });

  it('⚑ and a thrown blank never produces a dangling dash with nothing after it', async () => {
    const report = vi.fn();
    reporting('Could not save the project', () => Promise.reject(new Error('')), report)();
    await settle();
    expect(report).toHaveBeenCalledWith('Could not save the project - the reason was not reported');
  });
});
