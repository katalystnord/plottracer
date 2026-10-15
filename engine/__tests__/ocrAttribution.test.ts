import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

/**
 * Case 11 of docs/v2.7-paddle-ocr.md: the reader the app ships is credited where a user and a
 * redistributor look, and the old one is no longer credited for work it does not do.
 *
 * ⚑ Apache-2.0 (the PP-OCRv6 models, PaddleOCR) asks for the licence text, the notices, and a
 * statement that a file was modified; the ONNX files ARE modified, converted from Paddle's format.
 * MIT (ONNX Runtime) asks for its licence text, which its npm package does not carry, so the
 * project ships its own copy beside the models along with Microsoft's third-party notices.
 */

const read = (p: string) => readFileSync(p, 'utf8');
const ABOUT = 'ui/src/panels/HelpMenu.tsx';
const NOTICES = [
  'ui/ocr-model/LICENSE',
  'ui/ocr-model/NOTICE',
  'ui/ocr-model/onnxruntime/LICENSE',
  'ui/ocr-model/onnxruntime/ThirdPartyNotices.txt',
];

describe('case 11: the text reader is credited for what it is', () => {
  for (const file of ['README.md', ABOUT]) {
    it(`${file} names PaddleOCR, its models' licence and ONNX Runtime, and not Tesseract`, () => {
      const text = read(file);
      expect(text).toMatch(/PaddleOCR/);
      expect(text).toMatch(/PP-OCRv6/);
      expect(text).toMatch(/Apache-2\.0/);
      expect(text).toMatch(/ONNX Runtime/);
      expect(text).toMatch(/MIT/);
      expect(text).not.toMatch(/Tesseract/i);
    });
  }

  it('README says the shipped models were converted from the published ones', () => {
    expect(read('README.md')).toMatch(/converted/i);
  });

  for (const file of NOTICES) {
    it(`${file} is in the repository`, () => {
      expect(existsSync(file)).toBe(true);
    });
  }

  it('the licence texts are the real ones', () => {
    expect(read('ui/ocr-model/LICENSE')).toMatch(/Apache License\s+Version 2\.0, January 2004/);
    expect(read('ui/ocr-model/onnxruntime/LICENSE')).toMatch(/MIT License[\s\S]*Copyright \(c\) Microsoft Corporation/);
    expect(read('ui/ocr-model/NOTICE')).toMatch(/converted/i);
  });

  it('the package carries them: the models folder is shipped whole', () => {
    expect(read('build/electron-builder-ui.yml')).toMatch(/^\s+- ui\/ocr-model\/\*\*\/\*$/m);
  });
});
