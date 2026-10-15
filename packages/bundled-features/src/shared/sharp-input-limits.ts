// Sharp-free so callers can import the limits without loading the native binding.

// Above this, a decoded pixel buffer runs into hundreds of MB before any
// resize even happens — sharp's own default (~268MP) is still large enough
// to be an OOM primitive for a single request.
export const MAX_INPUT_PIXELS = 100_000_000;
// sequentialRead trades random pixel access for lower peak memory on
// streamed formats — applied at every decode entry point below since none
// of them need non-sequential access to the *original* bytes (extract runs
// against a single already-buffered region per call).
export const SHARP_INPUT_OPTIONS = {
  limitInputPixels: MAX_INPUT_PIXELS,
  sequentialRead: true,
} as const;

// Shared trust boundary for every image byte source this renderer decodes —
// the original upload (renderImage) and an overlay layer's bytes (applyOverlays)
// alike: a base64 string in a field declaration isn't more trustworthy than
// an upload just because it came from app code.
export function assertNotSvg(format: string | undefined): void {
  if (format === "svg") {
    throw new Error(
      "derivatives-sharp: SVG is not supported — rendering untrusted SVG through libvips is a trust boundary this renderer doesn't need to cross.",
    );
  }
}
