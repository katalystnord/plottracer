/**
 * The Trace Challenge as a self-contained GAME MODULE (v2.3).
 *
 * ⚑⚑ WHAT THIS IS FOR. David: *"Everything relating to Trace Challenge should be
 * pulled out into its own game module. And might be able to think of another
 * game later too."* Before this, the game's six state atoms and eight callbacks
 * were interleaved with the digitizer's own in `Workspace.tsx`, so there was no
 * answer to "what does a game actually need from the app?" - and therefore no
 * cheap way to add a second one. `TraceChallengeHost` below IS that answer,
 * written down: eleven capabilities, nothing else. A second game implements
 * against the same host and needs no new seam in `Workspace`.
 *
 * ⛔ NOT a registry - yet. One game does not justify a dispatch table (tenet 10),
 * and a registry with a single entry is a guess about the second game rather
 * than a fact about this one. The host contract is the part that is knowable
 * now, and it is the part that makes the registry a small step later.
 *
 * ⚑ The PURE half already lives in `engine/traceChallenge.ts` (the round draw,
 * pre-calibration, scoring, the reveal) and `algorithms/challengeScore.ts`. This
 * file is deliberately the React-shaped remainder: state, effects, and the
 * host calls that only make sense against a live workspace. It follows the
 * refactor-4 method - the hook's BODY goes to a pure module, never the hook -
 * so what is left here is genuinely irreducible wiring.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  drawGradedRounds,
  DEFAULT_GRADE_PLAN,
  seededRng,
  calibrationInputsFromAnchors,
  scoreCompletedRound,
  challengeRevealFor,
  type ChallengeExample,
  type ChallengeReveal,
  type ChallengeSessionReader,
  type AdoptCalibrationInput,
} from '../../../engine/traceChallenge.js';
import { XY_AXES_CONFIG } from '../../../engine/axesTypeConfigs.js';
import type { RoundScore } from '../../../algorithms/challengeScore.js';
import type { ChallengePhase } from '../ChallengeOverlay.js';
import { readHighScores, insertHighScore, type HighScore } from '../challengeScores.js';

/**
 * Everything a game may ask of the workspace, and nothing more.
 *
 * ⚑ Written as ONE interface rather than a dozen loose props because the list
 * itself is the deliverable: it is the review surface for "should a game be able
 * to do that?". Adding a capability here is a visible decision; threading one
 * more argument through a hook is not.
 */
export interface TraceChallengeHost {
  /** The live calibration session. A game reads the player's extraction from it
   * and adopts a pre-baked calibration into it. */
  readonly session: () => ChallengeSessionReader & {
    getRepeatCount(): number;
    addRepeat(): boolean;
    adoptCalibration(inputs: AdoptCalibrationInput): boolean;
  };
  /** Start a fresh document on the given axes type, optionally with an image. */
  resetDocument(axesConfigId: string, dataURL?: string): void;
  closePdf(): void;
  clearFiguresToSingle(): void;
  /** False if the player declined to discard unsaved work - the game must abort. */
  confirmDiscardIfDirty(): boolean;
  /** Resolves when the picture has decoded - a round may not start before it. */
  loadImage(dataURL: string, name: string): Promise<void>;
  clearImage(): void;
  setFigureCaptured(captured: boolean): void;
  setCalibrationExpanded(expanded: boolean): void;
  setMode(mode: 'place-point'): void;
  /** Force a re-render after the session has been mutated imperatively. */
  bump(): void;
}

/** What the workspace renders and routes for a running game. */
export interface TraceChallengeState {
  readonly phase: ChallengePhase | null;
  readonly roundIndex: number;
  readonly roundCount: number;
  readonly instruction: string;
  readonly roundStartMs: number;
  readonly lastScore: RoundScore | null;
  readonly totalAdjusted: number;
  readonly highScores: readonly HighScore[];
  /** The current round's true answer, in image pixels - null unless revealing. */
  readonly reveal: ChallengeReveal | null;
  start(): void;
  begin(): void;
  finishRound(): void;
  nextRound(): void;
  saveHighScore(name: string): void;
  finish(): void;
}

/**
 * Read an example image as a data URL. Kept a plain function (not a hook) so the
 * round loader stays one linear `await`.
 */
async function imageAsDataURL(src: string): Promise<string> {
  const blob = await fetch(src).then((r) => r.blob());
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Where a replayable game's seed is stored.
 *
 * ⚑ Beside the high scores, which already live in localStorage under the same
 * prefix - one place a reader looks for what this game remembers.
 */
export const CHALLENGE_SEED_KEY = 'plottracer.challenge.seed';

/** The seed a replayable game was asked for, or `undefined` for a fresh one. */
function storedSeed(): (() => number) | undefined {
  try {
    const raw = window.localStorage.getItem(CHALLENGE_SEED_KEY);
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? seededRng(n) : undefined;
  } catch {
    // ⚑ Private browsing and blocked site data both throw on read; a game that
    // cannot look up a seed is simply a fresh one.
    return undefined;
  }
}

export function useTraceChallenge(
  pool: readonly ChallengeExample[],
  host: TraceChallengeHost,
  axes: { dataToPixel(x: number, y: number): { x: number; y: number } } | null
): TraceChallengeState {
  // `phase` null = not playing; it's orthogonal to the workspace's `mode` (a
  // round runs in place-point mode).
  const [phase, setPhase] = useState<ChallengePhase | null>(null);
  const [queue, setQueue] = useState<ChallengeExample[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundStartMs, setRoundStartMs] = useState(0);
  const [scores, setScores] = useState<RoundScore[]>([]);
  const [highScores, setHighScores] = useState<HighScore[]>([]);

  // Load one round: fetch the example image, PRE-CALIBRATE from its committed
  // anchors (the player never clicks the axes), drop into place-point, start the
  // clock. Manual-only tracing is enforced by the rail gate + this mode.
  const loadRound = useCallback(
    async (ex: ChallengeExample) => {
      setRoundStartMs(0); // clock reads 0:00 while this round loads; real start stamped at the end
      const dataURL = await imageAsDataURL(ex.imageSrc);
      host.closePdf();
      host.resetDocument(ex.axesConfigId, dataURL); // fresh session; sets figureCaptured=false
      const inputs = calibrationInputsFromAnchors(ex.truth.calibration);
      // ⚑ Grow the REPEATING step first. A spider's six spokes and a pie's four
      // outline points are steps that do not exist until asked for, and a session
      // sitting at the step minimum silently keeps only the first three placed
      // points -- a calibration that looks adopted and is a different figure.
      while (host.session().getRepeatCount() < (inputs.repeatCount ?? 0)) {
        if (!host.session().addRepeat()) break;
      }
      // ⚑ The boolean matters. A truth file whose anchors no longer calibrate
      // yields a round that LOOKS playable, records points with no data, and
      // scores as all-misses -- with the one surface carrying the reason
      // (`getCalibrationError`) folded away otherwise.
      const adopted = host.session().adoptCalibration(inputs);
      host.setCalibrationExpanded(!adopted);
      // ⚑⚑ AWAITED, AND THE ORDER BELOW IS THE WHOLE FIX. `loadImage` used to
      // return while the decode ran on, so everything after it happened against
      // a canvas with no picture in it: the round went to place-point and THE
      // CLOCK STARTED before the figure existed. A player on a slower machine or
      // a larger figure lost time they never had, and any click landing in that
      // window hit an empty canvas. The e2e caught it as a one-in-three flake
      // and it was read as flakiness for two releases.
      await host.loadImage(dataURL, ex.name);
      // The example IS the whole figure-of-record: capture it (a no-op crop) so the
      // player can place points -- without this, capture stays pending and every
      // click is blocked ("Frame the whole figure... press Capture").
      host.setFigureCaptured(true);
      host.setMode('place-point');
      // ⚑ The clock starts LAST, and only now that there is something to trace.
      setRoundStartMs(Date.now());
      host.bump();
    },
    [host]
  );

  const start = useCallback(() => {
    if (!host.confirmDiscardIfDirty()) return;
    // ⚑ WEIGHTED, not uniform (David, 2026-08-10): two easy, one medium, one
    // hard. The pool spans a factor of ten in clicks -- 61 for the stress-strain
    // curve against 6 for a spider -- and the scoring currency is TIME, so a
    // uniform draw made one playthrough's score incomparable with another's.
    // ⚑⚑ A STORED SEED MAKES A GAME REPRODUCIBLE, and until 2026-09-01 nothing
    // used `drawGradedRounds`'s rng at all - so the challenge's own e2e played a
    // different game every run while clicking fixed coordinates, and went red on
    // the draw rather than on a defect. Absent, this is exactly the old
    // behaviour: a fresh random game.
    const rounds = drawGradedRounds(pool, (r) => r.grade, DEFAULT_GRADE_PLAN, storedSeed());
    if (rounds.length === 0) return;
    setQueue(rounds);
    setRoundIndex(0);
    setScores([]);
    setHighScores(readHighScores());
    setPhase('intro');
  }, [host, pool]);

  const begin = useCallback(() => {
    setRoundIndex(0);
    setScores([]);
    setPhase('playing');
    if (queue[0]) void loadRound(queue[0]);
  }, [queue, loadRound]);

  const finishRound = useCallback(() => {
    const ex = queue[roundIndex];
    if (!ex) return;
    const rawSeconds = Math.max(0, (Date.now() - roundStartMs) / 1000);
    setScores((prev) => [...prev, scoreCompletedRound(host.session(), ex, rawSeconds)]);
    setPhase('reveal');
  }, [queue, roundIndex, roundStartMs, host]);

  const nextRound = useCallback(() => {
    const next = roundIndex + 1;
    if (next < queue.length) {
      setRoundIndex(next);
      setPhase('playing');
      if (queue[next]) void loadRound(queue[next]);
    } else {
      setPhase('results');
    }
  }, [roundIndex, queue, loadRound]);

  const totalAdjusted = useMemo(() => scores.reduce((s, r) => s + r.adjustedSeconds, 0), [scores]);

  const saveHighScore = useCallback(
    (name: string) => setHighScores(insertHighScore(name, totalAdjusted)),
    [totalAdjusted]
  );

  const finish = useCallback(() => {
    setPhase(null);
    setQueue([]);
    setRoundIndex(0);
    setScores([]);
    host.clearFiguresToSingle();
    // Back to the app's opening state: default axes type, no image. A game that
    // ended on a spider must not leave the workspace configured for one.
    host.resetDocument(XY_AXES_CONFIG.id);
    host.clearImage();
  }, [host]);

  // The round's TRUE answer for the on-figure overlay. Which families project
  // through the axes and which are pixel-native is the MODEL's business, so the
  // decision lives in engine/traceChallenge.ts.
  const reveal = useMemo(() => {
    if (phase !== 'reveal') return null;
    const ex = queue[roundIndex];
    return ex ? challengeRevealFor(ex, axes) : null;
  }, [phase, queue, roundIndex, axes]);

  return {
    phase,
    roundIndex,
    roundCount: queue.length,
    instruction: queue[roundIndex]?.instruction ?? '',
    roundStartMs,
    lastScore: scores[scores.length - 1] ?? null,
    totalAdjusted,
    highScores,
    reveal,
    start,
    begin,
    finishRound,
    nextRound,
    saveHighScore,
    finish,
  };
}
