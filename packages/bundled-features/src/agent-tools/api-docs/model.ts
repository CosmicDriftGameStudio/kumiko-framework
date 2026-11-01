import type { AppApiDocsConfig } from "@cosmicdrift/kumiko-framework/config";
import type { WebhookEntityVerb } from "@cosmicdrift/kumiko-framework/engine";
import type { PatRateLimit } from "../../personal-access-tokens/index.ts";
import type { ApiExampleFile, WebhookExampleFile } from "./examples.ts";

/** One string per requested locale. */
export type LocalizedText = Readonly<Record<string, string>>;

export type ApiDocsHandlerKind = "query" | "write";

export type ApiDocsHandler = {
  readonly qn: string;
  readonly kind: ApiDocsHandlerKind;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  /** `undefined` when the input schema has no JSON Schema form. */
  readonly inputSchema: Readonly<Record<string, unknown>> | undefined;
  readonly excludedFields: readonly string[];
  readonly fieldLabels: Readonly<Record<string, LocalizedText>>;
  readonly example: ApiExampleFile | undefined;
};

export type ApiDocsGrantLevel = "read" | "write";

export type ApiDocsScopeHandler = {
  readonly qn: string;
  readonly grant: ApiDocsGrantLevel;
};

export type ApiDocsScope = {
  readonly domain: string;
  readonly label: string;
  /** Read handlers always; write handlers only when the domain declares a write level. */
  readonly handlers: readonly ApiDocsScopeHandler[];
  readonly hasWriteLevel: boolean;
};

export type ApiDocsEvent = {
  /** `feature:name` for a declared contract, `entity.verb` for an entity lifecycle event. */
  readonly qn: string;
  /** Event name as delivered; headings, anchors and OpenAPI webhook keys use it. */
  readonly wireName: string;
  readonly origin: "declared" | "entity";
  readonly entity?: string;
  readonly verb?: WebhookEntityVerb;
  readonly version: number;
  /** Declared events only; entity events are described from a template per verb. */
  readonly description: LocalizedText;
  /** Entity events only: the entity's translated label. */
  readonly entityLabel: LocalizedText;
  /** Declared events: requested locales other than `en` without a translated description. */
  readonly untranslatedLocales: readonly string[];
  /** Translated field labels per payload row name, used before the schema description. */
  readonly fieldLabels: Readonly<Record<string, LocalizedText>>;
  /** `undefined` when the payload has no JSON Schema form. */
  readonly payloadSchema: Readonly<Record<string, unknown>> | undefined;
  /** Scope domains that list the event, in code-point order; each grants it at `read` level. */
  readonly domains: readonly string[];
  readonly example: WebhookExampleFile | undefined;
};

export type ApiDocsModel = {
  readonly scopes: readonly ApiDocsScope[];
  /** Public webhook events, sorted by QN; empty when no scope lists one. */
  readonly events: readonly ApiDocsEvent[];
  /** Every handler any scope reaches, sorted by QN. */
  readonly handlers: readonly ApiDocsHandler[];
  readonly menuPath: LocalizedText;
  readonly createLabel: LocalizedText;
  readonly rateLimit: PatRateLimit;
  readonly toggleable: boolean;
};

export type ApiDocsSource = {
  readonly framework: string;
  readonly app: { readonly name: string; readonly version: string };
};

export type ResolvedApiDocsConfig = AppApiDocsConfig & {
  readonly locales: readonly string[];
  readonly baseUrl: string;
  readonly appName: string;
};
