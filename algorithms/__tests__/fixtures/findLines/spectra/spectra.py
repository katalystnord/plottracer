import json, sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
out = sys.argv[1]
rng = np.random.default_rng(7)

def lor(x, c, w): return 1 / (1 + ((x - c) / w) ** 2)

def ir(n_peaks, wmin, wmax, noise=0.0, seed=1):
    r = np.random.default_rng(seed)
    x = np.linspace(400, 4000, 7200)
    a = np.zeros_like(x)
    for _ in range(n_peaks):
        a += r.uniform(0.1, 0.9) * lor(x, r.uniform(500, 3800), r.uniform(wmin, wmax))
    t = 100 * np.exp(-a)
    if noise: t += r.normal(0, noise, x.size)
    return x, t

def save(name, series, dpi, invert=True, ylabel='Transmittance (%)'):
    fig, ax = plt.subplots(figsize=(6.4, 4.0), dpi=dpi)
    lines = []
    for (x, y, c) in series:
        (L,) = ax.plot(x, y, color=c, lw=1.0)
        lines.append(L)
    if invert: ax.invert_xaxis()
    ax.set_xlabel('Wavenumber (cm$^{-1}$)'); ax.set_ylabel(ylabel)
    fig.tight_layout()
    fig.canvas.draw()
    H = fig.canvas.get_width_height()[1]
    truth = []
    for (x, y, c) in series:
        p = ax.transData.transform(np.column_stack([x, y]))
        truth.append({'colour': [int(round(v * 255)) for v in matplotlib.colors.to_rgb(c)], 'px': p[:, 0].tolist(), 'py': (H - p[:, 1]).tolist()})
    bb = ax.get_window_extent()
    box = [bb.x0, H - bb.y1, bb.x1, H - bb.y0]
    fig.savefig(f'{out}/{name}.png', dpi=dpi)
    json.dump({'box': box, 'series': truth}, open(f'{out}/{name}.json', 'w'))
    plt.close(fig)

x, t = ir(30, 6, 40, seed=1); save('ir-100dpi', [(x, t, '#1f77b4')], 100)
save('ir-150dpi', [(x, t, '#1f77b4')], 150)
x2, t2 = ir(30, 6, 40, noise=0.8, seed=1); save('ir-noisy', [(x2, t2, '#000000')], 120)
x3, t3 = ir(60, 2, 8, seed=3); save('raman-sharp', [(x3, t3, '#d62728')], 120, invert=False, ylabel='Intensity')
xa, ta = ir(25, 6, 40, seed=5); xb, tb = ir(25, 6, 40, seed=6)
save('ir-two', [(xa, ta, '#1f77b4'), (xb, tb - 10, '#d62728')], 120)
print('ok')

# one narrow, deep peak on a flat baseline: the flanks fuse for most of its depth (v2.7, findLinesSpectra.test.ts)
x1 = np.linspace(400, 4000, 7200)
t1 = 100 * np.exp(-0.9 * lor(x1, 2200, 6))
save('one-narrow-peak', [(x1, t1, '#1f77b4')], 100)
print('ok')
