/**
 * Faithful TypeScript port of wpd-core's core/color.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See core/mathFunctions.ts for porting-provenance notes.
 */

export class Color {
  private _r: number;
  private _g: number;
  private _b: number;
  private _a: number;

  constructor(r = 0, g = 0, b = 0, a = 255) {
    this._r = r;
    this._g = g;
    this._b = b;
    this._a = a;
  }

  toRGBString(): string {
    return `rgb(${this._r}, ${this._g}, ${this._b})`;
  }

  toRGBAString(): string {
    return `rgba(${this._r}, ${this._g}, ${this._b}, ${this._a})`;
  }

  serialize(): [number, number, number, number] {
    return [this._r, this._g, this._b, this._a];
  }

  getRGB(): [number, number, number] {
    return [this._r, this._g, this._b];
  }

  deserialize(data: [number, number, number, number]): void {
    this._r = data[0];
    this._g = data[1];
    this._b = data[2];
    this._a = data[3];
  }
}
