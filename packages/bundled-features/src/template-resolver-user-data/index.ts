// Provides the EXT_USER_DATA export/delete hooks for the template-resolver's
// `user-content-entry` entity — mount it alongside template-resolver and
// user-data-rights when an app declares a collection with `ownership: "user"`.
// Kept separate from template-resolver so apps with only tenant-wide
// collections stay usable without the user-data-rights stack. Mirrors
// notes-history-user-data.

import { defineFeature, EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { userContentDeleteHook, userContentExportHook } from "./hooks";

export const templateResolverUserDataFeature = defineFeature("template-resolver-user-data", (r) => {
  r.describe(
    "GDPR (Art. 20 export / Art. 17 erasure) coverage for the `template-resolver` feature's `user-content-entry` entity — the per-user half of the content store (mail signatures, personal reply snippets). Mounts the EXT_USER_DATA export hook so a user's own entries land in the export bundle; the delete hook is a deliberate no-op because `content` is annotated `userOwned`, so erasure runs via crypto-shredding (destroying the owner's subject key) rather than a physical delete, which would not survive an event replay. Mount this whenever `createTemplateResolverFeature` declares a collection with `ownership: \"user\"` — the boot guard otherwise refuses the entity. Requires `user-data-rights`, optionalRequires `template-resolver`.",
  );
  // user-data-rights is the hard dependency (EXT_USER_DATA host).
  // template-resolver is optional for the same reason as in
  // notes-history-user-data: a toggleable mount would otherwise trip the
  // "effectively disabled" boot warning even though the entity is there.
  r.requires("user-data-rights");
  r.optionalRequires("template-resolver");
  r.useExtension(EXT_USER_DATA, "user-content-entry", {
    export: userContentExportHook,
    delete: userContentDeleteHook,
  });
});
