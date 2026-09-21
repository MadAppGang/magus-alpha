// The mod environment has TC39 base64 (the Raster docs encode with it);
// TypeScript 5.9's lib does not declare it yet.
interface Uint8Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> {
  toBase64(): string
}
