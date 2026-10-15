#!/usr/bin/env bash
# Rebuilds ui/ocr-model/ from the pinned PP-OCRv6 tiny revisions on Hugging Face (v2.7).
#
# The reader ships ONNX files run by onnxruntime-web; PaddlePaddle publishes Paddle inference files.
# This converts them with paddle2onnx and writes the recogniser's character list as JSON, so the
# shipped files can always be regenerated from their source rather than trusted as opaque blobs.
#
# Needs a Python with paddlepaddle, paddle2onnx and pyyaml (on beast: ~/ml/paddleocr/.venv),
# and the `hf` CLI (huggingface_hub; run through `uvx` when it is not installed). Usage: PYTHON=/path/to/python tools/ocr-model/build.sh
set -euo pipefail
PY=${PYTHON:-python3}
P2O=$(dirname "$PY")/paddle2onnx
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$(cd "$HERE/../.." && pwd)/ui/ocr-model
WORK=$(mktemp -d)
if command -v hf >/dev/null; then HF=(hf); else HF=(uvx --from huggingface_hub hf); fi
trap 'rm -rf "$WORK"' EXIT

# ⚑ Pinned: a model update upstream must be a deliberate change here, re-measured, never a silent one.
DET_REV=d3177d4e5551463292a61e27cfca2b53e7c3fe9d   # PaddlePaddle/PP-OCRv6_tiny_det, 2026-06-12
REC_REV=0736086f72f666350ebcdc0c3a504eeac89cdfad   # PaddlePaddle/PP-OCRv6_tiny_rec, 2026-06-12

for pair in "det:PP-OCRv6_tiny_det:$DET_REV" "rec:PP-OCRv6_tiny_rec:$REC_REV"; do
  IFS=: read -r kind repo rev <<<"$pair"
  "${HF[@]}" download "PaddlePaddle/$repo" --revision "$rev" --local-dir "$WORK/$kind" >/dev/null
  "$P2O" --model_dir "$WORK/$kind" --model_filename inference.json --params_filename inference.pdiparams \
    --save_file "$OUT/$kind.onnx" --opset_version 14 >/dev/null 2>&1
done

# The recogniser's output classes: index 0 is the CTC blank, then the dictionary, then a space.
"$PY" - "$WORK/rec/inference.yml" "$OUT/rec-chars.json" <<'PYEOF'
import json, sys, yaml
chars = yaml.safe_load(open(sys.argv[1]))['PostProcess']['character_dict']
json.dump(['blank'] + chars + [' '], open(sys.argv[2], 'w'), ensure_ascii=False)
PYEOF
sha256sum "$OUT"/det.onnx "$OUT"/rec.onnx "$OUT"/rec-chars.json
