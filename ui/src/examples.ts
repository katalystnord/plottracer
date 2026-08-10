/**
 * The bundled example figures, and the manual's address.
 *
 * ⚑ Its own module because BOTH the Help dropdown and the Trace Challenge read
 * this list — the challenge joins its eligible ids back to these entries for
 * the image source and the axes type. Left inside Workspace.tsx it would have
 * had to be threaded into the Help panel as a prop, which is how a data table
 * ends up owned by whichever component happened to render it first.
 */
import xySample from '../../samples/xy-stress-strain.png';
import xyMultiSample from '../../samples/xy-multiseries-modulus.png';
import scatterSample from '../../samples/scatter-crosslink-modulus.png';
import dashedReleaseSample from '../../samples/xy-dashed-release.png';
import histogramSample from '../../samples/histogram-pore-size.png';
import errorBarSample from '../../samples/errorbar-tensile-cure.png';
import errorBarAsymSample from '../../samples/errorbar-failure-time-asymmetric.png';
import barSample from '../../samples/bar-tensile-strength.png';
import barGroupedSample from '../../samples/bar-grouped-viability.png';
import barGroupedMissingSample from '../../samples/bar-grouped-missing-assay.png';
import barStackedSample from '../../samples/bar-stacked-cost.png';
import barFloatingSample from '../../samples/bar-floating-temperature.png';
import categoricalSample from '../../samples/categorical-fibre-modulus.png';
import barBoxSample from '../../samples/bar-box-plot-tensile-strength.png';
import polarSample from '../../samples/polar-diffusion-rate.png';
import spiderSample from '../../samples/spider-material-profile.png';
import pieSample from '../../samples/pie-filler-composition.png';
import pieExplodedSample from '../../samples/pie-exploded-market-share.png';
import donutSample from '../../samples/donut-donut-flavours.png';
import pieTiltedSample from '../../samples/pie-tilted-market-segments.png';
import ternarySample from '../../samples/ternary-blend-composition.png';
import mapSample from '../../samples/map-collection-sites.png';
import ccrSample from '../../samples/circular-temperature-recording.png';
import multipagePdfSample from '../../samples/multipage-figures.pdf?url';

/**
 * Where the manual lives.
 *
 * ⚑ RESTORED 2026-08-01 after `459291a` -- a commit about PIE CONTROLS -- deleted
 * it and the Help-card line that printed it as collateral in an unrelated edit.
 * The app then shipped v1.6.0 and v2.0.0-rc1 with no route to its own
 * documentation at all. It now lives in the F1 card as a REAL link, which is
 * where the deferred design always said Documentation would end up.
 */
export const MANUAL_URL = 'https://github.com/katalystnord/plottracer/blob/master/MANUAL.md';

export const EXAMPLES: readonly { id: string; name: string; src: string; axes: string; icon?: string; pdf?: boolean }[] = [
  { id: 'xy', name: 'Stress–strain curve', src: xySample, axes: 'xy' },
  { id: 'xy-multi', name: 'Multiseries — 4 curves', src: xyMultiSample, axes: 'xy' },
  // A scatter of single-colour markers (checkpoint 123) -- the shape the Blob
  // Detector exists for: Auto-extract by colour ▸ Scattered points reduces each
  // marker to one centroid. XY axes underneath (scatter is plain XY). Which
  // sub-mode to pick is the Auto-extract fly-out's own job now (see the header
  // comment above) -- the name used to spell it out as "(Auto-extract ▸
  // Scattered points)" and had drifted to say "Auto-trace", a name that rail
  // tool has never actually used (fixed 2026-07-30, then dropped entirely).
  { id: 'scatter', name: 'Scatter — modulus vs. crosslinker', src: scatterSample, axes: 'xy' },
  // A monochrome technical drawing whose 4 curves differ ONLY by dash style
  // (checkpoint: v0.8, David) -- the case Interpolation-assist exists for. All
  // black, so Auto-extract by colour can't separate them; dashed, so Segment Fill
  // has no unbroken path to flood -- you drop guide points on the dashed curve
  // you're following and let the spline fill between (Auto-extract's own
  // "Guide points" sub-mode). Plain XY axes.
  { id: 'dashed', name: 'Dashed curves — dash-coded release', src: dashedReleaseSample, axes: 'xy' },
  // Error bars sit with the XY family (all axes:'xy'), above Histogram (David).
  // Opens as XY, not as the retired 'errorbar' graph type (finding C3, fixed
  // ckpt 85): error is captured on an ordinary series via rail tool 6 now, so
  // the example must demonstrate the path that exists. Left declaring
  // 'errorbar', changeAxesType silently fell back to XY while the dropdown's
  // state was still set to a type it no longer lists -- so the Select rendered
  // BLANK. `icon: 'errorbars'` overrides the shared XY glyph so this row
  // doesn't look identical to every other XY example.
  { id: 'errorbar', name: 'Error bars — tensile strength ± SD', src: errorBarSample, axes: 'xy', icon: 'errorbars' },
  // ⚑ The pair matters. The ± SD figure above is SYMMETRIC, so a mirrored
  // cap happens to land right and the workflow's one real trap stays
  // hidden. This one is asymmetric at every point (time-to-failure is
  // log-normal, so its CI genuinely is), which is the only way to see that
  // an untouched lower cap reports a symmetry the figure never drew.
  { id: 'errorbar-asym', name: 'Error bars — asymmetric 95% CI', src: errorBarAsymSample, axes: 'xy', icon: 'errorbars' },
  { id: 'histogram', name: 'Pore size distribution', src: histogramSample, axes: 'histogram' },
  { id: 'bar', name: 'Tensile strength', src: barSample, axes: 'bar' },
  // Three more bar examples (v2.0, David: "some more bar graph test cases"),
  // each isolating one shape the v2.0 model exists for -- the same
  // one-example-per-capability reasoning as the four pies below. Plain
  // "Tensile strength" above stays the single-series baseline case.
  //
  // Grouped: two series sharing one category axis, side by side per category
  // -- ordinary zero-baseline bars, just two of them per row.
  { id: 'bar-grouped', name: 'Cell viability — control vs. treatment', src: barGroupedSample, axes: 'bar' },
  // ⚑ The figure category TICKS exist for (v2.1): the FIRST series has no
  // Lactose bar. Without declared categories the second series' Lactose bar
  // takes a neighbour's name -- a fabricated category, indistinguishable from a
  // transcribed one, and only when captured left-to-right. Absent from published
  // corpora (0 of 230) because journals do not print ragged grids; ordinary in
  // the draft data people actually bring.
  { id: 'bar-grouped-missing', name: 'Enzyme activity — a series with a missing bar', src: barGroupedMissingSample, axes: 'bar' },
  // Stacked: each segment its own drag-box (v2.0's capture model), not a
  // shared-baseline reading -- the case stackGroup/derivedTupleValue's
  // SPAN-not-cumulative rule exists for.
  { id: 'bar-stacked', name: 'Quarterly cost breakdown', src: barStackedSample, axes: 'bar' },
  // Floating: neither end is the chart's baseline, and several bars cross
  // zero -- the case the two-corner drag-box exists for (no baseline to
  // assume, unlike an ordinary bar).
  { id: 'bar-floating', name: 'Monthly temperature range', src: barFloatingSample, axes: 'bar' },
  // Line needs an example of its own so a first-time user can see what "X is
  // a category, not a number" means (David) -- a line over discrete fibre
  // types, the shape the type exists for (checkpoint 101). Name dropped its
  // own "(categorical X)" 2026-07-30, matching the type label's own rename
  // (David: consistency -- the icon carries the distinction now, same as
  // every other example here).
  { id: 'categorical', name: 'Fibre modulus', src: categoricalSample, axes: 'categorical' },
  // Opens as the first-class 'boxplot' type (checkpoint 107), not 'bar' + the
  // hidden toggle -- so the example demonstrates the discoverable path.
  { id: 'boxplot', name: 'Tensile strength (box plot)', src: barBoxSample, axes: 'boxplot' },
  { id: 'polar', name: 'Diffusion rate', src: polarSample, axes: 'polar' },
  // Spider (v1.4). Three series in distinct colours and, deliberately, SIX AXES
  // WITH SIX DIFFERENT RANGES (tensile 0-120 MPa beside a cost index 0-5) sharing
  // a centre of 0 -- the per-axis-scale case the only prior art excludes by
  // assuming one shared scale, and the thing placing a known point on every spoke
  // exists to buy. Line-only polygons: filled radar shapes blend into new colours
  // where they overlap, and every vertex has to stay clickable.
  { id: 'spider', name: 'Material performance profile', src: spiderSample, axes: 'spider' },
  // ⚑ FOUR pies, because each isolates ONE thing the type can do, and a single
  // example would leave three of them undiscoverable. They are also the acceptance
  // set the e2e drives against their own committed ground truth, so what is offered
  // here is exactly what is proven to read correctly.
  { id: 'pie', name: 'Filler composition', src: pieSample, axes: 'pie' },
  // The pulled-out slice: the ExplodedSliceControl.tsx button ("Exploded
  // slice") sits on the canvas the moment a pie is being captured, so it
  // needs no menu-label pointer -- click its tip, then its two edges.
  { id: 'pie-exploded', name: 'One slice pulled out', src: pieExplodedSample, axes: 'pie' },
  // A donut, and the case that made the centre FITTED rather than clicked: there is
  // no centre in the image to click. Its total is printed in the hole, so it also
  // exercises a Total that is not the prefilled 100.
  { id: 'donut', name: 'Donut flavours', src: donutSample, axes: 'pie', icon: 'donut' },
  // Tilted, standing in for a 3D chart's top face -- read flat it is wrong by
  // several points and still sums to 100, so the "Tilted / 3D pie" checkbox
  // (a calibration-step option, calibrationSession.ts:1676 -- always visible
  // there, not hidden) is the whole lesson.
  { id: 'pie-tilted', name: 'Tilted / 3D top face', src: pieTiltedSample, axes: 'pie' },
  { id: 'ternary', name: 'Blend composition', src: ternarySample, axes: 'ternary' },
  { id: 'map', name: 'Collection sites', src: mapSample, axes: 'map' },
  { id: 'ccr', name: 'Temperature', src: ccrSample, axes: 'ccr' },
  // A multi-page PDF (checkpoint 114) -- opens the PDF (not a single image), so
  // the page flipper appears on its own and you can capture a figure per page.
  // Demonstrates the whole multi-figure workflow end to end.
  { id: 'multipage-pdf', name: 'Multi-page PDF — 3 figures', src: multipagePdfSample, axes: 'xy', pdf: true },
];
