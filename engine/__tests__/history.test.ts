import { describe, expect, it } from 'vitest';
import { History } from '../history.js';

describe('History (checkpoint 38)', () => {
  it('starts with nothing to undo or redo', () => {
    const h = new History('a');
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.getPresent()).toBe('a');
  });

  it('commit makes the prior state undoable and updates the present', () => {
    const h = new History('a');
    h.commit('b');
    expect(h.getPresent()).toBe('b');
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });

  it('undo returns the previous state and enables redo', () => {
    const h = new History('a');
    h.commit('b');
    expect(h.undo()).toBe('a');
    expect(h.getPresent()).toBe('a');
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });

  it('redo returns the undone state again', () => {
    const h = new History('a');
    h.commit('b');
    h.undo();
    expect(h.redo()).toBe('b');
    expect(h.getPresent()).toBe('b');
    expect(h.canRedo()).toBe(false);
    expect(h.canUndo()).toBe(true);
  });

  it('undo at the start and redo at the end return null without moving', () => {
    const h = new History('a');
    expect(h.undo()).toBeNull();
    expect(h.getPresent()).toBe('a');
    h.commit('b');
    expect(h.redo()).toBeNull();
    expect(h.getPresent()).toBe('b');
  });

  it('walks a multi-step chain backward and forward', () => {
    const h = new History('s0');
    h.commit('s1');
    h.commit('s2');
    h.commit('s3');
    expect(h.undo()).toBe('s2');
    expect(h.undo()).toBe('s1');
    expect(h.redo()).toBe('s2');
    expect(h.redo()).toBe('s3');
    expect(h.canRedo()).toBe(false);
  });

  it('a commit after an undo discards the redo branch', () => {
    const h = new History('s0');
    h.commit('s1');
    h.commit('s2');
    h.undo(); // present = s1, future = [s2]
    expect(h.canRedo()).toBe(true);
    h.commit('s2-alt');
    expect(h.canRedo()).toBe(false); // s2 branch gone
    expect(h.getPresent()).toBe('s2-alt');
    expect(h.undo()).toBe('s1');
  });

  it('caps retained undo depth, dropping the oldest states', () => {
    const h = new History('s0', 3);
    for (let i = 1; i <= 5; i++) h.commit(`s${i}`);
    // maxDepth 3 => at most 3 undos back from s5: s4, s3, s2.
    expect(h.undo()).toBe('s4');
    expect(h.undo()).toBe('s3');
    expect(h.undo()).toBe('s2');
    expect(h.undo()).toBeNull(); // s1/s0 dropped
    expect(h.getPresent()).toBe('s2');
  });

  it('reset clears both stacks and restarts from the given state', () => {
    const h = new History('s0');
    h.commit('s1');
    h.commit('s2');
    h.undo();
    h.reset('fresh');
    expect(h.getPresent()).toBe('fresh');
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});
