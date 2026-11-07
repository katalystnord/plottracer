# Model card: PlotTracer's chart-element detector

The file `ui/figdet-model/detector.onnx` (in the app: `resources/app/ui/figdet-model/detector.onnx`), read by
`ui/electron-figdet.cjs`. PlotTracer 2.7 and later.

- **What it does:** finds the parts of a chart on a figure: plot_area, x_tick, y_tick, x_tick_label, y_tick_label,
  x_title, y_title, chart_title, legend_area, legend_marker, legend_label, key_tick, key_tick_label, bar.
  Input 768 x 768. It runs on the user's machine; no figure leaves it.
- **Architecture and starting weights:** RF-DETR Nano by Roboflow, Apache-2.0
  (<https://github.com/roboflow/rf-detr>), fine-tuned by Katalyst Nord.
- **sha256:** `3e0ddfaec9766965db030d73fe6d1be0be8f13d2bf9c903dd9db3aa5a2bbfaa3`
- **Licence of these weights:** AGPL-3.0, as part of PlotTracer.

## Training data

Trained in two stages: 16 epochs (2026-10-19), then 8 more with the bar class added (2026-11-06).

1. **Generated figures:** 15,000 charts rendered by our own generator (`plottracer-ref`,
   `research/v2.7-figdet/gen_det.py`), with exact boxes for every class.
2. **CHART-Info ICPR 2022, PMC training split:** 5,312 figures in the first stage and 4,888 in the second (task 6 bar
   boxes), each counted three times. The figures come from PubMed Central articles that the organisers selected because
   they were published under CC BY. The annotations were made by the CHART-Info competition's organisers and are
   licensed CC BY-NC-SA 4.0. <https://chartinfo.github.io/>

Neither the annotations nor the figures are included in the model or in PlotTracer. The weights store no copy of them;
they hold what was learned from them.

## Measured

On CHART-Info's test figures and Adobe CHART-Synthetic, under the competition's protocol. The figures are in
`docs/accuracy.html`, and every step is in `docs/v2.7-workflow-walk.md`.
