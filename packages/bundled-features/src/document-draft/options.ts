import type {
  AccessRule,
  BeforeTransactionContext,
  BeforeTransactionResult,
  HandlerContext,
  SessionUser,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import type { DocumentPdfDraft } from "../renderer-foundation/index.ts";

export type DocumentDraftSubject = {
  readonly subjectType: string;
  readonly subjectId: string;
};

export type AuthorizeDocumentDraftSubject = (
  ctx: HandlerContext,
  user: SessionUser,
  subject: DocumentDraftSubject,
) => Promise<boolean>;

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

export type DocumentDraftOptions<TUpload> = {
  /** The kinds of object a draft can belong to, e.g. `lease`; create refuses any other. */
  readonly subjectTypes: readonly [string, ...string[]];
  readonly pdf: DocumentDraftPdf<TUpload>;
  /** How long drafts are kept, data-retention keepFor syntax, counted from creation. Default 10y. */
  readonly retention?: { readonly keepFor: string };
  /** Access rule of the handlers and queries. Default `{ roles: ["TenantAdmin", "TenantMember"] }`. */
  readonly access?: AccessRule;
  /** Runs for every handler and query on the subject of a draft, except for `unscopedRoles`. `false` answers like "does not exist". */
  readonly authorizeSubject?: AuthorizeDocumentDraftSubject;
  /** Screen per subject type the editor returns to after finalize or discard, opened with the subject id. */
  readonly subjectScreens?: Readonly<Record<string, string>>;
  /** Roles that skip `authorizeSubject`, e.g. admins. */
  readonly unscopedRoles?: readonly string[];
};
