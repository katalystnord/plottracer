/**
 * Design tokens for ui/ (checkpoint 31's light theme, restructured into a
 * nested object at checkpoint 33 -- see CLAUDE.md's "engine/ui rebuild —
 * staged checkpoints"). Colors are ported directly from Ketcher-Desktop's
 * real palette, the design-language lead named in CLAUDE.md's "Product #1
 * — rebuild design" — not guessed at.
 *
 * Shape matches Ketcher's own token-object pattern, specifically
 * `ketcher-react/src/components/styles/consts.ts` (a small, nested
 * `{ color, font, border }` object consumed by `@emotion/styled`-wrapped
 * components) rather than the much larger `EditorTheme` in
 * `ketcher-macromolecules` -- that one's scoped to a whole separate
 * molecule-editor domain (monomer/peptide color scientific tables, its own
 * z-index scale) that has no equivalent here; matching its size would be
 * over-building for what `ui/` actually needs today. Grow this object
 * further, the same way, if a real need shows up -- don't pre-build it.
 *
 * This is a direction, not a toggle (per the user's own framing when this
 * was flagged at checkpoint 30): there is deliberately no dark variant to
 * switch to.
 *
 * Scope: app *chrome* only (buttons, panels, borders, page background,
 * status text). Deliberately NOT touched, and not covered by these tokens:
 * per-dataset series colors (engine/calibrationSession.ts's tab10 palette,
 * checkpoint 30) and the Curve Fit overlay's green fit line — both are
 * data-identifying accent colors, not UI theme, and stay exactly as they
 * were. `color.overlay` below is the one exception: the default marker/
 * box-glyph outline used to be white, tuned for the old dark page chrome,
 * but that choice was never really about the *page* theme — the marker
 * overlay always renders directly on top of the loaded plot image, and
 * most scanned/photographed scientific charts have light paper
 * backgrounds, so a white outline already had poor contrast in the common
 * case. Switched to a dark near-black here as a small, real legibility
 * fix, not scope creep — see the checkpoint note in
 * docs/checkpoint-history.md.
 */
export const theme = {
  color: {
    background: {
      primary: '#ffffff',
      canvas: '#f2f2f2',
      panel: '#f5f6f7',
    },
    border: {
      regular: '#cad3dd',
      hover: '#dddddd',
    },
    divider: '#aeaeae',
    text: {
      primary: '#333333',
      secondary: '#585858',
      legend: '#aeaeae',
    },
    primary: {
      main: '#167782',
      hover: '#006775',
      button: '#005662',
      clicked: '#4fb3bf',
    },
    icon: {
      active: '#525252',
    },
    error: '#f40724',
    /** Marker/box-glyph outline + label fill, and a placed-but-unconfirmed
     * calibration point's ("?") fill, on the canvas overlay -- see header
     * comment for why these are dark/light rather than following the page
     * theme directly. */
    overlay: {
      stroke: '#262626',
      pendingMarkerFill: '#ffffff',
    },
  },
  font: {
    family: 'system-ui, sans-serif',
    size: {
      small: 11,
      regular: 13,
    },
  },
  border: {
    radius: {
      regular: 6,
    },
  },
} as const;

/**
 * Frosted-glass surface for the FOLD-OUT CARDS that float over the canvas
 * (Measure / Image Edit / Auto-extract / Error bars, and the calibration card
 * once it's locked). Decided with David (2026-07-20): the figure is the immutable
 * record and everything else floats above it, so a card is translucent -- the
 * figure shows THROUGH it (blurred for legibility), reinforcing "the truth is
 * beneath, this is glass on top" rather than reserving/shrinking the figure.
 * Opacity dropped 0.82 -> 0.6 (David, 2026-07-21) so the graph is clearly visible
 * through the card, not just faintly.
 *
 * NOT for the icon rail -- David 2026-07-21: the rail's icons must stay crisp over
 * any figure, so it is SOLID (see layout.tsx's RailGroup). Nor for chrome with its
 * own layout region (top bar, right sidebar, bottom bar), which stays opaque.
 */
export const glassSurface = {
  background: 'rgba(255, 255, 255, 0.6)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
} as const;
