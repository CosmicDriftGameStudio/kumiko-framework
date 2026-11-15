import type {
  AccessRule,
  BeforeTransactionContext,
  BeforeTransactionResult,
  HandlerContext,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import type { DocumentPdfDraft } from "../renderer-foundation/index.ts";
import type { SubjectScopeOptions } from "../shared/index.ts";
import type { DocumentDraftRetention } from "./entity.ts";

export type AuthorizeDocumentDraftSubject = NonNullable<SubjectScopeOptions["authorizeSubject"]>;
export type DocumentDraftSubject = Parameters<AuthorizeDocumentDraftSubject>[2];

export type DocumentDraftRenderArgs = {
  readonly slug: string;
  /** Slug of a variant of `slug`, printed instead of the base. */
  readonly variant?: string;
  readonly locale: string;
  readonly variables: Readonly<Record<string, unknown>>;
  /** The draft's own body, meta and variable schema, printed instead of the stored template. */
  readonly draft: DocumentPdfDraft;
};

// Injected by the app: bundled-features cannot import renderer-puppeteer-client, which itself
// depends on bundled-features. `{ render: renderPdfBeforeTransaction, store: storeRenderedPdf }`
// from that package fits without an adapter.
export type DocumentDraftPdf<TUpload> = {
  /** Prints the draft to a PDF and uploads it while no transaction is open. */
  readonly render: (
    ctx: BeforeTransactionContext,
    args: DocumentDraftRenderArgs,
  ) => Promise<BeforeTransactionResult<TUpload>>;
  /** Stores the uploaded PDF as a file inside the finalize transaction. */
  readonly store: (
    ctx: HandlerContext,
    upload: TUpload,
  ) => Promise<WriteResult<{ readonly fileRefId: string; readonly fileName: string }>>;
};

export type DocumentDraftOptions<TUpload> = SubjectScopeOptions & {
  /** The kinds of object a draft can belong to, e.g. `lease`; create refuses any other. */
  readonly subjectTypes: readonly [string, ...string[]];
  readonly pdf: DocumentDraftPdf<TUpload>;
  /** How long drafts are kept, data-retention keepFor syntax, counted from creation. Default 10y. */
  readonly retention?: DocumentDraftRetention;
  /** Access rule of the handlers and queries. Default `{ roles: ["TenantAdmin", "TenantMember"] }`. */
  readonly access?: AccessRule;
  /** Screen per subject type the editor returns to after finalize or discard, opened with the subject id. */
  readonly subjectScreens?: Readonly<Record<string, string>>;
};
