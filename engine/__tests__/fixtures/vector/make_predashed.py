"""Fixture for v2.7 V23: a dashed line written as SEPARATE short pieces with no
dash array (as some exporters write dashes), by hand so the operators are
exactly these. Page 300 x 200 pt, frame 20..280 x 20..180.
  A: y = 60  - one path, many `m l` pieces, 4 pt dashes, 2 pt gaps
  B: y = 120 - one path PER dash, 4 pt dashes, 2 pt gaps, sloping up 0.1
  python3 make_predashed.py -> predashed.pdf + predashed.truth.json
"""
import json
import zlib

a = b" ".join(b"%g 60 m %g 60 l" % (x, x + 4) for x in range(30, 270, 6)) + b" S"
bs = b"\n".join(b"%g %g m %g %g l S" % (x, 120 + 0.1 * (x - 30), x + 4, 120 + 0.1 * (x + 4 - 30)) for x in range(30, 270, 6))
content = b"0 0 0 RG 1 w 20 20 260 160 re S\n0 0 1 RG 1.5 w\n" + a + b"\n" + bs + b"\n"
data = zlib.compress(content)
objs = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>",
    b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(data) + data + b"\nendstream",
]
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
open("predashed.pdf", "wb").write(out)
json.dump({"box": [20, 20, 280, 180], "legend_box": None, "lines": [
    {"points": [[30, 60], [268, 60]]},
    {"points": [[30, 120], [268, 120 + 0.1 * 238]]}]}, open("predashed.truth.json", "w"))
print("written")
