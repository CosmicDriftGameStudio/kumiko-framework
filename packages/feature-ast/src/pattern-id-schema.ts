import * as z from "zod";
import type { PatternId } from "./patch.ts";

const patternIdEntitySchema = z
  .object({ kind: z.literal("entity"), entityName: z.string() })
  .strict();
const patternIdRelationSchema = z
  .object({ kind: z.literal("relation"), entityName: z.string(), relationName: z.string() })
  .strict();
const patternIdNavSchema = z.object({ kind: z.literal("nav"), id: z.string() }).strict();
const patternIdWorkspaceSchema = z
  .object({ kind: z.literal("workspace"), id: z.string() })
  .strict();
const patternIdScreenSchema = z.object({ kind: z.literal("screen"), id: z.string() }).strict();
const patternIdWriteHandlerSchema = z
  .object({ kind: z.literal("writeHandler"), handlerName: z.string() })
  .strict();
const patternIdQueryHandlerSchema = z
  .object({ kind: z.literal("queryHandler"), handlerName: z.string() })
  .strict();
const patternIdStreamHandlerSchema = z
  .object({ kind: z.literal("streamHandler"), handlerName: z.string() })
  .strict();
const patternIdHookSchema = z
  .object({
    kind: z.literal("hook"),
    hookType: z.string(),
    target: z.union([z.string(), z.object({ allOf: z.string() }).strict()]),
  })
  .strict();
const patternIdMetricSchema = z
  .object({ kind: z.literal("metric"), shortName: z.string() })
  .strict();
const patternIdSecretSchema = z
  .object({ kind: z.literal("secret"), shortName: z.string() })
  .strict();
const patternIdSecretNamespaceSchema = z
  .object({ kind: z.literal("secretNamespace"), shortName: z.string() })
  .strict();
const patternIdClaimKeySchema = z
  .object({ kind: z.literal("claimKey"), shortName: z.string() })
  .strict();
const patternIdReferenceDataSchema = z
  .object({ kind: z.literal("referenceData"), entityName: z.string() })
  .strict();
const patternIdUseExtensionSchema = z
  .object({ kind: z.literal("useExtension"), extensionName: z.string(), entityName: z.string() })
  .strict();
const patternIdJobSchema = z.object({ kind: z.literal("job"), jobName: z.string() }).strict();
const patternIdNotificationSchema = z
  .object({ kind: z.literal("notification"), notificationName: z.string() })
  .strict();
const patternIdHttpRouteSchema = z
  .object({ kind: z.literal("httpRoute"), method: z.string(), path: z.string() })
  .strict();
const patternIdProjectionSchema = z
  .object({ kind: z.literal("projection"), name: z.string() })
  .strict();
const patternIdMultiStreamProjectionSchema = z
  .object({ kind: z.literal("multiStreamProjection"), name: z.string() })
  .strict();
const patternIdDefineEventSchema = z
  .object({ kind: z.literal("defineEvent"), eventName: z.string() })
  .strict();
const patternIdExtendsRegistrarSchema = z
  .object({ kind: z.literal("extendsRegistrar"), extensionName: z.string() })
  .strict();
const patternIdAiGenerateSchema = z
  .object({ kind: z.literal("ai.generate"), stepKey: z.string() })
  .strict();
const patternIdAiExtractSchema = z
  .object({ kind: z.literal("ai.extract"), stepKey: z.string() })
  .strict();
const patternIdAiClassifySchema = z
  .object({ kind: z.literal("ai.classify"), stepKey: z.string() })
  .strict();
const patternIdRequiresSchema = z.object({ kind: z.literal("requires") }).strict();
const patternIdOptionalRequiresSchema = z.object({ kind: z.literal("optionalRequires") }).strict();
const patternIdReadsConfigSchema = z.object({ kind: z.literal("readsConfig") }).strict();
const patternIdSystemScopeSchema = z.object({ kind: z.literal("systemScope") }).strict();
const patternIdToggleableSchema = z.object({ kind: z.literal("toggleable") }).strict();
const patternIdDescribeSchema = z.object({ kind: z.literal("describe") }).strict();
const patternIdUiHintsSchema = z.object({ kind: z.literal("uiHints") }).strict();
const patternIdAdoptsBundledListsSchema = z
  .object({ kind: z.literal("adoptsBundledLists") })
  .strict();
const patternIdConfigSchema = z.object({ kind: z.literal("config") }).strict();
const patternIdTranslationsSchema = z.object({ kind: z.literal("translations") }).strict();
const patternIdAuthClaimsSchema = z.object({ kind: z.literal("authClaims") }).strict();
const patternIdTreeActionsSchema = z.object({ kind: z.literal("treeActions") }).strict();

export const PATTERN_ID_SCHEMAS_BY_KIND = {
  entity: patternIdEntitySchema,
  relation: patternIdRelationSchema,
  nav: patternIdNavSchema,
  workspace: patternIdWorkspaceSchema,
  screen: patternIdScreenSchema,
  writeHandler: patternIdWriteHandlerSchema,
  queryHandler: patternIdQueryHandlerSchema,
  streamHandler: patternIdStreamHandlerSchema,
  hook: patternIdHookSchema,
  metric: patternIdMetricSchema,
  secret: patternIdSecretSchema,
  secretNamespace: patternIdSecretNamespaceSchema,
  claimKey: patternIdClaimKeySchema,
  referenceData: patternIdReferenceDataSchema,
  useExtension: patternIdUseExtensionSchema,
  job: patternIdJobSchema,
  notification: patternIdNotificationSchema,
  httpRoute: patternIdHttpRouteSchema,
  projection: patternIdProjectionSchema,
  multiStreamProjection: patternIdMultiStreamProjectionSchema,
  defineEvent: patternIdDefineEventSchema,
  extendsRegistrar: patternIdExtendsRegistrarSchema,
  "ai.generate": patternIdAiGenerateSchema,
  "ai.extract": patternIdAiExtractSchema,
  "ai.classify": patternIdAiClassifySchema,
  requires: patternIdRequiresSchema,
  optionalRequires: patternIdOptionalRequiresSchema,
  readsConfig: patternIdReadsConfigSchema,
  systemScope: patternIdSystemScopeSchema,
  toggleable: patternIdToggleableSchema,
  describe: patternIdDescribeSchema,
  uiHints: patternIdUiHintsSchema,
  adoptsBundledLists: patternIdAdoptsBundledListsSchema,
  config: patternIdConfigSchema,
  translations: patternIdTranslationsSchema,
  authClaims: patternIdAuthClaimsSchema,
  treeActions: patternIdTreeActionsSchema,
} satisfies Record<PatternId["kind"], z.ZodTypeAny>;

export const patternIdSchema = z.discriminatedUnion("kind", [
  patternIdEntitySchema,
  patternIdRelationSchema,
  patternIdNavSchema,
  patternIdWorkspaceSchema,
  patternIdScreenSchema,
  patternIdWriteHandlerSchema,
  patternIdQueryHandlerSchema,
  patternIdStreamHandlerSchema,
  patternIdHookSchema,
  patternIdMetricSchema,
  patternIdSecretSchema,
  patternIdSecretNamespaceSchema,
  patternIdClaimKeySchema,
  patternIdReferenceDataSchema,
  patternIdUseExtensionSchema,
  patternIdJobSchema,
  patternIdNotificationSchema,
  patternIdHttpRouteSchema,
  patternIdProjectionSchema,
  patternIdMultiStreamProjectionSchema,
  patternIdDefineEventSchema,
  patternIdExtendsRegistrarSchema,
  patternIdAiGenerateSchema,
  patternIdAiExtractSchema,
  patternIdAiClassifySchema,
  patternIdRequiresSchema,
  patternIdOptionalRequiresSchema,
  patternIdReadsConfigSchema,
  patternIdSystemScopeSchema,
  patternIdAdoptsBundledListsSchema,
  patternIdToggleableSchema,
  patternIdDescribeSchema,
  patternIdUiHintsSchema,
  patternIdConfigSchema,
  patternIdTranslationsSchema,
  patternIdAuthClaimsSchema,
  patternIdTreeActionsSchema,
]);
