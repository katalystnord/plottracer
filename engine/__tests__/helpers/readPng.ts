/**
 * A minimal PNG reader, for tests that must trace a REAL bundled figure rather
 * than a synthetic stand-in.
 *
 * ⚑ WHY THIS EXISTS. The app decodes images through the DOM, which a unit test
 * has no access to - so every image test so far has drawn its own figure, and a
 * figure a test draws can only prove the code self-consistent. The spider
 * over-read is the case in point: the synthetic radar chart strokes lines and
 * draws NO MARKERS, so it exhibits a ~1px bias where the real PNG exhibits ~4.8px,
 * and its tolerance was sized to absorb the real error while crediting it to the
 * wrong cause. Reading the shipped PNG is the only way to ask the real question
 * (see [ground truth is the instrument] in the project's own notes).
 *
 * Deliberately narrow: 8-bit, non-interlaced, colour type 2 (RGB) or 6 (RGBA) -
 * which is what `samples/` holds. Anything else throws by name rather than
 * returning a plausible-looking wrong image. `fflate` is already a dependency
 * (the project container writes zips with it), so this adds none.
 */
import { readFileSync } from 'node:fs';
import { unzlibSync } from 'fflate';

export interface DecodedImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Undo one scanline's filter, in place. `bpp` is bytes per pixel. */
function unfilter(type: number, line: Uint8Array, prev: Uint8Array, bpp: number): void {
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp]! : 0;
    const b = prev[i] ?? 0;
    const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
    switch (type) {
      case 0: break;
      case 1: line[i] = (line[i]! + a) & 0xff; break;
      case 2: line[i] = (line[i]! + b) & 0xff; break;
      case 3: line[i] = (line[i]! + ((a + b) >> 1)) & 0xff; break;
      case 4: line[i] = (line[i]! + paeth(a, b, c)) & 0xff; break;
      default: throw new Error(`PNG: unknown filter type ${type}`);
    }
  }
}

/** Decode a PNG file into the RGBA plane the extraction code takes. */
export function readPng(file: string): DecodedImage {
  const bytes = new Uint8Array(readFileSync(file));
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) throw new Error(`${file}: not a PNG`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0;
  let height = 0;
  let colourType = -1;
  const idat: Uint8Array[] = [];
  for (let p = 8; p + 8 <= bytes.length; ) {
    const length = view.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
    const body = bytes.subarray(p + 8, p + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(p + 8);
      height = view.getUint32(p + 12);
      const bitDepth = bytes[p + 16]!;
      colourType = bytes[p + 17]!;
      const interlace = bytes[p + 20]!;
      if (bitDepth !== 8) throw new Error(`${file}: bit depth ${bitDepth}, only 8 supported`);
      if (interlace !== 0) throw new Error(`${file}: interlaced, not supported`);
      if (colourType !== 2 && colourType !== 6) {
        throw new Error(`${file}: colour type ${colourType}, only 2 (RGB) and 6 (RGBA) supported`);
      }
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + length; // length + type + body + CRC
  }
  if (!width || !height) throw new Error(`${file}: no IHDR`);

  // The IDAT chunks are ONE zlib stream split arbitrarily, so they must be
  // joined before inflating rather than inflated one at a time.
  const total = idat.reduce((n, c) => n + c.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of idat) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  const raw = unzlibSync(joined);

  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start]!;
    const line = raw.slice(start + 1, start + 1 + stride);
    unfilter(filter, line, prev, channels);
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s]!;
      out[d + 1] = line[s + 1]!;
      out[d + 2] = line[s + 2]!;
      out[d + 3] = channels === 4 ? line[s + 3]! : 255;
    }
    prev = line;
  }
  return { data: out, width, height };
}
