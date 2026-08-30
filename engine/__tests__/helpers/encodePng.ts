import { deflateSync } from 'node:zlib';

/**
 * A minimal PNG encoder, FOR TESTS ONLY.
 *
 * ⚑ WHY IT EXISTS. The app encodes a crop through a canvas, which node does not
 * have; the OCR reader takes encoded bytes. Without this, the pipeline from
 * "band the user dragged" to "name in the card" could only be tested inside a
 * real Electron app, and the one test that proves the whole feature against real
 * ink and committed ground truth could not exist at all.
 *
 * ⚑ ENCODE ONLY, and the fixtures are raw RGBA rather than PNG for exactly that
 * reason: a DECODER is the half with filters, interlacing and colour types in
 * it, and a bug in one would look like an OCR finding rather than a test-harness
 * fault. Nothing here is reachable from the app.
 *
 * Filter type 0 on every scanline, 8-bit RGBA, non-interlaced.
 */

let table: number[] | null = null;

function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

export function encodePng(image: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): Buffer {
  const stride = image.width * 4;
  const raw = Buffer.alloc(image.height * (stride + 1));
  const src = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    src.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
