"""Tick-finder fixtures: figures with their ticks drawn out, in, and across the axis, a histogram whose
bars stand on the axis, and a biology bar chart with group lines and significance brackets (v2.7,
David 2026-10-19: "first search on the outside, and only then search on the inside"; "those group lines
... can also be mistaken for tick marks").

Each PNG comes with <name>.truth.json, read from matplotlib's own renderer after drawing (the method
plottracer-ref research/v2.7-figdet/gen_det.py uses for the detector's training data): for the X and Y
axis, the axis line's two ends (on the spine's centre line), the outward unit vector, and the pixel of
every major tick ON the axis line (none for an axis that draws no tick marks). Seeded and committed, so the figures can be regenerated exactly.

Dev-only: python -I gen_ticks.py OUT_DIR   (matplotlib, numpy)
"""
import json, os, sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

out = sys.argv[1]
DPI = 100


def truth_of(fig, ax, name):
    fig.canvas.draw()
    H = fig.canvas.get_width_height()[1]
    flip = lambda p: [float(p[0]), float(H - p[1])]
    t = ax.transAxes
    res = {'image': f'{name}.png', 'axes': {}}
    for which, a0, a1, outward in (('x', (0, 0), (1, 0), [0, 1]), ('y', (0, 1), (0, 0), [-1, 0])):
        axis = ax.xaxis if which == 'x' else ax.yaxis
        lo, hi = (ax.get_xlim() if which == 'x' else ax.get_ylim())
        ticks = []
        for loc in axis.get_majorticklocs():
            if not (min(lo, hi) - 1e-9 <= loc <= max(lo, hi) + 1e-9):
                continue
            p = ax.transData.transform((loc, 0) if which == 'x' else (0, loc))
            q = t.transform(a0)
            ticks.append(flip((p[0], q[1])) if which == 'x' else flip((q[0], p[1])))
        res['axes'][which] = {'from': flip(t.transform(a0)), 'to': flip(t.transform(a1)), 'outward': outward, 'ticks': ticks}
    return res


def save(fig, ax, name, note, undrawn=()):
    tr = truth_of(fig, ax, name)
    tr['note'] = note
    for which in undrawn:  # an axis whose ticks have no length draws none: there is nothing to find
        tr['axes'][which]['ticks'] = []
        tr['axes'][which]['drawn'] = False
    fig.savefig(os.path.join(out, f'{name}.png'), dpi=DPI)
    json.dump(tr, open(os.path.join(out, f'{name}.truth.json'), 'w'), indent=1)
    plt.close(fig)


def xy(name, direction, note):
    r = np.random.default_rng(7)
    fig, ax = plt.subplots(figsize=(6, 4.2), dpi=DPI)
    x = np.linspace(0, 10, 40)
    # a line that touches the X axis near x = 0, as data ink against the spine does
    ax.plot(x, 4 * (1 - np.exp(-x / 3)) + r.normal(0, 0.05, x.size), color='#1f4e79')
    ax.set_xlim(0, 10); ax.set_ylim(0, 5)
    ax.tick_params(direction=direction, length=6, width=1.2)
    ax.set_xlabel('Time (h)'); ax.set_ylabel('Release (%)')
    fig.tight_layout()
    save(fig, ax, name, note)


xy('ticks-out', 'out', 'ticks drawn outward; the data line touches the X axis inside the plot')
xy('ticks-in', 'in', 'ticks drawn inward, as Origin draws them by default')
xy('ticks-inout', 'inout', 'ticks drawn across the axis')

# a histogram: the bars stand on the X axis, the ticks point out
r = np.random.default_rng(11)
fig, ax = plt.subplots(figsize=(6, 4.2), dpi=DPI)
ax.hist(r.normal(50, 12, 400), bins=np.arange(0, 101, 10), color='#7aa6c2', edgecolor='#1f4e79')
ax.set_xlim(0, 100)
ax.tick_params(direction='out', length=6, width=1.2)
ax.set_xlabel('Pore size (nm)'); ax.set_ylabel('Count')
fig.tight_layout()
save(fig, ax, 'histogram-ticks-out', 'bars stand on the X axis; the ticks point out')

# biology: bars, ticks inward on Y, group lines under the category labels, significance brackets above
fig, ax = plt.subplots(figsize=(6, 4.6), dpi=DPI)
vals = [12, 18, 15, 27]
ax.bar(range(4), vals, color=['#888', '#444', '#888', '#444'], width=0.6)
ax.set_xlim(-0.6, 3.6); ax.set_ylim(0, 40)
ax.set_xticks(range(4)); ax.set_xticklabels(['WT', 'KO', 'WT', 'KO'])
ax.tick_params(axis='y', direction='in', length=6, width=1.2)
ax.tick_params(axis='x', length=0)
ax.set_ylabel('Expression (a.u.)')
for x0, x1, label in ((0, 1, 'Day 1'), (2, 3, 'Day 7')):
    # the group line under the labels, with short end marks pointing up toward the axis
    y = -0.16
    ax.plot([x0 - 0.3, x1 + 0.3], [y, y], color='k', lw=1.2, transform=ax.get_xaxis_transform(), clip_on=False)
    for xe in (x0 - 0.3, x1 + 0.3):
        ax.plot([xe, xe], [y, y + 0.03], color='k', lw=1.2, transform=ax.get_xaxis_transform(), clip_on=False)
    ax.text((x0 + x1) / 2, y - 0.07, label, ha='center', transform=ax.get_xaxis_transform())
for x0, x1, h, s in ((0, 1, 21, '*'), (2, 3, 31, '**'), (1, 3, 35, 'ns')):
    ax.plot([x0, x0, x1, x1], [h - 1.2, h, h, h - 1.2], color='k', lw=1.2)
    ax.text((x0 + x1) / 2, h + 0.3, s, ha='center')
fig.tight_layout(rect=(0, 0.08, 1, 1))
save(fig, ax, 'groups-brackets', 'Y ticks inward; group lines with end marks under the X labels; significance brackets above the bars',
     undrawn=('x',))
print('written to', out)
