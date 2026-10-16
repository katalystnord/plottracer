"""Fixture for v2.7: a PDF whose line width, dash and alpha are set ONLY through
an ExtGState (/GS gs), as some exporters write them, written by hand so the
operators are exactly these.

  python3 make_gstate.py  -> gstate.pdf + gstate.truth.json

Page 200 x 200 pt. Three blue (0 0 1) strokes inside a black frame:
  A: y = 50,  width 4 via /LW, solid
  B: y = 100, width 1 (set directly), dash [6 3] via /D
  C: y = 150, width 1, stroke alpha 0 via /CA (painted, but invisible)
"""
import json
import zlib

content = b"""
0 0 0 RG 1 w 20 20 160 160 re S
0 0 1 RG
q /G1 gs 30 50 m 170 50 l S Q
q 1 w /G2 gs 30 100 m 170 100 l S Q
q 1 w /G3 gs 30 150 m 170 150 l S Q
"""
objs = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /ExtGState << /G1 5 0 R /G2 6 0 R /G3 7 0 R >> >> >>",
    None,
    b"<< /Type /ExtGState /LW 4 >>",
    b"<< /Type /ExtGState /D [[6 3] 0] >>",
    b"<< /Type /ExtGState /CA 0 >>",
]
data = zlib.compress(content)
objs[3] = b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(data) + data + b"\nendstream"
out = bytearray(b"%PDF-1.4\n")
offs = []
for i, o in enumerate(objs, 1):
    offs.append(len(out))
    out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
x = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
for o in offs:
    out += b"%010d 00000 n \n" % o
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
open("gstate.pdf", "wb").write(out)
json.dump({"box": [20, 20, 180, 180], "lines": [
    {"y": 50, "width": 4, "dash": None, "visible": True},
    {"y": 100, "width": 1, "dash": [6, 3], "visible": True},
    {"y": 150, "width": 1, "dash": None, "visible": False}]}, open("gstate.truth.json", "w"))
print("written")
