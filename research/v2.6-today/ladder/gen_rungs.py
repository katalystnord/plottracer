import numpy as np, matplotlib, json, io
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import colors as mc
from PIL import Image
manifest = []
def make(name, curves, lw=1.5, jpeg=None, ylim=(0, 10)):
    fig, ax = plt.subplots(figsize=(6.4, 4.8), dpi=100)
    for n, (xs, ys, c) in curves.items():
        ax.plot(xs, ys, color=c, lw=lw)
    ax.set_xlim(0, 10); ax.set_ylim(*ylim); fig.canvas.draw()
    H = fig.canvas.get_width_height()[1]
    truth = {}
    for n, (xs, ys, c) in curves.items():
        p = ax.transData.transform(np.c_[xs, ys])
        truth[n] = {"rgb": [round(255 * v) for v in mc.to_rgb(c)], "px": [[float(a), float(H - b)] for a, b in p]}
    buf = io.BytesIO(); fig.savefig(buf, format="png", dpi=100); plt.close(fig); buf.seek(0)
    im = Image.open(buf).convert("RGB")
    if jpeg:
        b2 = io.BytesIO(); im.save(b2, format="JPEG", quality=jpeg); b2.seek(0); im = Image.open(b2).convert("RGB")
    im.save(name + ".png"); json.dump(truth, open(name + ".truth.json", "w")); manifest.append(name)
x = np.linspace(0, 10, 800)
PIX = 370 / 496  # axes px height / width -> data slope to pixel slope
def pair(theta_deg):
    k = np.tan(np.radians(theta_deg / 2)) / PIX * 1.0
    return {"blue": (x, 5 + k * (x - 5), "tab:blue"), "orange": (x, 5 - k * (x - 5), "tab:orange")}
make("r1_steep_90deg", pair(90))
for th in (20, 8, 3):
    make(f"r2_shallow_{th}deg", pair(th))
for lw in (3, 5):
    make(f"r3_thick_lw{lw}_8deg", pair(8), lw=lw)
five = {f"c{i}": (x, 5 + 3 * np.sin(x / (1.3 + 0.35 * i) + i * 1.3) * (0.6 + 0.1 * i), f"C{i}") for i in range(5)}
make("r4_five_curves", five)
make("r5_similar_blues_8deg", {"blue": (x, 5 + np.tan(np.radians(4)) / PIX * (x - 5), "#1f77b4"), "navy": (x, 5 - np.tan(np.radians(4)) / PIX * (x - 5), "#2c4f9e")})
make("r5_five_curves_jpeg75", five, jpeg=75)
t = np.linspace(0, 1, 400)
xl = 8 * t; yl = 60 * (1 - np.exp(-xl / 2.5)); xu = 8 - 5.5 * t; yu = yl[-1] * (1 - t) ** 1.6
make("loop_open", {"loop": (np.r_[xl, xu], np.r_[yl, yu], "tab:blue")}, ylim=(0, 70))
th = np.linspace(0, 2 * np.pi, 800)
make("loop_closed", {"loop": (5 + 3.5 * np.cos(th) + 0.8 * np.sin(2 * th), 35 + 22 * np.sin(th + 0.6), "tab:blue")}, ylim=(0, 70))
json.dump(manifest, open("manifest.json", "w")); print(manifest)
