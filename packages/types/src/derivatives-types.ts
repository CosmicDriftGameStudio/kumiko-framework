// Derived-file-variants (thumbnails, resized/reformatted images, …) — pure
// types, no runtime logic. Client-visible package: no `node:*` imports.

export type VariantFit = "cover" | "inside" | "contain";
export type VariantFormat = "webp" | "avif" | "jpeg";

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
};

// A renderer turns the original bytes + a spec into the derived bytes for one
// variant. Registered per MIME-type (exact or `<type>/*` wildcard) via the
// `derivativeRenderer` extension point — see EXT_DERIVATIVE_RENDERER.
//
// The renderer must produce `spec.format` when set, and the source's own
// format otherwise. It never reports back what it produced: the caller
// derives the output mimeType from the spec alone (see outputMimeType in
// derivatives-context.ts), because a cache hit has no renderer run to read
// a mimeType off, and a spec-derived value is the only one both branches
// can share.
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
