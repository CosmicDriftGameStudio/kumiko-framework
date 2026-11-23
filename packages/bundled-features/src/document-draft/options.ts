import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";
import type { DocumentDraftRetention } from "./entity.ts";

export type DocumentDraftSubject = { readonly subjectType: string; readonly subjectId: string };

export type DocumentDraftOptions = {
  /** Entity names a draft may belong to; a user sees and works on a draft only while its subject row is readable to them. Must be registered entities without their own `parentRef`. */
  readonly subjectTypes: readonly [string, ...string[]];
  /** How long drafts are kept, data-retention keepFor syntax, counted from creation. Default 10y. */
  readonly retention?: DocumentDraftRetention;
  /** Access rule of the handlers and queries. Default `{ roles: ["TenantAdmin", "TenantMember"] }`. */
  readonly access?: AccessRule;
  /** Extra role rule per subject type, checked on top of `access` by every draft handler and query (create, patch, save, finalize, revise, discard, blocks, by-subject); a user who misses it gets the same not-found as for an unreadable subject. Keys must be in `subjectTypes`. A subject type without an entry is governed by `access` alone. */
  readonly subjectAccess?: Partial<Record<string, AccessRule>>;
  /** Screen per subject type the editor returns to after finalize or discard, opened with the subject id. */
  readonly subjectScreens?: Readonly<Record<string, string>>;
  /** Template slugs whose drafts stay open because the app prints them itself (for example one letter per recipient at dispatch): `finalize` refuses them with `document_draft_not_finalizable` and the editor shows no finalize button. Default none. */
  readonly unfinalizedTemplates?: readonly string[];
};
