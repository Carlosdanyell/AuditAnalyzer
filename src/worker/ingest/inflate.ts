import { Inflate } from 'fflate';

/** 'auto' uses the browser's DecompressionStream('deflate-raw') when available, else fflate. */
export type InflateMode = 'auto' | 'native' | 'fallback';

let nativeSupported: boolean | undefined;

export function nativeDeflateRawSupported(): boolean {
  if (nativeSupported === undefined) {
    try {
      new DecompressionStream('deflate-raw');
      nativeSupported = true;
    } catch {
      nativeSupported = false;
    }
  }
  return nativeSupported;
}

function fflateInflateStream(): TransformStream<Uint8Array, Uint8Array> {
  let inflater: Inflate;
  return new TransformStream({
    start(controller) {
      inflater = new Inflate((chunk) => controller.enqueue(chunk));
    },
    transform(chunk) {
      inflater.push(chunk, false);
    },
    flush() {
      inflater.push(new Uint8Array(0), true);
    },
  });
}

export function inflateRaw(input: ReadableStream<Uint8Array>, mode: InflateMode = 'auto'): ReadableStream<Uint8Array> {
  const native = mode === 'native' || (mode === 'auto' && nativeDeflateRawSupported());
  if (native) {
    return input.pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
  }
  return input.pipeThrough(fflateInflateStream());
}
