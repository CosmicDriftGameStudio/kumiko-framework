// form-draft — a per-user, per-tenant working copy of an in-progress form,
// saved BEFORE the real domain entity exists. Backing for wizard-mode resume
// (kumiko-framework#1884/#1883): a caller-assigned draftKey (typically
// screenId + optional hostEntityId) round-trips { values, stepIndex,
// savedAt } through save/discard/get. See entity.ts for the ownership +
// uniqueness model.

import { defineFeature, type FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { FORM_DRAFT_FEATURE_NAME } from "./constants";
import { formDraftEntity } from "./entity";
import { discardDraftWrite } from "./handlers/discard.write";
import { getDraftQuery } from "./handlers/get.query";
import { saveDraftWrite } from "./handlers/save.write";
import { FORM_DRAFT_FEATURE_I18N } from "./i18n";

function registerFormDraft(r: FeatureRegistrar<typeof FORM_DRAFT_FEATURE_NAME>): void {
  r.describe(
    "Per-user, per-tenant working copy of an in-progress form, saved BEFORE the real domain entity exists. Owns one event-sourced entity, `form-draft` (`read_form_drafts`), keyed by a caller-assigned draftKey (typically screenId + optional hostEntityId), unique per (tenant, owner, draftKey). `save` upserts the draft blob ({ values, stepIndex, savedAt } — savedAt stamped server-side), `discard` deletes it (called once the real submit succeeds), `get` resumes it. Ownership is enforced by a per-row owner filter in every handler, not by roles — a foreign user's save/discard/get for someone else's draftKey never sees or touches that row. Never holds anything that already lives in a domain stream; the consuming app is responsible for discarding once the domain write succeeds.",
  );
  r.uiHints({
    displayLabel: "Form Drafts",
    category: "data",
    recommended: false,
  });

  r.entity("form-draft", formDraftEntity);

  r.writeHandler(saveDraftWrite);
  r.writeHandler(discardDraftWrite);
  r.queryHandler(getDraftQuery);

  r.translations({ keys: FORM_DRAFT_FEATURE_I18N });
}

export const formDraftFeature = defineFeature(FORM_DRAFT_FEATURE_NAME, registerFormDraft);
