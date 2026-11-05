"""Marker-coded figures with pixel ground truth (v2.7, docs/v2.7-workflow-walk.md, "Series told apart by their
markers"). Several series share one ink and differ by marker shape (and sometimes line style too), as matplotlib,
ggplot2 and R draw them. ggplot2's and R's shapes are drawn here with matplotlib's equivalents at their sizes:
16/19 filled circle, 17 filled triangle, 15 filled square, 1 open circle, 2 open triangle, 0 open square, 4 cross,
3 plus, 5 open diamond.
Run: python3 markers.py <out dir>. Each figure writes <name>.png and <name>.json: the plot box, the legend box, and
per series its name, ink, marker, fill, line style and the pixel centres of its markers, plus the legend sample's box."""
import json, sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

out = sys.argv[1]
rng = np.random.default_rng(7)

def scatter_data(n_series, n=25, spread=1.0):
    return [(np.sort(rng.uniform(0, 10, n)), None) for _ in range(n_series)]

def figure(name, kind, specs, ink='black', lw=1.5, dpi=100, ms=7, markevery=None, legend_loc='upper left', n=25, mew=1.0):
    """specs: list of (marker, fill, linestyle). kind: 'scatter' (markers only) or 'line' (a line with markers)."""
    fig, ax = plt.subplots(figsize=(6.4, 4.4), dpi=dpi)
    data = []
    for i, (mk, fill, ls) in enumerate(specs):
        if kind == 'scatter':
            x = np.sort(rng.uniform(0.3, 9.7, n))
            y = 2 + 2.5 * i + 1.6 * np.sin(x * 0.8 + i) + rng.normal(0, 0.35, n)
        else:
            x = np.linspace(0, 10, 41)
            y = 2 + 2.2 * i + 0.8 * np.sin(x * 0.7 + i)
        data.append((x, y))
        face = ink if fill == 'full' else 'none'
        (L,) = ax.plot(x, y, color=ink, lw=lw if kind == 'line' else 0, linestyle=ls if kind == 'line' else 'none',
                       marker=mk, markersize=ms, markerfacecolor=face, markeredgecolor=ink, markeredgewidth=mew,
                       markevery=markevery, label=f'Series {chr(65 + i)}')
    leg = ax.legend(loc=legend_loc)
    fig.tight_layout()
    fig.canvas.draw()
    H = fig.canvas.get_width_height()[1]
    r = fig.canvas.get_renderer()
    bb = ax.get_window_extent()
    lb = leg.get_window_extent(r)
    series = []
    for i, ((x, y), (mk, fill, ls), hl) in enumerate(zip(data, specs, leg.get_lines())):
        p = ax.transData.transform(np.column_stack([x, y]))
        idx = np.arange(len(x)) if markevery is None else np.arange(0, len(x), markevery)
        sb = hl.get_window_extent(r)
        series.append({
            'name': f'Series {chr(65 + i)}', 'ink': [int(round(v * 255)) for v in matplotlib.colors.to_rgb(ink)],
            'marker': mk, 'fill': fill, 'style': ls if kind == 'line' else None,
            'line': {'px': p[:, 0].round(2).tolist(), 'py': (H - p[:, 1]).round(2).tolist()} if kind == 'line' else None,
            'markers': [[round(float(p[k, 0]), 2), round(float(H - p[k, 1]), 2)] for k in idx],
            'sample': [round(sb.x0, 1), round(H - sb.y1, 1), round(sb.x1, 1), round(H - sb.y0, 1)],
        })
    fig.savefig(f'{out}/{name}.png', dpi=dpi)
    json.dump({'kind': kind, 'dpi': dpi, 'markerSize': ms,
               'box': [round(bb.x0, 1), round(H - bb.y1, 1), round(bb.x1, 1), round(H - bb.y0, 1)],
               'legend': [round(lb.x0, 1), round(H - lb.y1, 1), round(lb.x1, 1), round(H - lb.y0, 1)],
               'series': series}, open(f'{out}/{name}.json', 'w'))
    plt.close(fig)

F, N = 'full', 'none'
# scatter, one ink, told apart by marker alone
figure('scatter-mpl-filled3', 'scatter', [('o', F, None), ('s', F, None), ('^', F, None)])
figure('scatter-mpl-open3', 'scatter', [('o', N, None), ('s', N, None), ('^', N, None)])
figure('scatter-mpl-mixed4', 'scatter', [('o', F, None), ('o', N, None), ('s', F, None), ('s', N, None)])
figure('scatter-mpl-strokes4', 'scatter', [('x', F, None), ('+', F, None), ('D', N, None), ('v', F, None)], mew=1.5)
figure('scatter-gg-filled3', 'scatter', [('o', F, None), ('^', F, None), ('s', F, None)], ms=5.5, mew=0.5)
figure('scatter-r-open4', 'scatter', [('o', N, None), ('^', N, None), ('s', N, None), ('x', F, None)], ms=6.5, mew=0.9)
figure('scatter-mpl-filled3-small', 'scatter', [('o', F, None), ('s', F, None), ('^', F, None)], ms=4.5, dpi=100)
figure('scatter-mpl-filled3-dense', 'scatter', [('o', F, None), ('s', F, None), ('^', F, None)], n=60)
figure('scatter-mpl-grey3', 'scatter', [('o', F, None), ('s', N, None), ('^', F, None)], ink='0.35')
# lines with markers, one ink, one line style: the marker alone tells them apart
figure('line-mpl-solid-filled4', 'line', [('o', F, '-'), ('s', F, '-'), ('^', F, '-'), ('D', F, '-')], markevery=4)
figure('line-mpl-solid-open3', 'line', [('o', N, '-'), ('s', N, '-'), ('^', N, '-')], markevery=4)
figure('line-mpl-solid-every', 'line', [('o', F, '-'), ('s', N, '-'), ('^', F, '-')])
figure('line-gg-solid-filled3', 'line', [('o', F, '-'), ('^', F, '-'), ('s', F, '-')], ms=5.5, mew=0.5, lw=1.0, markevery=4)
# lines with markers and line styles both
figure('line-mpl-dash-marker4', 'line', [('o', F, '-'), ('s', N, '--'), ('^', F, '-.'), ('D', N, ':')], markevery=4)
figure('line-mpl-dash-marker-150', 'line', [('o', F, '-'), ('s', N, '--'), ('^', F, ':')], markevery=5, dpi=150)
