import { describe, expect, it } from 'vitest';
import { isPdfBytes, isTiffBytes, pagedDocumentFormat } from '../pdfDetect.js';

describe('isPdfBytes (checkpoint 98)', () => {
  it('recognises the %PDF signature', () => {
    expect(isPdfBytes(new TextEncoder().encode('%PDF-1.4\n...'))).toBe(true);
  });

  it('rejects non-PDF bytes', () => {
    // PNG signature.
    expect(isPdfBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(false);
    // Plain text, and too-short buffers.
    expect(isPdfBytes(new TextEncoder().encode('hello'))).toBe(false);
    expect(isPdfBytes(new Uint8Array([0x25, 0x50, 0x44]))).toBe(false); // "%PD", < 5 bytes
    expect(isPdfBytes(new Uint8Array())).toBe(false);
  });
});

describe('isTiffBytes / pagedDocumentFormat (B7)', () => {
  it('recognises both TIFF byte orders', () => {
    expect(isTiffBytes(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08]))).toBe(true); // "II*\0" little-endian
    expect(isTiffBytes(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0x00]))).toBe(true); // "MM\0*" big-endian
  });

  it('rejects non-TIFF bytes', () => {
    expect(isTiffBytes(new TextEncoder().encode('%PDF-1.4'))).toBe(false);
    expect(isTiffBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // PNG
    expect(isTiffBytes(new Uint8Array([0x49, 0x49]))).toBe(false); // too short
    expect(isTiffBytes(new Uint8Array())).toBe(false);
  });

  it('routes bytes to the right paged-document format (or null for a plain raster)', () => {
    expect(pagedDocumentFormat(new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    expect(pagedDocumentFormat(new Uint8Array([0x49, 0x49, 0x2a, 0x00]))).toBe('tiff');
    expect(pagedDocumentFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG -> <img> decodes it
  });
});
