// Provides the EXT_USER_DATA export/delete hooks for the form-draft
// feature's `form-draft` entity as a standalone feature — mount it alongside
// form-draft + user-data-rights when an app needs form drafts in its GDPR
// export/forget pipeline. Kept separate from form-draft (which requires
// nothing) so form-draft consumers without the user-data-rights stack don't
// pull a hard dependency. Mirrors notes-history-user-data.

import { defineFeature, EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { formDraftDeleteHook, formDraftExportHook } from "./hooks";

export const formDraftUserDataFeature = defineFeature("form-draft-user-data", (r) => {
  r.describe(
    "GDPR (Art. 20 export / Art. 17 erasure) coverage for the `form-draft` feature's `form-draft` entity. Mounts the EXT_USER_DATA export hook so a user's saved drafts are included in the user-data export bundle, and a delete hook that physically removes the user's own draft rows on forget. Kept separate from `form-draft` so form-draft consumers without the user-data-rights pipeline don't pull a hard dependency — requires `user-data-rights`, optionalRequires `form-draft`.",
  );
  r.requires("user-data-rights");
  r.optionalRequires("form-draft");
  r.useExtension(EXT_USER_DATA, "form-draft", {
    export: formDraftExportHook,
    delete: formDraftDeleteHook,
  });
});
