// Derived-file-variants (thumbnails, resized/reformatted images, …) — pure
// types, no runtime logic. Client-visible package: no `node:*` imports.

export type VariantFit = "cover" | "inside" | "contain";
export type VariantFormat = "webp" | "avif" | "jpeg";

// Rectangle in relative coordinates (0…1 of width/height) so it survives a
// resize. Burning blur into plates/faces needs coordinates that only exist at
// runtime (detection + user correction), so they ride in the spec instead of a
// field declaration — the spec hash keys the cache, so corrected regions
// automatically yield a fresh URL.
export type BlurRegion = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type OverlayGravity = "north-west" | "north-east" | "south-west" | "south-east" | "center";

// Placement is relative to the OUTPUT box (after resize), so one declaration
// covers every aspect ratio the same source is rendered into.
type OverlayPlacement = {
  // Layer width as a fraction (0…1) of the output width; height follows the
  // layer's own aspect ratio.
  readonly widthPct: number;
  readonly gravity: OverlayGravity;
  // Inset from the edges, fraction of output width. Ignored for "center".
  readonly marginPct?: number;
};

export type OverlayLayer =
  // `dataToken` is NOT the QR payload — it names a value an
  // EXT_DERIVATIVE_OVERLAY_RESOLVER registration resolves per FileRef. A
  // literal payload is deliberately not expressible: the public variant route
  // is anonymous, so a caller-supplied target would make it an open image
  // generator for arbitrary URLs.
  | ({ readonly kind: "qr"; readonly dataToken: string } & OverlayPlacement)
  // Caller-supplied raster (watermark/badge), base64 in the declaration.
  // Swapping the image changes the spec hash and invalidates every derivative
  // that used it — no extra bookkeeping.
  | ({ readonly kind: "image"; readonly imageBase64: string } & OverlayPlacement);

// Renderer-facing counterpart of OverlayLayer once derivatives-context has
// resolved every `dataToken` — a `qr` layer carries the actual value to
// encode instead of a name a resolver still has to look up. Keeping this a
// distinct type (not a value-replacement on OverlayLayer itself) means a
// renderer's input type structurally cannot hold an unresolved token.
export type ResolvedOverlayLayer =
  | ({ readonly kind: "qr"; readonly data: string } & OverlayPlacement)
  | Extract<OverlayLayer, { kind: "image" }>;

export type VariantSpec = {
  // Default "inside" when omitted (renderer-side default, Schnitt 2).
  readonly fit?: VariantFit;
  readonly size?: { readonly width: number; readonly height: number };
  // Alternative to `size` — longest edge in pixels, aspect preserved.
  readonly maxEdge?: number;
  readonly format?: VariantFormat;
  readonly quality?: number;
  // Whole-image blur radius.
  readonly blur?: number;
  readonly blurRegions?: readonly BlurRegion[];
  // Composited AFTER resize, in array order (last layer on top).
  readonly overlays?: readonly OverlayLayer[];
  // Framework-internal: derivatives-context.ts fills this in from `overlays`
  // once every dataToken is resolved. A renderer reads only this field, so a
  // token can never reach it, even by accident.
  readonly resolvedOverlays?: readonly ResolvedOverlayLayer[];
};

// A renderer turns the original bytes + a spec into the derived bytes for one
// variant. Registered per MIME-type (exact or `<type>/*` wildcard) via the
// `derivativeRenderer` extension point — see EXT_DERIVATIVE_RENDERER.
//
// The renderer must produce `spec.format` when set, and the source's own
// format otherwise. It never reports back what it produced: the caller
// derives the output mimeType from the spec plus the source FileRef's
// mimeType (see outputMimeType in derivatives-context.ts), because a cache
// hit has no renderer run to read a mimeType off. When `spec.format` is
// unset, the source mimeType is client-controlled, so outputMimeType
// allowlists it against known-safe raster types instead of passing it
// through verbatim (#2021).
export type DerivativeRendererPlugin = {
  readonly render: (
    input: Uint8Array,
    spec: VariantSpec,
    sourceMimeType: string,
  ) => Promise<Uint8Array>;
};

export type VariantResult = {
  readonly storageKey: string;
  readonly mimeType: string;
  // true = rendered during this call, false = an existing derivative was
  // found and returned unchanged.
  readonly rendered: boolean;
};

// The `ctx.derivatives` service — derive-on-first-use variants of a tracked
// FileRef. `name` feeds only the readable key-prefix; `spec` determines the
// content hash, so a spec change always produces a fresh URL instead of
// silently overwriting what's cached under the old pixels.
export type DerivativesContext = {
  readonly variant: (fileRefId: string, spec: VariantSpec, name: string) => Promise<VariantResult>;
};
