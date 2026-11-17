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
  /** Screen per subject type the editor returns to after finalize or discard, opened with the subject id. */
  readonly subjectScreens?: Readonly<Record<string, string>>;
};
