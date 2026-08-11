// kumiko-feature-version: 1
//
// Same extension-point/provider-feature pattern as file-foundation — see
// r.describe below for what this feature does. Unlike `fileProvider`,
// renderer selection is MIME-type-deterministic, not per-tenant
// configurable, so this feature has no `r.config` and no
// `r.extensionSelector`.

import { defineFeature, EXT_DERIVATIVE_RENDERER } from "@cosmicdrift/kumiko-framework/engine";

const FEATURE_NAME = "file-derivatives";

export const fileDerivativesFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    "Declares the `derivativeRenderer` extension point. `ctx.derivatives.variant(fileRefId, spec, name)` derives a variant of a tracked FileRef the first time it's requested and reuses the stored result afterwards (derive-on-first-use, keyed by a hash of the spec). Mount at least one `derivatives-*` renderer feature alongside this one — without a registered renderer for the FileRef's MIME type, every `variant(...)` call throws.",
  );
  r.uiHints({
    displayLabel: "File Derivatives",
    category: "storage",
    recommended: false,
  });
  // Needs a storage provider to read the original + write the variant —
  // without file-foundation there's nothing to derive from or write to.
  r.requires("file-foundation");

  r.extendsRegistrar(EXT_DERIVATIVE_RENDERER, {
    onRegister: () => {
      // No side-effects at register-time — resolution (exact MIME match,
      // then `<type>/*` wildcard) happens at request-time in
      // resolveRenderer, mirrors file-foundation's fileProvider point.
    },
  });
});
